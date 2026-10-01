#!/usr/bin/env python3
"""Create, serve and identify the isolated execution-reliability fixture."""

import argparse
import hashlib
import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
from urllib.parse import unquote, urlparse


SOURCE_FILES = (
    "labels.mjs",
    "labels.test.mjs",
    "index.html",
    "app.html",
    "ui.mjs",
    "package.json",
)
FIXTURE_AUTHOR = "Oso Evaluation Fixture <fixture@oso.invalid>"


def fixture_directory():
    return Path(__file__).resolve().parent.parent / "test" / "fixtures" / "execution-reliability"


def require_fixture(project):
    missing = [name for name in SOURCE_FILES if not (project / name).is_file()]
    if missing:
        raise ValueError("Fixture is missing source files: " + ", ".join(missing))


def copy_fixture(project):
    template = fixture_directory()
    require_fixture(template)
    for name in SOURCE_FILES:
        (project / name).write_bytes((template / name).read_bytes())


def run(command):
    subprocess.run(command, check=True)


def initialize(project):
    if project.exists():
        raise ValueError(f"Refusing to overwrite existing destination: {project}")
    project.parent.mkdir(parents=True, exist_ok=True)
    project.mkdir()
    copy_fixture(project)
    run(["git", "init", str(project)])
    run(["git", "-C", str(project), "add", *SOURCE_FILES])
    run([
        "git",
        "-C",
        str(project),
        "-c",
        "user.name=Oso Evaluation Fixture",
        "-c",
        "user.email=fixture@oso.invalid",
        "commit",
        f"--author={FIXTURE_AUTHOR}",
        "-m",
        "synthetic baseline",
    ])
    print(json.dumps({"project": str(project), "baseline": "synthetic baseline"}))


def source_identity(project):
    require_fixture(project)
    files = {}
    combined = hashlib.sha256()
    for name in SOURCE_FILES:
        digest = hashlib.sha256((project / name).read_bytes()).hexdigest()
        files[name] = digest
        combined.update(f"{name}\0{digest}\n".encode())
    return {"identity": combined.hexdigest(), "files": files}


def serve(project, port):
    require_fixture(project)

    class FixtureHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_fixture()

        def do_HEAD(self):
            self.send_fixture(headers_only=True)

        def send_fixture(self, headers_only=False):
            path = unquote(urlparse(self.path).path)
            name = "index.html" if path == "/" else path.removeprefix("/")
            if name not in SOURCE_FILES or "/" in name:
                self.send_error(404)
                return
            content = (project / name).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if not headers_only:
                self.wfile.write(content)

    server = ThreadingHTTPServer(("127.0.0.1", port), FixtureHandler)
    print(f"http://127.0.0.1:{server.server_port}/", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init_parser = commands.add_parser("init")
    init_parser.add_argument("--project", type=Path, required=True)
    serve_parser = commands.add_parser("serve")
    serve_parser.add_argument("--project", type=Path, required=True)
    serve_parser.add_argument("--port", type=int, default=0)
    inspect_parser = commands.add_parser("inspect")
    inspect_parser.add_argument("--project", type=Path, required=True)
    args = parser.parse_args()
    project = args.project.expanduser().resolve()
    if args.command == "init":
        initialize(project)
    elif args.command == "serve":
        serve(project, args.port)
    else:
        print(json.dumps(source_identity(project), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"execution-reliability fixture: {error}", file=sys.stderr)
        sys.exit(1)
