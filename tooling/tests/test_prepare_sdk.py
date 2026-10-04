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
                 "src/lib.rs": b"pub struct CapturedSource;\n"}
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
            self.assertEqual(owner.prepare(root), cache)
            (cache / "src/lib.rs").write_bytes(b"different contract\n")
            with self.assertRaisesRegex(ValueError, "SDK cache"):
                owner.prepare(root)
            self.assertEqual((cache / "src/lib.rs").read_bytes(), b"different contract\n")

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
