#!/usr/bin/env python3
"""Package the typed Rust example's metadata and explicit prebuilt binary.

Executes no binary or build script. The existing public packager owns path,
capture, byte limits, executable modes and no-overwrite output handling.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return owner


ROOT = Path(__file__).resolve().parent.parent
PACKAGER = module("package_plugin", ROOT / "tooling/package-plugin.py")
SDK = module("prepare_sdk", ROOT / "tooling/prepare-sdk.py")


def captured(path, limit):
    path = Path(os.path.abspath(path))
    fd = PACKAGER.directory(path.parent)
    try:
        return PACKAGER.snapshot(fd, path.name, limit)
    finally:
        os.close(fd)


def prepare(metadata, worker, output):
    encoded, _ = captured(metadata, PACKAGER.MAX_MANIFEST_BYTES)
    # A duplicate generated filename must not silently replace another file.
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate metadata field")
            result[key] = value
        return result

    generated = json.loads(encoded, object_pairs_hook=unique)
    if (not isinstance(generated, dict) or not 2 <= len(generated) <= 32
            or "manifest.json" not in generated or "package-files.json" not in generated
            or any(not isinstance(text, str) for text in generated.values())):
        raise ValueError("invalid generated metadata")
    for name in generated:
        PACKAGER.relative_file(name)
    manifest = json.loads(generated["manifest.json"], object_pairs_hook=unique)
    native = [c for c in manifest["components"] if c["runtime"] == "native-worker"]
    if len(native) != 1:
        raise ValueError("expected one generated native component")
    entrypoint = str(PACKAGER.relative_file(native[0]["entrypoint"]))
    binary, executable = captured(worker, PACKAGER.MAX_BYTES)
    if not executable or not binary:
        raise ValueError("worker is not a nonempty prebuilt executable")
    lock, _ = captured(ROOT / "sdk.lock.json", PACKAGER.MAX_MANIFEST_BYTES)
    if generated.get("sdk/lock.json", "").encode("utf-8") != lock:
        raise ValueError("compiled SDK selector differs from the current verified pin")
    sdk = SDK.prepare(ROOT)
    # Metadata cannot overwrite the captured binary, documentation or SDK pin.
    extras = {
        "README.md": captured(ROOT / "examples/flat-json/README.md", PACKAGER.MAX_MANIFEST_BYTES),
        "LICENSE": captured(ROOT / "examples/flat-json/LICENSE", PACKAGER.MAX_MANIFEST_BYTES),
        "CHANGELOG.md": captured(ROOT / "examples/flat-json/CHANGELOG.md", PACKAGER.MAX_MANIFEST_BYTES),
        "CHANGELOG.zh-CN.md": captured(ROOT / "examples/flat-json/CHANGELOG.zh-CN.md", PACKAGER.MAX_MANIFEST_BYTES),
        "sdk/LICENSE": captured(sdk / "LICENSE", PACKAGER.MAX_MANIFEST_BYTES),
    }
    if entrypoint in extras:
        raise ValueError("worker entrypoint conflicts with captured files")
    extras[entrypoint] = (binary, True)
    if set(generated).intersection(extras):
        raise ValueError("generated metadata conflicts with captured files")
    recipe = json.loads(generated["package-files.json"], object_pairs_hook=unique)
    if (not isinstance(recipe, dict) or set(recipe) != {"formatVersion", "files"}
            or not isinstance(recipe["files"], list)
            or any(not isinstance(name, str) for name in recipe["files"])
            or set(recipe["files"]) != set(generated).union(extras)):
        raise ValueError("recipe does not select the complete captured example")
    if captured(ROOT / "sdk.lock.json", PACKAGER.MAX_MANIFEST_BYTES)[0] != lock:
        raise ValueError("SDK selector changed during preparation")
    # The input snapshot is fixed before creating a private, owned source stage.
    # Output publication retains the existing packager's collision/partial rules.
    with tempfile.TemporaryDirectory(prefix="tsumugi-flat-json-") as temporary:
        stage = Path(temporary)
        fd = PACKAGER.directory(stage)
        try:
            for name, text in generated.items():
                data = text.encode("utf-8")
                PACKAGER.write(fd, name, data if data.endswith(b"\n") else data + b"\n", False)
            for name, (data, mode) in extras.items():
                PACKAGER.write(fd, name, data, mode)
        finally:
            os.close(fd)
        return PACKAGER.package(stage, output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    parser.add_argument("worker", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    files, size = prepare(args.metadata, args.worker, args.output)
    print(f"Materialized {files} files, {size} bytes. Inspect with tsumugi-plugin-package.")
