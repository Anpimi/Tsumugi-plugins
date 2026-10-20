#!/usr/bin/env python3
"""Materialize an explicit prebuilt file set; the public Host owns its digest."""

import argparse
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys


MAX_FILES = 256
MAX_BYTES = 64 * 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024


def relative_file(value):
    if not isinstance(value, str) or not value.isascii():
        raise ValueError("package file names must be ASCII relative paths")
    path = PurePosixPath(value)
    if (not value or path.is_absolute() or str(path) != value
            or any(part in {".", ".."} for part in path.parts)
            or "\\" in value or len(path.parts) > 16):
        raise ValueError("package file name is not canonical")
    for part in path.parts:
        stem = part.split(".")[0].upper()
        if (part.endswith((".", " ")) or any(ord(c) < 32 or c in ':*?"<>|' for c in part)
                or stem in {"CON", "PRN", "AUX", "NUL"}
                or len(stem) == 4 and stem[:3] in {"COM", "LPT"} and stem[3] in "123456789"):
            raise ValueError("package file name is not portable")
    return path


def directory(path):
    """Hold every selected ancestor without resolving a hidden symbolic link."""
    absolute = Path(os.path.abspath(path))
    if sys.platform == "darwin" and len(absolute.parts) > 1 and absolute.parts[1] in {"var", "tmp"}:
        alias = "/" + absolute.parts[1]
        if os.path.islink(alias) and os.path.normpath(os.path.join("/", os.readlink(alias))) == "/private" + alias:
            absolute = Path("/private" + alias).joinpath(*absolute.parts[2:])
    held = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in absolute.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=held)
            os.close(held)
            held = child
        return held
    except BaseException:
        os.close(held)
        raise


def snapshot(root_fd, name, limit):
    path = relative_file(name)
    held = os.dup(root_fd)
    try:
        for part in path.parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=held)
            os.close(held)
            held = child
        file_fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=held)
        try:
            before = os.fstat(file_fd)
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
                raise ValueError("selected package file is not a bounded ordinary file")
            chunks = []
            size = 0
            while chunk := os.read(file_fd, min(65536, limit - size + 1)):
                chunks.append(chunk)
                size += len(chunk)
                if size > limit:
                    raise ValueError("selected package file exceeds its bound")
            after = os.fstat(file_fd)
            selected = os.stat(path.name, dir_fd=held, follow_symlinks=False)
            identity = lambda info: (info.st_dev, info.st_ino, info.st_mode, info.st_size,
                                     info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)
            if identity(before) != identity(after) or identity(after) != identity(selected):
                raise ValueError("selected package file changed while read")
            return b"".join(chunks), bool(before.st_mode & 0o111)
        finally:
            os.close(file_fd)
    finally:
        os.close(held)


def write(output_fd, name, data, executable):
    path = relative_file(name)
    held = os.dup(output_fd)
    try:
        for part in path.parts[:-1]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=held)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=held)
            os.close(held)
            held = child
        target = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                         0o700 if executable else 0o600, dir_fd=held)
        with os.fdopen(target, "wb") as stream:
            stream.write(data)
    finally:
        os.close(held)


