import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "prepare_sdk", Path(__file__).parents[1] / "prepare-sdk.py"
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class PreparationTests(unittest.TestCase):
    def source(self, temporary):
        root = Path(temporary)
        package = "tsumugi-plugin-sdk-0.1.0-alpha.1"
        commit = "a" * 40
        archive = root / "artifacts" / "sdk" / commit / (package + ".crate")
        archive.parent.mkdir(parents=True)
        files = {"Cargo.toml": b'[package]\nname = "tsumugi-plugin-sdk"\n',
                 "src/lib.rs": b"pub struct CapturedSource;\n",
                 "javascript/source-context.mjs": b"export const encoder = true;\n",
                 "javascript/source-context-profile.mjs": b"export const profile = true;\n",
                 "javascript/validate-source-context-facts.mjs": b"export const shape = true;\n"}
        for package_dir in ("webvtt", "stardew-smapi"):
            plugin = root / "plugins" / package_dir
            plugin.mkdir(parents=True)
            recipe_bytes = (Path(__file__).parents[2] / "plugins" / package_dir / "package-files.json").read_bytes()
            (plugin / "package-files.json").write_bytes(recipe_bytes)
            for selected in json.loads(recipe_bytes)["sdkFiles"]:
                files.setdefault(selected["source"], ("synthetic verified " + selected["source"] + "\n").encode())
        with tarfile.open(archive, "w:gz") as target:
            for name, data in files.items():
                member = tarfile.TarInfo(package + "/" + name)
                member.size = len(data)
                target.addfile(member, io.BytesIO(data))
        lock = {"formatVersion": 1, "package": "tsumugi-plugin-sdk",
                "version": "0.1.0-alpha.1", "sourceCommit": commit,
                "archive": archive.relative_to(root).as_posix(),
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}
        (root / "sdk.lock.json").write_text(json.dumps(lock), encoding="utf-8")
        return root, archive, lock, files

    def test_verified_bytes_are_materialized_and_existing_cache_is_rechecked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, _, _, files = self.source(temporary)
            cache = owner.prepare(root)
            self.assertEqual({p.relative_to(cache).as_posix(): p.read_bytes()
                              for p in cache.rglob("*") if p.is_file()}, files)
            for package_dir in ("webvtt", "stardew-smapi"):
                plugin = root / "plugins" / package_dir
                recipe = json.loads((plugin / "package-files.json").read_bytes())
                self.assertEqual({p.name for p in (plugin / "sdk").iterdir()},
                                 {Path(selected["target"]).name for selected in recipe["sdkFiles"]})
                for selected in recipe["sdkFiles"]:
                    self.assertEqual((plugin / selected["target"]).read_bytes(), files[selected["source"]])
                self.assertEqual((plugin / "sdk/validate-review-check-input.mjs").read_bytes(),
                                 files["javascript/validate-review-check-input.mjs"])
            self.assertEqual(owner.prepare(root), cache)
            (cache / "src/lib.rs").write_bytes(b"different contract\n")
            with self.assertRaisesRegex(ValueError, "SDK cache"):
                owner.prepare(root)
            self.assertEqual((cache / "src/lib.rs").read_bytes(), b"different contract\n")

    def test_invalid_helper_selectors_never_write_helpers_or_escape_the_plugin(self):
        ordinary = {"source": "LICENSE", "target": "sdk/LICENSE"}
        invalid = [
            [{"source": "../outside.mjs", "target": "sdk/helper.mjs"}],
            [{"source": "javascript/../outside.mjs", "target": "sdk/helper.mjs"}],
            [{"source": "javascript//helper.mjs", "target": "sdk/helper.mjs"}],
            [{"source": "Cargo.toml", "target": "sdk/helper.mjs"}],
            [{"source": "javascript/validate-review-check-input.mjs", "target": "../outside.mjs"}],
            [{"source": "LICENSE", "target": "sdk/../outside.mjs"}],
            [{"source": "LICENSE", "target": "sdk/nested/helper.mjs"}],
            [{"source": None, "target": "sdk/helper.mjs"}],
            [ordinary, ordinary],
            [ordinary, {"source": "LICENSE", "target": "sdk/other.mjs"}],
            [ordinary, {"source": "javascript/validate-review-check-input.mjs", "target": "sdk/LICENSE"}],
        ]
        for selectors in invalid:
            with self.subTest(selectors=selectors), tempfile.TemporaryDirectory() as temporary:
                root, _, _, _ = self.source(temporary)
                outside = root / "plugins/stardew-smapi/outside.mjs"
                outside.write_bytes(b"preserve unrelated bytes\n")
                recipe_path = root / "plugins/stardew-smapi/package-files.json"
                recipe = json.loads(recipe_path.read_bytes())
                recipe["sdkFiles"] = selectors
                recipe_path.write_text(json.dumps(recipe), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "SDK helper selector"):
                    owner.prepare(root)
                self.assertEqual(outside.read_bytes(), b"preserve unrelated bytes\n")
                for package_dir in ("webvtt", "stardew-smapi"):
                    self.assertFalse((root / "plugins" / package_dir / "sdk").exists())

    def test_helper_recipe_is_bounded_and_rejects_duplicate_fields(self):
        for oversized in (False, True):
            with self.subTest(oversized=oversized), tempfile.TemporaryDirectory() as temporary:
                root, _, _, _ = self.source(temporary)
                path = root / "plugins/stardew-smapi/package-files.json"
                if oversized:
                    path.write_bytes(b" " * (256 * 1024 + 1))
                else:
                    original = path.read_text(encoding="utf-8")
                    path.write_text(original.rstrip()[:-1] + ', "sdkFiles": []}', encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "bounded|duplicate"):
                    owner.prepare(root)
                self.assertFalse((root / "plugins/webvtt/sdk").exists())
                self.assertFalse((root / "plugins/stardew-smapi/sdk").exists())

    def test_digest_mismatch_never_creates_a_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, _, _ = self.source(temporary)
            archive.write_bytes(archive.read_bytes() + b"changed")
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                owner.prepare(root)
            self.assertFalse((root / ".cache").exists())

    def test_noncanonical_snapshot_selection_is_refused_without_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, lock, _ = self.source(temporary)
            original = archive.read_bytes()
            for selected in ["artifacts/sdk/old.crate", "../outside.crate",
                             "artifacts/sdk/" + "b" * 40 + "/" + archive.name]:
                with self.subTest(selected=selected):
                    (root / "sdk.lock.json").write_text(
                        json.dumps({**lock, "archive": selected}), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "archive path"):
                        owner.prepare(root)
                    self.assertEqual(archive.read_bytes(), original)
                    self.assertFalse((root / ".cache").exists())


if __name__ == "__main__":
    unittest.main()
