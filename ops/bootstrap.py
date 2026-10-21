#!/usr/bin/env python3
"""Install checksum-pinned local tools without changing global installations."""
import hashlib
import json
import pathlib
import platform
import tarfile
import urllib.request

if (platform.system(), platform.machine()) != ("Darwin", "arm64"):
    raise SystemExit("This verified bootstrap profile is macOS arm64 only; add audited platform pins before use.")

root = pathlib.Path(__file__).resolve().parent.parent
tools = root / ".tools"
tools.mkdir(exist_ok=True)
for item in json.loads((root / "ops/toolchain-downloads.json").read_text()):
    name = item["name"]
    archive = tools / item["url"].rsplit("/", 1)[1]
    if not archive.exists():
        print(f"Downloading {name}", flush=True)
        urllib.request.urlretrieve(item["url"], archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != item["sha256"]:
        raise SystemExit(f"Checksum mismatch: {archive}; remove it before retrying")
    if name == "anchor":
        target = tools / "bin"
        target.mkdir(exist_ok=True)
        (target / "anchor").write_bytes(archive.read_bytes())
        (target / "anchor").chmod(0o755)
    else:
        target = tools / name
        target.mkdir(exist_ok=True)
        with tarfile.open(archive) as stream:
            stream.extractall(target, filter="data")
    print(f"Verified {name}: {item['sha256']}", flush=True)