def package(source, output):
    source_fd = directory(source)
    try:
        recipe_bytes, _ = snapshot(source_fd, "package-files.json", MAX_MANIFEST_BYTES)
        recipe = json.loads(recipe_bytes)
        if (not isinstance(recipe, dict) or set(recipe) not in (
                {"formatVersion", "files"}, {"formatVersion", "files", "sdkFiles"})
                or type(recipe["formatVersion"]) is not int or recipe["formatVersion"] != 1
                or not isinstance(recipe["files"], list)
                or not 2 <= len(recipe["files"]) <= MAX_FILES):
            raise ValueError("unsupported package file recipe")
        names = [str(relative_file(name)) for name in recipe["files"]]
        sdk_files = recipe.get("sdkFiles", [])
        if not isinstance(sdk_files, list) or len(sdk_files) > 32:
            raise ValueError("invalid SDK file recipe")
        for selected in sdk_files:
            if not isinstance(selected, dict) or set(selected) != {"source", "target"}:
                raise ValueError("invalid SDK file selector")
            relative_file(selected["source"])
            names.append(str(relative_file(selected["target"])))
        if sdk_files:
            names.append("sdk/lock.json")
        if len(names) > MAX_FILES:
            raise ValueError("package exceeds its file limit")
        folded = sorted(name.lower() for name in names)
        if ("manifest.json" not in names or len(set(folded)) != len(names)
                or any(other.startswith(name + "/") for name, other in zip(folded, folded[1:]))):
            raise ValueError("package file names overlap or omit manifest.json")
        files = {}
        total = 0
        for name in sorted(recipe["files"]):
            data, executable = snapshot(source_fd, name,
                                        MAX_MANIFEST_BYTES if name == "manifest.json" else MAX_BYTES)
            total += len(data)
            if total > MAX_BYTES:
                raise ValueError("package exceeds its byte limit")
            files[name] = (data, executable)
        # Check the complete selected file set a second time, including the
        # recipe. Neither read grants a package publisher or execution approval.
        if snapshot(source_fd, "package-files.json", MAX_MANIFEST_BYTES)[0] != recipe_bytes:
            raise ValueError("package recipe changed while captured")
        for name, captured in files.items():
            if snapshot(source_fd, name, MAX_BYTES) != captured:
                raise ValueError("package file set changed while captured")
    finally:
        os.close(source_fd)

    if sdk_files:
        # The SDK consumer owner verifies the whole immutable archive and cache.
        # Runtime packages include selected generated helpers, their license and
        # exact provenance; the domain repository does not edit those helpers.
        repository = Path(__file__).resolve().parent.parent
        repository_fd = directory(repository)
        try:
            lock = snapshot(repository_fd, "sdk.lock.json", MAX_MANIFEST_BYTES)
        finally:
            os.close(repository_fd)
        spec = importlib.util.spec_from_file_location("prepare_sdk", repository / "tooling" / "prepare-sdk.py")
        owner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(owner)
        sdk_root, verified_files = owner.prepare_with_files(repository)
        sdk_fd = directory(sdk_root)
        try:
            for selected in sdk_files:
                captured = snapshot(sdk_fd, selected["source"], MAX_BYTES)
                if snapshot(sdk_fd, selected["source"], MAX_BYTES) != captured:
                    raise ValueError("selected SDK file changed while captured")
                expected = verified_files.get(selected["source"])
                if (expected is None or captured[0] != expected[0]
                        or (os.name == "posix" and captured[1] != expected[1])):
                    raise ValueError("selected SDK file differs from the verified artifact")
                # The immutable archive, not mutable cache metadata, owns flags.
                files[selected["target"]] = expected
                total += len(expected[0])
        finally:
            os.close(sdk_fd)
        repository_fd = directory(repository)
        try:
            if snapshot(repository_fd, "sdk.lock.json", MAX_MANIFEST_BYTES) != lock:
                raise ValueError("SDK selection changed while packaged")
        finally:
            os.close(repository_fd)
        files["sdk/lock.json"] = lock
        total += len(lock[0])
        if total > MAX_BYTES:
            raise ValueError("package exceeds its byte limit")

    destination = Path(os.path.abspath(output))
    parent_fd = directory(destination.parent)
    try:
        # An existing destination is always refused, even if empty. On failure
        # retain this attempt's partial directory for explicit inspection; never
        # recursively remove a path that another process may have replaced.
        os.mkdir(destination.name, mode=0o700, dir_fd=parent_fd)
        output_fd = os.open(destination.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=parent_fd)
        try:
            for name, (data, executable) in files.items():
                write(output_fd, name, data, executable)
        finally:
            os.close(output_fd)
    finally:
        os.close(parent_fd)
    return len(files), total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="plugin directory with package-files.json")
    parser.add_argument("output", type=Path, help="new directory beneath an existing parent")
    args = parser.parse_args()
    count, size = package(args.source, args.output)
    print(f"Materialized {count} files, {size} bytes. Inspect with tsumugi-plugin-package.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, UnicodeError) as error:
        print(f"Plugin packaging failed: {error}", file=sys.stderr)
        sys.exit(1)
