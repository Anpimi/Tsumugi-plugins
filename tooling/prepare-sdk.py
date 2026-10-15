#!/usr/bin/env python3
"""Materialize the exact public SDK artifact selected by sdk.lock.json."""

import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
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
    source_commit = lock["sourceCommit"]
    if (not isinstance(source_commit, str) or len(source_commit) != 40
            or any(character not in "0123456789abcdef" for character in source_commit)):
        raise ValueError("invalid SDK producer commit")
    # Explicit development snapshots retain their original immutable archives.
    # This is a source provenance selector, not an SDK compatibility fallback.
    canonical = ("artifacts", "sdk", source_commit, f"{package}.crate")
    if archive_path.parts != canonical:
        raise ValueError("invalid SDK archive path")
    archive = root.joinpath(*archive_path.parts)
    if not archive.is_file() or archive.is_symlink() or archive.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("SDK archive is missing or exceeds its limit")
    flags = os.O_RDONLY
    if os.name == "posix":
        flags |= os.O_NOFOLLOW | os.O_NONBLOCK
    elif os.name == "nt":
        flags |= os.O_BINARY
    descriptor = os.open(archive, flags)
    with os.fdopen(descriptor, "rb") as stream:
        selected = os.fstat(stream.fileno())
        if not stat.S_ISREG(selected.st_mode) or selected.st_size > 4 * 1024 * 1024:
            raise ValueError("SDK archive is not a bounded ordinary file")
        archive_bytes = stream.read(4 * 1024 * 1024 + 1)
    if len(archive_bytes) > 4 * 1024 * 1024:
        raise ValueError("SDK archive exceeds its limit")
    if hashlib.sha256(archive_bytes).hexdigest() != lock["sha256"]:
        raise ValueError("SDK archive digest mismatch")

    files = {}
    total = 0
    # Extract the bytes whose digest was checked, rather than reopening a path
    # that could select a different archive after verification.
    with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:gz") as source:
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
        prepare_context_helpers(root, destination)
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
    prepare_context_helpers(root, destination)
    return destination


def bounded_helper_file(path: Path, limit: int) -> bytes:
    flags = os.O_RDONLY
    if os.name == "posix":
        flags |= os.O_NOFOLLOW | os.O_NONBLOCK
    elif os.name == "nt":
        flags |= os.O_BINARY
    with os.fdopen(os.open(path, flags), "rb") as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_size > limit):
            raise ValueError("SDK helper input is not a bounded ordinary file")
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        selected = path.stat(follow_symlinks=False)
        identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_size,
                                 info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)
        if (len(data) > limit or len(data) != after.st_size
                or identity(before) != identity(after) or identity(after) != identity(selected)):
            raise ValueError("SDK helper input changed or exceeded its bound")
        return data


def prepare_context_helpers(root: Path, sdk: Path) -> None:
    """Stage the same SDK helpers selected by each domain's package recipe."""
    def unique(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise ValueError("duplicate SDK helper recipe field")
            result[name] = value
        return result

    plugins = root / "plugins"
    if plugins.is_symlink():
        raise ValueError("Plugin helper parent is a link")
    javascript = sdk / "javascript"
    copies = []
    for package in ("webvtt", "stardew-smapi"):
        plugin = plugins / package
        if plugin.is_symlink():
            raise ValueError("Plugin helper destination is a link")
        if not plugin.is_dir():
            continue
        recipe = json.loads(bounded_helper_file(plugin / "package-files.json", 256 * 1024),
                            object_pairs_hook=unique)
        if (not isinstance(recipe, dict) or set(recipe) != {"formatVersion", "files", "sdkFiles"}
                or type(recipe["formatVersion"]) is not int or recipe["formatVersion"] != 1
                or not isinstance(recipe["files"], list) or not 2 <= len(recipe["files"]) <= 256
                or any(not isinstance(name, str) for name in recipe["files"])
                or not isinstance(recipe["sdkFiles"], list) or len(recipe["sdkFiles"]) > 32):
            raise ValueError("unsupported SDK helper recipe")
        directory = plugin / "sdk"
        if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
            raise ValueError("SDK helper destination is not an ordinary directory")
        sources, targets = set(), set()
        for selected in recipe["sdkFiles"]:
            if (not isinstance(selected, dict) or set(selected) != {"source", "target"}
                    or not isinstance(selected["source"], str)
                    or not isinstance(selected["target"], str)
                    or re.fullmatch(r"(?:LICENSE|javascript/[a-z0-9-]+\.mjs)", selected["source"]) is None
                    or re.fullmatch(r"sdk/(?:LICENSE|[a-z0-9-]+\.mjs)", selected["target"]) is None
                    or selected["source"] in sources or selected["target"] in targets):
                raise ValueError("invalid or duplicate SDK helper selector")
            sources.add(selected["source"])
            targets.add(selected["target"])
            if selected["source"].startswith("javascript/") and (
                    javascript.is_symlink() or not javascript.is_dir()):
                raise ValueError("SDK helper source is not an ordinary directory")
            source = sdk.joinpath(*PurePosixPath(selected["source"]).parts)
            target = plugin.joinpath(*PurePosixPath(selected["target"]).parts)
            if target.is_symlink() or (target.exists() and not target.is_file()):
                raise ValueError("SDK helper destination is not an ordinary file")
            data = bounded_helper_file(source, 1024 * 1024)
            if target.exists() and bounded_helper_file(target, 1024 * 1024) == data:
                continue
            copies.append((target, data))
    # Reject every recipe/selector before modifying any ignored helper output.
    for target, data in copies:
        target.parent.mkdir(exist_ok=True)
        if target.parent.is_symlink() or not target.parent.is_dir():
            raise ValueError("SDK helper destination is not an ordinary directory")
        flags = os.O_WRONLY | os.O_CREAT
        if os.name == "posix":
            flags |= os.O_NOFOLLOW | os.O_NONBLOCK
        elif os.name == "nt":
            flags |= os.O_BINARY
        with os.fdopen(os.open(target, flags, 0o600), "wb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_size > 1024 * 1024):
                raise ValueError("SDK helper destination is not a bounded ordinary file")
            stream.truncate(0)
            stream.write(data)


if __name__ == "__main__":
    try:
        selected = prepare(Path(__file__).resolve().parent.parent)
        print(f"Prepared {selected.name} from the verified SDK artifact")
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print(f"SDK preparation failed: {error}", file=sys.stderr)
        sys.exit(1)
