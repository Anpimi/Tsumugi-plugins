import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("compatibility_matrix", Path(__file__).parents[1] / "compatibility-matrix.py")
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


def row(name="paired", kind="paired-candidates"):
    return {"id": name, "kind": kind, "host": {"directory": "application", "commit": "a" * 40},
            "plugins": {"sourceCommit": "b" * 40, "sourceDirty": False,
                        "sdkArtifact": {"version": "0.1.0-alpha.1", "sourceCommit": "c" * 40, "sha256": "d" * 64},
                        "packages": {name: {"directory": name, "packageDigest": digit * 64,
                                             "plugin": {"publisher": "tsumugi", "id": name, "version": "0.1.0-alpha.1"}}
                                     for name, digit in [("webvtt", "e"), ("stardew-smapi", "f")]}},
            "runtime": {"tool": "runtime/tool", "host": "runtime/host", "approval": "runtime/approval.json"}}


def host_report(selection):
    return {"schemaVersion": 1, "status": "passed", "host": {"commit": selection["host"]["commit"], "dirty": False},
            "cases": [{"domain": domain, "test": test[1], "status": "passed",
                       "inspection": {"plugin": selection["plugins"]["packages"][domain]["plugin"],
                                      "packageDigest": selection["plugins"]["packages"][domain]["packageDigest"]},
                       "executionCounts": {"passed": 1, "failed": 0, "ignored": 0, "filteredOut": 1}}
                      for domain, test in matrix.TESTS.items()]}


