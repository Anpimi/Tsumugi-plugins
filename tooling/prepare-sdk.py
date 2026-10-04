#!/usr/bin/env python3
"""Materialize the exact public SDK artifact selected by sdk.lock.json."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import tempfile


def prepare(root: Path) -> Path:
    lock = json.loads((root / "sdk.lock.json").read_text(encoding="utf-8"))
    if lock["formatVersion"] != 1 or lock["package"] != "tsumugi-plugin-sdk":
        raise ValueError("unsupported SDK lock")
    package = f'{lock["package"]}-{lock["version"]}'
    if "/" in package or "\\" in package or package in {".", ".."}:
        raise ValueError("invalid SDK package identity")
    archive_path = PurePosixPath(lock["archive"])
    if archive_path.parts != ("artifacts", "sdk", f"{package}.crate"):
        raise ValueError("invalid SDK archive path")
    archive = root.joinpath(*archive_path.parts)
    if not archive.is_file() or archive.is_symlink() or archive.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("SDK archive is missing or exceeds its limit")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != lock["sha256"]:
        raise ValueError("SDK archive digest mismatch")

    files = {}
    total = 0
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (not member.isfile() or not path.parts or path.parts[0] != package
                    or len(path.parts) < 2 or any(part in {".", ".."} for part in path.parts)
                    or path.is_absolute() or "\\" in member.name
                    or str(path) != member.name or member.name in files):
                raise ValueError("SDK archive contains a noncanonical file")
            total += member.size
            if len(files) >= 256 or member.size < 0 or total > 16 * 1024 * 1024:
                raise ValueError("SDK archive exceeds its extraction limit")
            stream = source.extractfile(member)
            if stream is None:
                raise ValueError("SDK archive file is unreadable")
            with stream:
                data = stream.read(member.size + 1)
            if len(data) != member.size:
                raise ValueError("SDK archive file size mismatch")
            files[member.name] = data
    if not files or f"{package}/Cargo.toml" not in files:
        raise ValueError("SDK archive has no package manifest")

    cache = root / ".cache"
    sdk_cache = cache / "sdk"
    for directory in (cache, sdk_cache):
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise ValueError("SDK cache path is not an ordinary directory")
        directory.mkdir(exist_ok=True)
    destination = sdk_cache / package
    if destination.is_symlink():
        raise ValueError("SDK cache package is a link")
    if destination.exists():
        if not destination.is_dir():
            raise ValueError("SDK cache package is not a directory")
        found = {}
        for directory, names, filenames in os.walk(destination, followlinks=False):
            base = Path(directory)
            if any((base / name).is_symlink() for name in names + filenames):
                raise ValueError("SDK cache contains a link")
            for name in filenames:
                path = base / name
                key = f"{package}/{path.relative_to(destination).as_posix()}"
                if key not in files or not path.is_file() or path.stat().st_size != len(files[key]):
                    raise ValueError("SDK cache contains an unexpected file")
                found[key] = path.read_bytes()
        if found != files:
            raise ValueError("SDK cache differs from the selected artifact; remove it explicitly")
        return destination

    candidate = Path(tempfile.mkdtemp(prefix="prepare-", dir=sdk_cache))
    try:
        for name, data in files.items():
            path = candidate.joinpath(*PurePosixPath(name).parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as output:
                output.write(data)
        if destination.exists() or destination.is_symlink():
            raise ValueError("SDK cache appeared during preparation; rerun to verify it")
        (candidate / package).rename(destination)
    finally:
        shutil.rmtree(candidate)
    return destination


if __name__ == "__main__":
    try:
        selected = prepare(Path(__file__).resolve().parent.parent)
        print(f"Prepared {selected.name} from the verified SDK artifact")
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print(f"SDK preparation failed: {error}", file=sys.stderr)
        sys.exit(1)
