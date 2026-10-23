#!/usr/bin/env python3
"""Prepare frozen pnpm dependency files through the shared packaging IO owner."""
import importlib.util
import json
import os
from pathlib import Path

plugin = Path(__file__).resolve().parent.parent
repository = plugin.parent.parent
spec = importlib.util.spec_from_file_location("package_plugin", repository / "tooling/package-plugin.py")
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
# pnpm's declared dependency is intentionally a link into its own virtual store.
# Resolve that one development dependency; generated/export ancestors are never
# resolved, and every retained source/output file is checked by the shared owner.
selected = (plugin / "node_modules/jsonc-parser").resolve(strict=True)
selected.relative_to(plugin / "node_modules")
source_fd = owner.directory(selected)
plugin_fd = owner.directory(plugin)
try:
    data, _ = owner.snapshot(source_fd, "package.json", 256 * 1024)
    metadata = json.loads(data)
    if (metadata.get("name") != "jsonc-parser" or metadata.get("version") != "3.3.1"
            or metadata.get("license") != "MIT" or metadata.get("dependencies", {})):
        raise ValueError("Unexpected parser dependency; use the frozen pnpm lockfile")
    names = ["package.json", "LICENSE.md", "lib/umd/main.js", "lib/umd/impl/edit.js",
             "lib/umd/impl/format.js", "lib/umd/impl/parser.js", "lib/umd/impl/scanner.js",
             "lib/umd/impl/string-intern.js"]
    for name in names:
        captured = owner.snapshot(source_fd, name, 256 * 1024)
        target = ".generated/jsonc-parser/" + name
        try:
            owner.write(plugin_fd, target, captured[0], False)
        except FileExistsError:
            if owner.snapshot(plugin_fd, target, 256 * 1024) != (captured[0], False):
                raise ValueError("Prepared parser differs; preserve it before preparing anew")
        if owner.snapshot(source_fd, name, 256 * 1024) != captured:
            raise ValueError("Parser dependency changed while prepared")
finally:
    os.close(source_fd)
    os.close(plugin_fd)
print("Prepared jsonc-parser 3.3.1 with its MIT license")
