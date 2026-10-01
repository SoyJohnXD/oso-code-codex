#!/usr/bin/env python3
"""Install, update or remove only OsoCode for Codex's owned local files."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tomllib


PLUGIN = "oso-code-codex"


def install(source, target, native):
    validate_native_target(target, native)
    receipt_path = target / ".local/state/oso-code-codex-install/receipt.json"
    validate_destination(receipt_path, target)
    previous = load_json(receipt_path) if receipt_path.exists() else None
    if previous and previous['target'] != str(target):
        raise ValueError('Installation receipt belongs to another directory')
    payload_root = target / "plugins" / PLUGIN
    marketplace_path = target / ".agents/plugins/marketplace.json"
    validate_destination(marketplace_path, target)
    marketplace = load_json(marketplace_path) if marketplace_path.exists() else {"name": "personal", "interface": {"displayName": "Personal"}, "plugins": []}
    if not isinstance(marketplace.get("name"), str) or not isinstance(marketplace.get("plugins"), list):
        raise ValueError("Invalid personal marketplace; no changes were applied")
    entries = [entry for entry in marketplace["plugins"] if entry.get("name") == PLUGIN]
    if len(entries) > 1:
        raise ValueError("Duplicate owned marketplace entries; inspect them before installation")
    expected_source = {"source": "local", "path": f"./plugins/{PLUGIN}"}
    if entries and entries[0].get("source") != expected_source:
        raise ValueError("Existing OsoCode Codex entry points elsewhere; no source was overwritten")
    if entries and not previous:
        raise ValueError("Existing entry is not owned by this installer; no changes were applied")
    files = collect_payload(source, payload_root, target)
    owned = previous["files"] if previous else {}
    pending = previous.get('pendingFiles', {}) if previous else {}
    if pending and pending != {filename: sha256(content) for filename, content in files.items()}:
        raise ValueError('Interrupted installation has a different payload; resume that source version or remove its owned partial installation first')
    known = owned | pending
    for filename, content in files.items():
        destination = Path(filename)
        validate_destination(destination, target)
        if destination.exists() and sha256(destination.read_bytes()) not in {owned.get(filename), pending.get(filename)}:
            raise ValueError(f"Unowned or locally modified file preserved: {destination}")
    for filename in known:
        validate_destination(Path(filename), target)
        if filename not in files and Path(filename).exists() and sha256(Path(filename).read_bytes()) not in {owned.get(filename), pending.get(filename)}:
            raise ValueError(f"Modified retired file preserved: {filename}")
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    if previous:
        backup = receipt_path.parent / "backups" / previous["version"]
        for filename in owned:
            original = Path(filename)
            if original.exists():
                saved = backup / original.relative_to(target)
                saved.parent.mkdir(parents=True, exist_ok=True)
                if not saved.exists():
                    saved.write_bytes(original.read_bytes())
    receipt = {"version": load_json(source / ".codex-plugin/plugin.json")["version"], "target": str(target), "source": str(source), "marketplace": marketplace["name"], "files": {filename: sha256(content) for filename, content in files.items()}, "native": bool(previous and previous.get("native")), "createdMarketplace": previous["createdMarketplace"] if previous else not marketplace_path.exists()}
    save_json(receipt_path, receipt | {'files': owned, 'pendingFiles': receipt['files'], 'phase': 'installing'})
    for filename, content in files.items():
        destination = Path(filename)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + f'.install-{os.getpid()}')
        temporary.write_bytes(content)
        temporary.replace(destination)
    launcher = target / ".local/bin/oso-codex"
    launcher.chmod(0o755)
    for filename in known:
        if filename not in files:
            Path(filename).unlink(missing_ok=True)
    if not entries:
        marketplace["plugins"].append({"name": PLUGIN, "source": expected_source, "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Developer Tools"})
        save_json(marketplace_path, marketplace)
    if native:
        subprocess.run(["codex", "plugin", "add", f"{PLUGIN}@{marketplace['name']}", "--json"], check=True)
        receipt['native'] = True
    save_json(receipt_path, receipt)
    print(json.dumps({"installed": str(payload_root), "marketplace": str(marketplace_path), "receipt": str(receipt_path), "native": native}))


def remove(target, native):
    validate_native_target(target, native)
    receipt_path = target / ".local/state/oso-code-codex-install/receipt.json"
    validate_destination(receipt_path, target)
    receipt = load_json(receipt_path)
    if receipt["target"] != str(target):
        raise ValueError("Installation receipt belongs to another directory")
    pending = receipt.get('pendingFiles', {})
    known = receipt['files'] | pending
    for filename in known:
        destination = Path(filename)
        validate_destination(destination, target)
        if destination.exists() and sha256(destination.read_bytes()) not in {receipt['files'].get(filename), pending.get(filename)}:
            raise ValueError(f"Locally modified file preserved; removal stopped before changing files: {filename}")
    marketplace_path = target / '.agents/plugins/marketplace.json'
    validate_destination(marketplace_path, target)
    marketplace_existed = marketplace_path.exists()
    marketplace = load_json(marketplace_path) if marketplace_path.exists() else {'plugins': []}
    entries = [entry for entry in marketplace['plugins'] if entry.get('name') == PLUGIN]
    if any(entry.get('source') != {'source': 'local', 'path': f'./plugins/{PLUGIN}'} for entry in entries):
        raise ValueError('Modified marketplace entry preserved; removal stopped before changing files')
    config_path = target / '.codex/config.toml'
    config = tomllib.loads(config_path.read_text()) if config_path.exists() else {}
    if native and f"{PLUGIN}@{receipt['marketplace']}" in config.get('plugins', {}):
        subprocess.run(["codex", "plugin", "remove", f"{PLUGIN}@{receipt['marketplace']}", "--json"], check=True)
    for filename in known:
        Path(filename).unlink(missing_ok=True)
    marketplace["plugins"] = [entry for entry in marketplace["plugins"] if entry.get("name") != PLUGIN]
    if receipt["createdMarketplace"] and not marketplace["plugins"]:
        marketplace_path.unlink(missing_ok=True)
    elif marketplace_existed:
        save_json(marketplace_path, marketplace)
    receipt_path.unlink()
    print(json.dumps({"removed": PLUGIN, "preserved": "unowned files, settings, integrations and run records"}))


def validate_native_target(target, native):
    if native and target != Path.home().resolve():
        raise ValueError('Native installation requires the real user directory; use --stage-only for isolated tests')


def validate_destination(destination, target):
    destination.relative_to(target)
    for candidate in [destination, *destination.parents]:
        if candidate == target:
            break
        if candidate.is_symlink():
            raise ValueError(f'Symbolic link preserved: {candidate}')


def collect_payload(source, payload_root, target):
    files = {}
    for folder in [".codex-plugin", "skills", "references", "hooks", "dist", "agents"]:
        for original in sorted((source / folder).rglob("*")):
            if original.is_symlink():
                raise ValueError(f"Source payload contains an unreviewed symbolic link: {original}")
            if original.is_file():
                files[str(payload_root / original.relative_to(source))] = original.read_bytes()
    for name in ["LICENSE", "NOTICE", "README.md"]:
        original = source / name
        if original.exists():
            files[str(payload_root / name)] = original.read_bytes()
    for role in sorted((source / "agents").glob("*.toml")):
        files[str(target / ".codex/agents" / role.name)] = role.read_text().replace("__PLUGIN_ROOT__", str(payload_root).replace("\\", "\\\\").replace('"', '\\"')).encode()
    files[str(target / ".local/bin/oso-codex")] = f"#!/bin/sh\nexec node {shlex.quote(str(payload_root / 'dist/oso-codex.cjs'))} \"$@\"\n".encode()
    return files


def sha256(content):
    return hashlib.sha256(content).hexdigest()


def load_json(filename):
    return json.loads(filename.read_text())


def save_json(filename, content):
    filename.parent.mkdir(parents=True, exist_ok=True)
    temporary = filename.with_suffix(f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(content, indent=2) + "\n")
    temporary.replace(filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["install", "remove"])
    parser.add_argument("--target", type=Path, default=Path.home())
    parser.add_argument("--stage-only", action="store_true")
    args = parser.parse_args()
    target = args.target.expanduser().resolve()
    if args.action == "install":
        install(Path(__file__).resolve().parent.parent, target, not args.stage_only)
    else:
        remove(target, not args.stage_only)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"oso-code-codex installer: {error}", file=sys.stderr)
        sys.exit(1)
