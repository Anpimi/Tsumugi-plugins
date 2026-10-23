import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "package_flat_json", Path(__file__).parents[1] / "package-flat-json.py"
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class FlatJsonPackagingTests(unittest.TestCase):
    def fixture(self, temporary):
        root = Path(temporary)
        package = "tsumugi-plugin-sdk-0.1.0-alpha.1"
        commit = "a" * 40
        archive = root / "artifacts/sdk" / commit / (package + ".crate")
        archive.parent.mkdir(parents=True)
        with tarfile.open(archive, "w:gz") as target:
            for name, data in {"Cargo.toml": b"synthetic SDK metadata\n",
                               "LICENSE": b"synthetic SDK license\n"}.items():
                member = tarfile.TarInfo(package + "/" + name)
                member.size = len(data)
                target.addfile(member, io.BytesIO(data))
        lock = json.dumps({"formatVersion": 1, "package": "tsumugi-plugin-sdk",
                           "version": "0.1.0-alpha.1", "sourceCommit": commit,
                           "archive": archive.relative_to(root).as_posix(),
                           "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}) + "\n"
        (root / "sdk.lock.json").write_text(lock, encoding="utf-8")
        docs = root / "examples/flat-json"
        docs.mkdir(parents=True)
        for name in ["README.md", "LICENSE", "CHANGELOG.md", "CHANGELOG.zh-CN.md"]:
            (docs / name).write_text(name + "\n", encoding="utf-8")
        generated = {
            "manifest.json": json.dumps({"components": [{"runtime": "native-worker",
                                                          "entrypoint": "bin/catalog-worker"}]}),
            "profiles/source.json": "{\"synthetic\":true}",
            "sdk/lock.json": lock,
        }
        generated["package-files.json"] = json.dumps({
            "formatVersion": 1,
            "files": list(generated) + ["package-files.json", "bin/catalog-worker",
                                         "README.md", "LICENSE", "CHANGELOG.md",
                                         "CHANGELOG.zh-CN.md", "sdk/LICENSE"],
        })
        metadata = root / "metadata.json"
        metadata.write_text(json.dumps(generated), encoding="utf-8")
        worker = root / "worker"
        worker.write_bytes(b"invalid executable; must never run\n")
        worker.chmod(0o700)
        return root, metadata, worker, generated

    def test_materializes_all_captured_bytes_without_executing_worker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, generated = self.fixture(temporary)
            output = root / "candidate"
            with patch.object(owner, "ROOT", root):
                count, size = owner.prepare(metadata, worker, output)
            files = {p.relative_to(output).as_posix(): p.read_bytes()
                     for p in output.rglob("*") if p.is_file()}
            self.assertEqual(count, 10)
            self.assertEqual(size, sum(len(data) for data in files.values()))
            self.assertEqual(files["sdk/lock.json"], (root / "sdk.lock.json").read_bytes())
            self.assertEqual(files["bin/catalog-worker"], worker.read_bytes())
            self.assertEqual(files["sdk/LICENSE"], b"synthetic SDK license\n")
            self.assertEqual(files["profiles/source.json"], b'{"synthetic":true}\n')
            self.assertTrue((output / "bin/catalog-worker").stat().st_mode & 0o111)
            self.assertFalse((output / "manifest.json").stat().st_mode & 0o111)
            self.assertEqual(set(files), set(json.loads(generated["package-files.json"])["files"]))

    def test_duplicate_metadata_is_refused_before_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, _ = self.fixture(temporary)
            original = metadata.read_text(encoding="utf-8")
            metadata.write_text(original[:-1] + ',"manifest.json":"{}"}', encoding="utf-8")
            with patch.object(owner, "ROOT", root), self.assertRaisesRegex(ValueError, "duplicate"):
                owner.prepare(metadata, worker, root / "candidate")
            self.assertFalse((root / "candidate").exists())

    def test_generated_path_escape_and_captured_overlap_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, original = self.fixture(temporary)
            for name in ["../escape", "README.md", "bin/catalog-worker", "sdk/LICENSE"]:
                with self.subTest(name=name):
                    metadata.write_text(json.dumps({**original, name: "forged"}), encoding="utf-8")
                    with patch.object(owner, "ROOT", root), self.assertRaises(ValueError):
                        owner.prepare(metadata, worker, root / "candidate")
                    self.assertFalse((root / "candidate").exists())

    def test_stale_compiled_sdk_pin_is_refused_before_cache_or_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, original = self.fixture(temporary)
            metadata.write_text(json.dumps({**original, "sdk/lock.json": "different pin\n"}), encoding="utf-8")
            with patch.object(owner, "ROOT", root), self.assertRaisesRegex(ValueError, "compiled SDK"):
                owner.prepare(metadata, worker, root / "candidate")
            self.assertFalse((root / ".cache").exists())
            self.assertFalse((root / "candidate").exists())

    def test_worker_link_hardlink_and_non_executable_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, _ = self.fixture(temporary)
            with patch.object(owner, "ROOT", root):
                worker.chmod(0o600)
                with self.assertRaisesRegex(ValueError, "executable"):
                    owner.prepare(metadata, worker, root / "candidate")
                worker.chmod(0o700)
                outside = root / "other-worker"
                worker.rename(outside)
                worker.symlink_to(outside)
                with self.assertRaises(OSError):
                    owner.prepare(metadata, worker, root / "candidate")
                worker.unlink()
                os.link(outside, worker)
                with self.assertRaisesRegex(ValueError, "ordinary"):
                    owner.prepare(metadata, worker, root / "candidate")
            self.assertFalse((root / "candidate").exists())

    def test_existing_output_and_contents_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, _ = self.fixture(temporary)
            output = root / "candidate"
            output.mkdir()
            (output / "keep").write_bytes(b"existing data")
            with patch.object(owner, "ROOT", root), self.assertRaises(FileExistsError):
                owner.prepare(metadata, worker, output)
            self.assertEqual(list(output.iterdir()), [output / "keep"])
            self.assertEqual((output / "keep").read_bytes(), b"existing data")

    def test_worker_entrypoint_cannot_be_shadowed_by_documentation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, generated = self.fixture(temporary)
            generated["manifest.json"] = json.dumps({"components": [
                {"runtime": "native-worker", "entrypoint": "README.md"}]})
            metadata.write_text(json.dumps(generated), encoding="utf-8")
            with patch.object(owner, "ROOT", root), self.assertRaisesRegex(ValueError, "entrypoint conflicts"):
                owner.prepare(metadata, worker, root / "candidate")
            self.assertFalse((root / "candidate").exists())

    def test_recipe_cannot_omit_captured_worker_or_replace_it_with_sdk_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, metadata, worker, generated = self.fixture(temporary)
            original = json.loads(generated["package-files.json"])
            for recipe in [{**original, "files": [n for n in original["files"] if n != "bin/catalog-worker"]},
                           {**original, "sdkFiles": [{"source": "LICENSE", "target": "bin/catalog-worker"}]}]:
                generated["package-files.json"] = json.dumps(recipe)
                metadata.write_text(json.dumps(generated), encoding="utf-8")
                with patch.object(owner, "ROOT", root), self.assertRaisesRegex(ValueError, "complete captured"):
                    owner.prepare(metadata, worker, root / "candidate")
                self.assertFalse((root / "candidate").exists())


if __name__ == "__main__":
    unittest.main()
