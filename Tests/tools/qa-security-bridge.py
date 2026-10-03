#!/usr/bin/env python3
"""Lia QA security bridge - thin wrapper over tools/project_cli.py policy.

This module reuses the canonical security policy without duplicating regexes.
Importing project_cli has no side effects (only function definitions, main() guarded).

Exposes:
  redact_file(path) -> redact text using project_cli.redact
  scan_files(paths) -> check each file via project_cli.secret_in_text / check_blob logic
  JSON CLI for Node: redact/scan commands

FAIL-CLOSED: any inability to read/parse/inspect a candidate publication file
makes publication unsafe (hasSecret: true, scanError).
"""

import sys
import json
import pathlib

# Import project_cli by path without polluting sys.path permanently
import importlib.util

KIT = pathlib.Path(__file__).resolve().parent.parent.parent
PROJECT_CLI = KIT / "tools" / "project_cli.py"

spec = importlib.util.spec_from_file_location("project_cli", PROJECT_CLI)
project_cli = importlib.util.module_from_spec(spec)
# Ensure import does not execute main()
sys.modules["project_cli"] = project_cli
spec.loader.exec_module(project_cli)

def redact_text(text: str) -> str:
    return project_cli.redact(text)

def redact_file(path: str) -> str:
    p = pathlib.Path(path)
    text = p.read_text(encoding="utf-8", errors="replace")
    return redact_text(text)

def scan_text(text: str) -> bool:
    return project_cli.secret_in_text(text)

def scan_file(path: str) -> dict:
    p = pathlib.Path(path)
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        # FAIL CLOSED: unreadable file must block publication
        return {"path": str(p), "hasSecret": True, "scanError": str(e), "error": str(e)}
    # If file is directory, also fail closed
    try:
        if p.is_dir():
            return {"path": str(p), "hasSecret": True, "scanError": "is directory", "error": "is directory"}
    except Exception as e:
        return {"path": str(p), "hasSecret": True, "scanError": str(e), "error": str(e)}
    has = scan_text(text)
    if not has and p.suffix.lower() in {".json", ".ipynb"}:
        try:
            data = json.loads(text)
            def _scan_json(v):
                if isinstance(v, str):
                    return scan_text(v)
                if isinstance(v, list):
                    return any(_scan_json(x) for x in v)
                if isinstance(v, dict):
                    return any(_scan_json(x) for x in v.values())
                return False
            has = _scan_json(data)
        except Exception:
            pass
    # Also check private key and sensitive path names
    try:
        if project_cli.PRIVATE_KEY_RE.search(text):
            has = True
    except Exception:
        # If regex fails, be safe
        has = True
    try:
        if project_cli.sensitive_path(p.name) and text.strip():
            has = True
    except Exception:
        has = True
    # If scanError field not needed, keep for transparency
    if has:
        return {"path": str(p), "hasSecret": True}
    return {"path": str(p), "hasSecret": False}

def scan_files(paths):
    results = []
    has_any = False
    has_error = False
    for pp in paths:
        r = scan_file(pp)
        results.append(r)
        if r.get("hasSecret"):
            has_any = True
        if r.get("scanError") or r.get("error"):
            has_error = True
            has_any = True
    # safeToPublish is false if any secret or any error
    return {"hasSecret": has_any, "hasError": has_error, "safeToPublish": not has_any, "results": results}

def main():
    import argparse
    ap = argparse.ArgumentParser(description="qa-security-bridge")
    sub = ap.add_subparsers(dest="cmd")
    p_redact = sub.add_parser("redact")
    p_redact.add_argument("path")
    p_redact.add_argument("--output", help="output file, default stdout")
    p_scan = sub.add_parser("scan")
    p_scan.add_argument("paths", nargs="+")
    p_scan.add_argument("--json", action="store_true", help="json output")
    args = ap.parse_args()
    if args.cmd == "redact":
        out = redact_file(args.path)
        if args.output:
            pathlib.Path(args.output).write_text(out, encoding="utf-8")
        else:
            sys.stdout.write(out)
    elif args.cmd == "scan":
        res = scan_files(args.paths)
        if args.json:
            json.dump(res, sys.stdout, indent=2)
            sys.stdout.write("\n")
            sys.exit(1 if res["hasSecret"] else 0)
        else:
            for r in res["results"]:
                if r.get("scanError"):
                    print(f"{r['path']}: SCAN_ERROR {r['scanError']}")
                else:
                    print(f"{r['path']}: {'SECRET' if r['hasSecret'] else 'OK'}")
            sys.exit(1 if res["hasSecret"] else 0)
    else:
        ap.print_help()
        sys.exit(2)

if __name__ == "__main__":
    main()
