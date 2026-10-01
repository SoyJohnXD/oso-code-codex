#!/usr/bin/env python3
"""Inspect plugin skills and hook trust through the installed Codex app-server protocol."""

import argparse
import json
import os
from pathlib import Path
import queue
import subprocess
import threading


def call(server, responses, sequence, method, params):
    server.stdin.write(json.dumps({"id": sequence, "method": method, "params": params}) + "\n")
    server.stdin.flush()
    while True:
        response = responses.get(timeout=45)
        if response is None:
            raise RuntimeError(f"Codex closed the protocol during {method}")
        if response.get("id") != sequence:
            continue
        if "error" in response:
            raise RuntimeError(json.dumps(response["error"]))
        return response["result"]


def read_responses(server, responses):
    for line in server.stdout:
        responses.put(json.loads(line))
    responses.put(None)


def owned_hooks(report):
    return [hook for entry in report.get("trustedHooks", report["hooks"])["data"] for hook in entry["hooks"] if (hook.get("pluginId") or "").startswith("oso-code-codex@")]


def validate_capabilities(skills, hooks, expected_version):
    required = {f"oso-code-codex:{name}" for name in ("plan", "roadmap", "quick", "debug", "quality-pass", "debt-sweep", "doubt-pass", "security-pass", "triage")}
    present = {skill["name"] for skill in skills if skill.get("enabled") is True}
    problems = []
    if required - present:
        problems.append("Missing or disabled required skills: " + ", ".join(sorted(required - present)))
    if not any(hook.get("eventName", "").replace("_", "").lower() == "pretooluse" for hook in hooks):
        problems.append("Missing required owned PreToolUse hook")
    for hook in hooks:
        if hook.get("enabled") is not True or hook.get("trustStatus") != "trusted":
            problems.append(f'Owned hook is disabled or untrusted: {hook["key"]}')
    roots = {Path(skill["path"]).resolve().parents[2] for skill in skills}
    roots.update(Path(hook["sourcePath"]).resolve().parent.parent for hook in hooks)
    if len(roots) != 1:
        problems.append("Required skills and hooks do not resolve to one installed payload")
    elif expected_version and next(iter(roots)).name != expected_version:
        problems.append(f"Required installed version is {expected_version}; discovered {next(iter(roots)).name}")
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--codex-dir", type=Path)
    parser.add_argument("--install-marketplace", type=Path)
    parser.add_argument("--trust-owned", action="store_true")
    parser.add_argument("--expected-version")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    environment = dict(os.environ)
    if args.codex_dir:
        environment["CODEX_HOME"] = str(args.codex_dir.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.with_suffix(".stderr.log").open("w") as errors:
        server = subprocess.Popen(["codex", "app-server", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors, text=True, env=environment, cwd=args.project)
        responses = queue.Queue()
        threading.Thread(target=read_responses, args=(server, responses), daemon=True).start()
        try:
            report = {"initialize": call(server, responses, 1, "initialize", {"clientInfo": {"name": "oso_code_codex_validation", "version": "0.1.0"}, "capabilities": {"experimentalApi": True}})}
            if args.install_marketplace:
                report["install"] = call(server, responses, 2, "plugin/install", {"pluginName": "oso-code-codex", "marketplacePath": str(args.install_marketplace.resolve())})
            report["skills"] = call(server, responses, 3, "skills/list", {"cwds": [str(args.project.resolve())], "forceReload": True})
            report["hooks"] = call(server, responses, 4, "hooks/list", {"cwds": [str(args.project.resolve())]})
            owned = owned_hooks(report)
            if args.trust_owned:
                for index, hook in enumerate(owned, 10):
                    call(server, responses, index, "config/value/write", {"keyPath": f'hooks.state."{hook["key"]}"', "value": {"enabled": True, "trusted_hash": hook["currentHash"]}, "mergeStrategy": "replace"})
                report["trustedHooks"] = call(server, responses, 30, "hooks/list", {"cwds": [str(args.project.resolve())]})
            skills = [skill for entry in report["skills"]["data"] for skill in entry["skills"] if (skill.get("pluginId") or "").startswith("oso-code-codex@") and skill.get("name", "").startswith("oso-code-codex:")]
            owned = owned_hooks(report)
            problems = validate_capabilities(skills, owned, args.expected_version)
            report["validation"] = {"status": "fail" if problems else "pass", "problems": problems}
            args.output.write_text(json.dumps(report, indent=2) + "\n")
            if problems:
                raise RuntimeError("; ".join(problems))
            print(json.dumps({"skills": [{"name": skill["name"], "path": skill["path"]} for skill in skills], "hooks": [{"key": hook["key"], "trust": hook["trustStatus"]} for hook in owned], "report": str(args.output)}))
        finally:
            server.stdin.close()
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                server.terminate()
                server.wait(timeout=3)


if __name__ == "__main__":
    main()
