import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location(
    "package_plugin", Path(__file__).parents[1] / "package-plugin.py"
)
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackagingTests(unittest.TestCase):
    def source(self, temporary):
        root = Path(temporary) / "source"
        root.mkdir()
        (root / "components").mkdir()
        (root / "manifest.json").write_bytes(b'{"candidate":true}\n')
        (root / "components" / "component.mjs").write_bytes(b"invalid program; never run\n")
        (root / "unselected.txt").write_bytes(b"not part of the package\n")
        (root / "package-files.json").write_text(json.dumps({
            "formatVersion": 1,
            "files": ["components/component.mjs", "manifest.json"],
        }), encoding="utf-8")
        return root

    def test_selected_bytes_and_permissions_without_running_code(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.source(temporary)
            os.chmod(root / "components" / "component.mjs", 0o700)
            output = Path(temporary) / "artifact"
            count, size = packager.package(root, output)
            self.assertEqual(count, 2)
            self.assertEqual(size, len((root / "manifest.json").read_bytes())
                             + len((root / "components" / "component.mjs").read_bytes()))
            self.assertEqual((output / "components" / "component.mjs").read_bytes(),
                             (root / "components" / "component.mjs").read_bytes())
            self.assertTrue((output / "components" / "component.mjs").stat().st_mode & 0o111)
            self.assertFalse((output / "unselected.txt").exists())
            self.assertFalse((output / "package-files.json").exists())

    def test_existing_output_is_refused_and_retained(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.source(temporary)
            output = Path(temporary) / "artifact"
            output.mkdir()
            (output / "marker").write_bytes(b"retain")
            with self.assertRaises(FileExistsError):
                packager.package(root, output)
            self.assertEqual((output / "marker").read_bytes(), b"retain")
            self.assertEqual(list(output.iterdir()), [output / "marker"])

    def test_selected_links_and_hardlinks_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.source(temporary)
            component = root / "components" / "component.mjs"
            outside = Path(temporary) / "outside"
            component.rename(outside)
            component.symlink_to(outside)
            with self.assertRaises(OSError):
                packager.package(root, Path(temporary) / "linked")
            component.unlink()
            os.link(outside, component)
            with self.assertRaises(ValueError):
                packager.package(root, Path(temporary) / "hardlinked")
            self.assertFalse((Path(temporary) / "linked").exists())
            self.assertFalse((Path(temporary) / "hardlinked").exists())

    def test_escape_and_alias_recipes_are_refused_before_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = self.source(temporary)
            for name in ["../outside", "/outside", "components/../manifest.json", "CON"]:
                with self.subTest(name=name):
                    (root / "package-files.json").write_text(json.dumps({
                        "formatVersion": 1, "files": ["manifest.json", name],
                    }), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        packager.package(root, Path(temporary) / "artifact")
                    self.assertFalse((Path(temporary) / "artifact").exists())


if __name__ == "__main__":
    unittest.main()