class CompatibilityMatrixTests(unittest.TestCase):
    def test_exact_sources_and_both_domains_are_required_before_execution(self):
        valid = {"formatVersion": 1, "combinations": [row()]}
        self.assertEqual(matrix.validate_matrix(valid), valid["combinations"])
        for mutation in [lambda r: r["host"].update(commit="main"),
                         lambda r: r["plugins"].update(sourceCommit="latest"),
                         lambda r: r["plugins"]["sdkArtifact"].update(sha256=None),
                         lambda r: r["plugins"]["packages"].pop("stardew-smapi")]:
            bad = copy.deepcopy(valid)
            mutation(bad["combinations"][0])
            with self.assertRaises(ValueError):
                matrix.validate_matrix(bad)

    def test_duplicates_unknown_kinds_and_unexplained_absence_are_rejected(self):
        examples = [[row(), row()], [dict(row(), kind="all-good")],
                    [{"id": "missing", "kind": "paired-candidates", "status": "not-run", "reason": ""}]]
        for rows in examples:
            with self.assertRaises(ValueError):
                matrix.validate_matrix({"formatVersion": 1, "combinations": rows})

    def test_dirty_or_local_candidate_cannot_be_relabelled_as_released(self):
        selected = row(kind="candidate-host-released-plugins")
        with self.assertRaisesRegex(ValueError, "released plugins require"):
            matrix.validate_matrix({"formatVersion": 1, "combinations": [selected]})
        for package in selected["plugins"]["packages"].values():
            del package["directory"]
            package["archive"] = {"url": "https://example.invalid/plugin.tar", "sha256": "1" * 64}
        matrix.validate_matrix({"formatVersion": 1, "combinations": [selected]})
        selected["plugins"]["sourceDirty"] = True
        with self.assertRaisesRegex(ValueError, "dirty source"):
            matrix.validate_matrix({"formatVersion": 1, "combinations": [selected]})

    def test_old_host_wrong_package_duplicate_domain_or_empty_execution_never_pass(self):
        selected = row()
        matrix.verify_result(host_report(selected), selected)
        changes = [lambda r: r["host"].update(commit="1" * 40),
                   lambda r: r.update(host=None),
                   lambda r: r["cases"][0]["inspection"].update(packageDigest="0" * 64),
                   lambda r: r["cases"][0].update(inspection=None),
                   lambda r: r["cases"][0].update(executionCounts=[]),
                   lambda r: r["cases"][0].update(domain=[]),
                   lambda r: r["cases"].__setitem__(1, r["cases"][0]),
                   lambda r: r["cases"][0]["executionCounts"].update(passed=0),
                   lambda r: r["cases"][0]["executionCounts"].update(ignored=1),
                   lambda r: r["cases"][0].update(test="other_test"),
                   lambda r: r.update(status="failed")]
        for change in changes:
            bad = host_report(selected)
            change(bad)
            with self.assertRaises(ValueError):
                matrix.verify_result(bad, selected)

    def test_one_successful_pair_preserves_unrun_matrix_classes(self):
        selection = {"formatVersion": 1, "combinations": [row()]}
        with tempfile.TemporaryDirectory() as temporary, patch.object(matrix, "run_row", return_value=host_report(row())):
            root = Path(temporary)
            result = matrix.execute(selection, root, root, {})
            self.assertEqual(result["status"], "incomplete")
            self.assertEqual(result["combinations"][0]["status"], "passed")
            self.assertEqual(result["coverage"]["candidate-host-released-plugins"], {"selected": 0, "passed": 0})
            self.assertEqual(json.loads((root / "compatibility-matrix.json").read_text()), result)

    def test_explicit_unavailable_release_preserves_reason_and_incomplete_status(self):
        selection = {"formatVersion": 1, "combinations": [row(), {"id": "release", "kind": "candidate-host-released-plugins",
                     "status": "not-run", "reason": "No released Process-3 package is selected"}]}
        with tempfile.TemporaryDirectory() as temporary, patch.object(matrix, "run_row", return_value=host_report(row())):
            result = matrix.execute(selection, Path(temporary), Path(temporary), {})
            self.assertEqual(result["status"], "incomplete")
            self.assertEqual(result["combinations"][1]["status"], "not-run")
            self.assertIn("No released", result["combinations"][1]["reason"])

    def test_failure_is_retained_and_later_combinations_still_execute(self):
        selected = [row("first"), row("second", "candidate-plugins-declared-host")]
        with tempfile.TemporaryDirectory() as temporary, patch.object(matrix, "run_row", side_effect=[ValueError("Host rejected protocol"), host_report(selected[1])]) as run:
            result = matrix.execute({"formatVersion": 1, "combinations": selected}, Path(temporary), Path(temporary), {})
            self.assertEqual(run.call_count, 2)
            self.assertEqual(result["status"], "failed")
            self.assertEqual([r["status"] for r in result["combinations"]], ["failed", "passed"])
            self.assertIn("protocol", result["combinations"][0]["reason"])

    def test_directory_conflict_is_one_failed_row_and_does_not_hide_later_rows(self):
        selected = [row("occupied"), row("later")]
        with tempfile.TemporaryDirectory() as temporary, patch.object(matrix, "run_row", return_value=host_report(selected[1])) as run:
            root = Path(temporary)
            (root / "occupied").mkdir()
            marker = root / "occupied/retained.txt"
            marker.write_text("original", encoding="utf-8")
            result = matrix.execute({"formatVersion": 1, "combinations": selected}, root, root, {})
            self.assertEqual(result["status"], "failed")
            self.assertEqual([r["status"] for r in result["combinations"]], ["failed", "passed"])
            self.assertEqual(run.call_count, 1)
            self.assertEqual(marker.read_text(encoding="utf-8"), "original")

    def test_all_selected_classes_pass_only_after_all_actual_journeys(self):
        selected = [row("paired"), row("declared", "candidate-plugins-declared-host"), row("released", "candidate-host-released-plugins")]
        for package in selected[2]["plugins"]["packages"].values():
            del package["directory"]
            package["archive"] = {"url": "https://example.invalid/plugin.tar", "sha256": "1" * 64}
        with tempfile.TemporaryDirectory() as temporary, patch.object(matrix, "run_row", side_effect=lambda r, *args: host_report(r)):
            result = matrix.execute({"formatVersion": 1, "combinations": selected}, Path(temporary), Path(temporary), {})
            self.assertEqual(result["status"], "passed")
            self.assertEqual(result["publication"], "not-run")
            self.assertTrue(all(c["passed"] == 1 for c in result["coverage"].values()))

    def archive(self, names):
        encoded = io.BytesIO()
        with tarfile.open(fileobj=encoded, mode="w") as tar:
            for name, data, mode, kind in names:
                member = tarfile.TarInfo(name)
                member.mode = mode
                member.type = kind
                member.size = len(data)
                tar.addfile(member, io.BytesIO(data))
        return encoded.getvalue()

    def fetch(self, encoded, destination, digest=None, maximum=65536, max_files=16):
        response = io.BytesIO(encoded)
        response.geturl = lambda: "https://example.invalid/material.tar"
        selection = {"url": response.geturl(), "sha256": digest or hashlib.sha256(encoded).hexdigest()}
        with patch.object(matrix.urllib.request.OpenerDirector, "open", return_value=response):
            matrix.fetch_archive(selection, destination, maximum, max_files)

    def test_transport_preserves_executable_bits_without_running_members(self):
        encoded = self.archive([("manifest.json", b"{}", 0o644, tarfile.REGTYPE), ("components/main.mjs", b"never execute", 0o755, tarfile.REGTYPE)])
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "package"
            self.fetch(encoded, output)
            self.assertEqual((output / "components/main.mjs").read_bytes(), b"never execute")
            self.assertTrue((output / "components/main.mjs").stat().st_mode & 0o111)

    def test_changed_or_oversize_transport_is_rejected_before_materialization(self):
        encoded = self.archive([("manifest.json", b"{}", 0o644, tarfile.REGTYPE)])
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "package"
            for options in [{"digest": "0" * 64}, {"maximum": 10}]:
                with self.assertRaisesRegex(ValueError, "transport identity or size"):
                    self.fetch(encoded, output, **options)
                self.assertFalse(output.exists())

    def test_traversal_links_duplicate_names_and_member_limits_are_refused(self):
        bad = [[("../escape", b"x", 0o644, tarfile.REGTYPE)],
               [("link", b"", 0o644, tarfile.SYMTYPE)],
               [("same", b"a", 0o644, tarfile.REGTYPE), ("same", b"b", 0o644, tarfile.REGTYPE)],
               [("privileged", b"a", 0o4755, tarfile.REGTYPE)]]
        with tempfile.TemporaryDirectory() as temporary:
            for members in bad:
                output = Path(temporary) / "package"
                with self.assertRaises(ValueError):
                    self.fetch(self.archive(members), output)
                self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError, "bound"):
                self.fetch(self.archive([("one", b"a", 0o644, tarfile.REGTYPE), ("two", b"b", 0o644, tarfile.REGTYPE)]), Path(temporary) / "package", max_files=1)

    def test_credential_urls_and_nonpublic_automatic_checkouts_are_rejected(self):
        for url in ["http://example.invalid/x", "https://user:secret@example.invalid/x", "https://example.invalid/x#fragment"]:
            with self.assertRaises(ValueError):
                matrix.validate_download({"url": url, "sha256": "a" * 64})
        selected = row()
        selected["host"] = {"repository": "https://example.invalid/application", "commit": "a" * 40}
        with self.assertRaisesRegex(ValueError, "public application"):
            matrix.validate_matrix({"formatVersion": 1, "combinations": [selected]})

    def test_each_redirect_is_checked_before_the_next_request_is_created(self):
        request = matrix.urllib.request.Request("https://example.invalid/start.tar")
        handler = matrix.HttpsRedirect()
        for url in ["http://example.invalid/intermediate", "https://user:secret@example.invalid/private"]:
            with self.assertRaisesRegex(ValueError, "HTTPS without credentials"):
                handler.redirect_request(request, None, 302, "Moved", {}, url)
        redirected = handler.redirect_request(request, None, 302, "Moved", {}, "https://example.invalid/next.tar")
        self.assertEqual(redirected.full_url, "https://example.invalid/next.tar")

    def test_package_sdk_mismatch_stops_before_any_worker_command(self):
        selected = row()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            harness = root / "application/crates/plugin-host/scripts/compatibility.py"
            harness.parent.mkdir(parents=True)
            harness.write_text("fixture; never execute", encoding="utf-8")
            lock = root / "webvtt/sdk/lock.json"
            lock.parent.mkdir(parents=True)
            lock.write_text(json.dumps(dict(selected["plugins"]["sdkArtifact"], sha256="0" * 64)), encoding="utf-8")
            with patch.object(matrix, "host_checkout", return_value=root / "application"), patch.object(matrix, "command") as worker:
                with self.assertRaisesRegex(ValueError, "SDK selection differs"):
                    matrix.run_row(selected, root, root, {}, True)
            worker.assert_not_called()


if __name__ == "__main__":
    unittest.main()
