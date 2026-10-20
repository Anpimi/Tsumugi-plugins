import importlib.util
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("candidate_build", Path(__file__).parents[1] / "candidate-build.py")
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateBuildTests(unittest.TestCase):
    def package(self, temporary, version="0.1.0", name="package"):
        root = Path(temporary) / name
        root.mkdir()
        (root / "components").mkdir()
        (root / "manifest.json").write_text(json.dumps({"plugin": {"publisher": "example", "id": "fixture", "version": version}}), encoding="utf-8")
        (root / "package.json").write_text(json.dumps({"version": version}), encoding="utf-8")
        (root / "components/worker").write_bytes(b"synthetic prebuilt executable; never run")
        (root / "components/worker").chmod(0o700)
        return root

    def inspection_fixture(self, temporary):
        root = Path(temporary)
        output = root / "output"
        (output / "packages").mkdir(parents=True)
        (output / "logs").mkdir()
        original = root / "approved-inspector"
        approved = b"synthetic approved inspector; never execute"
        original.write_bytes(approved)
        original.chmod(0o700)
        for relative in candidate.JS_PACKAGES:
            tests = root / relative / "tests"
            tests.mkdir(parents=True)
            (tests / "selected.test.mjs").write_text("synthetic fixture; never execute", encoding="utf-8")
        for name in ("webvtt", "stardew-smapi", "philosophy", "flat-json"):
            self.package(output / "packages", name=name)
        return root, output, original, approved, hashlib.sha256(approved).hexdigest(), "b" * 40

    def test_transport_is_reproducible_and_retains_each_independent_version(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = self.package(temporary, "2.3.4")
            first = candidate.archive_package(package, Path(temporary) / "first.tar")
            (package / "components/worker").chmod(0o755)
            second = candidate.archive_package(package, Path(temporary) / "second.tar")
            self.assertEqual(first["archiveSha256"], second["archiveSha256"])
            self.assertEqual(first["plugin"]["version"], "2.3.4")
            self.assertIsNone(first["packageDigest"])
            self.assertEqual(first["inspection"]["status"], "not-run")
            candidate.verify_transport(package, Path(temporary) / "first.tar", first["archiveSha256"])
            (package / "package.json").write_text('{"version":"2.3.5"}', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "versions disagree"):
                candidate.archive_package(package, Path(temporary) / "wrong.tar")
            self.assertFalse((Path(temporary) / "wrong.tar").exists())

    def test_transport_existing_output_is_preserved_and_changed_payload_is_not_paired_with_old_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = self.package(temporary)
            archive = Path(temporary) / "candidate.tar"
            record = candidate.archive_package(package, archive)
            before = archive.read_bytes()
            with self.assertRaises(FileExistsError):
                candidate.archive_package(package, archive)
            self.assertEqual(archive.read_bytes(), before)
            worker = package / "components/worker"
            worker.write_bytes(b"x" * len(worker.read_bytes()))
            with self.assertRaisesRegex(ValueError, "bytes differ"):
                candidate.verify_transport(package, archive, record["archiveSha256"])
            archive.write_bytes(before + b"changed")
            with self.assertRaisesRegex(ValueError, "archive changed"):
                candidate.verify_transport(package, archive, record["archiveSha256"])

    def test_inspector_result_must_match_actual_identity_manifest_and_complete_file_counts(self):
        with tempfile.TemporaryDirectory() as temporary:
            record = candidate.archive_package(self.package(temporary), Path(temporary) / "candidate.tar")
            actual = {key: record[key] for key in ("plugin", "manifestSha256", "fileCount", "byteCount")}
            actual["packageDigest"] = "a" * 64
            self.assertEqual(candidate.verify_inspection(json.dumps(actual), record), actual)
            for field, changed in (("plugin", {**actual["plugin"], "version": "9.9.9"}), ("manifestSha256", "b" * 64),
                                   ("packageDigest", "invalid"), ("fileCount", record["fileCount"] + 1), ("byteCount", record["byteCount"] - 1)):
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, "does not match"):
                    candidate.verify_inspection(json.dumps({**actual, field: changed}), record)
            with self.assertRaisesRegex(ValueError, "duplicate JSON field"):
                candidate.verify_inspection('{"plugin":{},"plugin":{}}', record)

    def test_failed_command_is_recorded_and_not_hidden_by_a_later_command(self):
        with tempfile.TemporaryDirectory(prefix="candidate output ") as temporary:
            output = Path(temporary)
            (output / "logs").mkdir()
            report = {"commands": []}
            runner = candidate.CommandRunner(output, output, report)
            with patch.object(candidate.subprocess, "run", return_value=subprocess.CompletedProcess(["node"], 7)) as command:
                with self.assertRaisesRegex(RuntimeError, "selected-tests failed"):
                    runner.run("selected-tests", ["node", "--test", "selected.test.mjs"])
            self.assertEqual(report["commands"][0]["status"], "failed")
            self.assertEqual(report["commands"][0]["exitCode"], 7)
            self.assertEqual(report["commands"][0]["logSha256"], hashlib.sha256((output / "logs/selected-tests.log").read_bytes()).hexdigest())
            self.assertFalse(command.call_args.kwargs.get("shell", False))
            self.assertEqual(command.call_args.kwargs["timeout"], 1200)
            flags = runner.environment["CARGO_ENCODED_RUSTFLAGS"].split("\x1f")
            self.assertIn(f"--remap-path-prefix={output}=/tsumugi-plugins", flags)

    def test_real_node_empty_file_empty_suite_and_all_skipped_or_todo_refuse_success(self):
        fixtures = [
            ("empty-file", "", 1, 0, 0, 1),
            ("empty-suite", "import { describe } from 'node:test'; describe('empty fixture suite', () => {});", 0, 0, 0, 0),
            ("all-skipped", "import test from 'node:test'; test('skip fixture', { skip: true }, () => { throw new Error('must not execute'); });", 1, 1, 0, 0),
            ("all-todo", "import test from 'node:test'; test.todo('todo fixture');", 1, 0, 1, 0),
        ]
        for name, source, tested, skipped, todo, file_results in fixtures:
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix="candidate Node # ") as temporary:
                root = Path(temporary)
                tests = root / "fixture/tests"
                tests.mkdir(parents=True)
                (tests / "selected.test.mjs").write_text(source, encoding="utf-8")
                (root / "logs").mkdir()
                report = {"commands": []}
                runner = candidate.CommandRunner(root, root, report)
                with self.assertRaisesRegex(RuntimeError, "no effective tests executed"):
                    runner.run(name, candidate.node_tests(root, "fixture"), tests="node", timeout=30)
                record = report["commands"][0]
                counts = record["testCounts"]
                self.assertEqual(record["status"], "failed")
                self.assertEqual(record["exitCode"], 0)
                self.assertEqual(counts["tested"], tested)
                self.assertEqual(counts["executed"], 0)
                self.assertEqual(counts["skipped"], skipped)
                self.assertEqual(counts["todo"], todo)
                self.assertEqual(counts["fileResultsExcluded"], file_results)
                log = root / record["log"]
                self.assertEqual(record["logSha256"], hashlib.sha256(log.read_bytes()).hexdigest())

    def test_real_node_failure_retains_effective_counts_and_failed_log_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tests = root / "fixture/tests"
            tests.mkdir(parents=True)
            (tests / "failure.test.mjs").write_text("import test from 'node:test'; test('failing fixture', () => { throw new Error('expected fixture failure'); });", encoding="utf-8")
            (root / "logs").mkdir()
            report = {"commands": []}
            runner = candidate.CommandRunner(root, root, report)
            with self.assertRaisesRegex(RuntimeError, "fixture-tests failed"):
                runner.run("fixture-tests", candidate.node_tests(root, "fixture"), tests="node", timeout=30)
            record = report["commands"][0]
            self.assertEqual(record["status"], "failed")
            self.assertNotEqual(record["exitCode"], 0)
            self.assertEqual(record["testCounts"]["tested"], 1)
            self.assertEqual(record["testCounts"]["passed"], 0)
            self.assertEqual(record["testCounts"]["failed"], 1)
            self.assertEqual(record["testCounts"]["executed"], 1)
            log = (root / record["log"]).read_bytes()
            self.assertIn(b"expected fixture failure", log)
            self.assertEqual(record["logSha256"], hashlib.sha256(log).hexdigest())

    def test_real_node_pass_and_skip_keep_exact_counts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tests = root / "fixture/tests"
            tests.mkdir(parents=True)
            (tests / "passing.test.mjs").write_text("import test from 'node:test'; test('passing fixture', () => {}); test.skip('skipped fixture');", encoding="utf-8")
            (root / "logs").mkdir()
            report = {"commands": []}
            runner = candidate.CommandRunner(root, root, report)
            runner.run("fixture-tests", candidate.node_tests(root, "fixture"), tests="node", timeout=30)
            record = report["commands"][0]
            self.assertEqual(record["status"], "passed")
            self.assertEqual(record["testCounts"], {"framework": "node", "tested": 2, "suites": 0,
                             "passed": 1, "failed": 0, "cancelled": 0, "skipped": 1, "todo": 0,
                             "fileResultsExcluded": 0, "executed": 1})

    def test_python_and_rust_counts_require_execution_and_complete_summaries(self):
        python = candidate.test_counts("python", b"....s\nRan 5 tests in 0.1s\n\nOK (skipped=1)\n", [], candidate.ROOT)
        self.assertEqual((python["tested"], python["executed"], python["passed"], python["skipped"]), (5, 4, 4, 1))
        failed = candidate.test_counts("python", b"Ran 2 tests in 0.1s\n\nFAILED (failures=1, errors=1)\n", [], candidate.ROOT)
        self.assertEqual((failed["executed"], failed["failed"], failed["errors"], failed["successful"]), (2, 1, 1, False))
        self.assertIsNone(failed["passed"])
        rust = (b"running 3 tests\ntest result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 4 filtered out; finished in 0.00s\n"
                b"Doc-tests fixture\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n")
        counts = candidate.test_counts("rust", rust, [], candidate.ROOT)
        self.assertEqual((counts["tested"], counts["passed"], counts["executed"], counts["skipped"], counts["filteredOut"]), (3, 2, 2, 1, 4))
        self.assertEqual(counts["suites"][1]["executed"], 0)
        self.assertTrue(counts["successful"])
        for framework, encoded in (("python", b"OK\n"), ("rust", rust + b"running 1 test\n"),
                                   ("node", b"TAP version 13\n1..0\n# tests 0\n# pass 0\n")):
            with self.subTest(framework=framework), self.assertRaisesRegex(ValueError, "incomplete"):
                candidate.test_counts(framework, encoded, [], candidate.ROOT)

    def test_zero_or_skipped_python_and_rust_and_incomplete_logs_block_zero_exit(self):
        cases = [
            ("python", b"Ran 0 tests in 0.1s\n\nOK\n", "no effective"),
            ("python", b"Ran 2 tests in 0.1s\n\nOK (skipped=2)\n", "no effective"),
            ("python", b"Ran 1 test in 0.1s\n\nFAILED (failures=1)\n", "unsuccessful"),
            ("rust", b"running 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n", "no effective"),
            ("rust", b"running 2 tests\ntest result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s\n", "no effective"),
            ("rust", b"running 1 test\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n", "unsuccessful"),
            ("node", b"TAP version 13\n# tests 3\n", "incomplete"),
        ]
        for framework, encoded, reason in cases:
            with self.subTest(framework=framework, encoded=encoded), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "logs").mkdir()
                report = {"commands": []}
                runner = candidate.CommandRunner(root, root, report)
                def emit(args, **kwargs):
                    kwargs["stdout"].write(encoded)
                    return subprocess.CompletedProcess(args, 0)
                with patch.object(candidate.subprocess, "run", side_effect=emit), self.assertRaisesRegex(RuntimeError, reason):
                    runner.run("selected-tests", ["fixture-runner"], tests=framework)
                record = report["commands"][0]
                self.assertEqual(record["status"], "failed")
                self.assertEqual(record["exitCode"], 0)
                self.assertEqual(record["logSha256"], hashlib.sha256(encoded).hexdigest())
                self.assertEqual((root / record["log"]).read_bytes(), encoded)

    def test_timeout_keeps_partial_log_hash_and_unavailable_counts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "logs").mkdir()
            report = {"commands": []}
            runner = candidate.CommandRunner(root, root, report)
            def timeout(args, **kwargs):
                kwargs["stdout"].write(b"TAP version 13\n# interrupted fixture\n")
                raise subprocess.TimeoutExpired(args, 1200)
            with patch.object(candidate.subprocess, "run", side_effect=timeout), self.assertRaises(subprocess.TimeoutExpired):
                runner.run("selected-tests", ["node", "--test"], tests="node")
            record = report["commands"][0]
            self.assertEqual(record["status"], "failed")
            self.assertEqual(record["testCounts"], {"framework": "node", "status": "unavailable"})
            self.assertEqual(record["logSha256"], hashlib.sha256((root / record["log"]).read_bytes()).hexdigest())

    def test_inspection_executes_captured_bytes_even_when_original_path_is_replaced_and_restored(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, output, original, approved, digest, declared = self.inspection_fixture(temporary)
            executions = []
            class CapturedRunner:
                def run(self, name, args, **kwargs):
                    if not name.endswith("-inspection"):
                        return
                    saved = root / "saved-original"
                    original.rename(saved)
                    original.write_bytes(b"replacement binary at the original caller path")
                    try:
                        executions.append((Path(args[0]), Path(args[0]).read_bytes()))
                    finally:
                        original.unlink()
                        saved.rename(original)
                    package = Path(args[2])
                    files = candidate.capture_tree(package)
                    kwargs["stdout"].write_text(json.dumps({"plugin": json.loads(files["manifest.json"][0])["plugin"],
                        "packageDigest": "a" * 64, "manifestSha256": hashlib.sha256(files["manifest.json"][0]).hexdigest(),
                        "fileCount": len(files), "byteCount": sum(len(data) for data, _ in files.values())}), encoding="utf-8")
            report = {"packages": []}
            candidate.build(root, output, CapturedRunner(), report, inspector=(original, digest, declared))
            copied = output / ".inspector/tsumugi-plugin-package"
            self.assertEqual(executions, [(copied, approved)] * 4)
            self.assertNotEqual(copied, original)
            self.assertEqual(stat.S_IMODE(copied.stat().st_mode), 0o500)
            self.assertEqual(stat.S_IMODE(copied.parent.stat().st_mode), 0o700)
            self.assertEqual(original.read_bytes(), approved)
            self.assertEqual(len(report["packages"]), 4)
            for package in report["packages"]:
                self.assertEqual(package["inspection"]["status"], "passed")
                self.assertNotIn("reason", package["inspection"])
                self.assertEqual(package["inspection"]["binarySha256"], digest)
                self.assertEqual(package["inspection"]["declaredHostCommit"], declared)
                self.assertTrue(package["inspection"]["sourceProvenanceNotVerified"])
            with self.assertRaises(FileExistsError):
                candidate.capture_inspector((original, digest, declared), output)
            self.assertEqual(copied.read_bytes(), approved)

    def test_attempted_inspection_failure_retains_failed_metadata_and_original_archive_record(self):
        cases = (("nonzero-command", "inspection-command-failed"),
                 ("malformed-result", "inspection-result-rejected"),
                 ("wrong-result", "inspection-result-rejected"),
                 ("changed-transport", "candidate-transport-rejected"))
        for scenario, expected_reason in cases:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as temporary:
                root, output, original, _, digest, declared = self.inspection_fixture(temporary)
                report = {"commands": [], "packages": [], "status": "failed"}
                command_runner = candidate.CommandRunner(root, output, report)
                before = {}
                case = self
                class InspectionRunner:
                    def run(self, name, args, **kwargs):
                        if not name.endswith("-inspection"):
                            return
                        package = report["packages"][-1]
                        before.update({field: package[field] for field in ("plugin", "archive", "archiveSha256", "manifestSha256", "fileCount", "byteCount")})
                        case.assertEqual(package["inspection"], {"status": "starting", "reason": "inspection-command-starting",
                            "binarySha256": digest, "declaredHostCommit": declared, "sourceProvenanceNotVerified": True,
                            "record": "webvtt-inspection.json"})
                        case.assertIsNone(package["packageDigest"])
                        if scenario == "nonzero-command":
                            def failed(args, **options):
                                options["stderr"].write(b"synthetic inspector failure\n")
                                return subprocess.CompletedProcess(args, 9)
                            with patch.object(candidate.subprocess, "run", side_effect=failed):
                                command_runner.run(name, args, **kwargs)
                            return
                        value = {field: package[field] for field in ("plugin", "manifestSha256", "fileCount", "byteCount")}
                        value["packageDigest"] = "a" * 64
                        if scenario == "wrong-result":
                            value["plugin"] = {**value["plugin"], "version": "9.9.9"}
                        encoded = b"{malformed JSON" if scenario == "malformed-result" else json.dumps(value).encode()
                        kwargs["stdout"].write_bytes(encoded)
                        if scenario == "changed-transport":
                            archive = output / package["archive"]
                            archive.write_bytes(archive.read_bytes() + b"changed transport fixture")
                with self.assertRaises((RuntimeError, ValueError)):
                    candidate.build(root, output, InspectionRunner(), report, inspector=(original, digest, declared))
                self.assertEqual(report["status"], "failed")
                self.assertEqual(len(report["packages"]), 1)
                package = report["packages"][0]
                self.assertEqual({field: package[field] for field in before}, before)
                self.assertIsNone(package["packageDigest"])
                inspection = package["inspection"]
                self.assertEqual(inspection["status"], "failed")
                self.assertEqual(inspection["reason"], expected_reason)
                self.assertTrue(inspection["failureReason"])
                self.assertEqual(inspection["binarySha256"], digest)
                self.assertEqual(inspection["declaredHostCommit"], declared)
                self.assertTrue(inspection["sourceProvenanceNotVerified"])
                self.assertEqual(inspection["record"], "webvtt-inspection.json")
                self.assertTrue((output / inspection["record"]).exists())
                self.assertTrue((output / package["archive"]).exists())
                if scenario == "nonzero-command":
                    command = report["commands"][-1]
                    self.assertEqual((command["status"], command["exitCode"]), ("failed", 9))
                    log = (output / command["log"]).read_bytes()
                    self.assertEqual(log, b"synthetic inspector failure\n")
                    self.assertEqual(command["logSha256"], hashlib.sha256(log).hexdigest())

    def test_wrong_or_nonexecutable_inspector_is_refused_before_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "inspector"
            original.write_bytes(b"synthetic executable; never execute")
            digest = hashlib.sha256(original.read_bytes()).hexdigest()
            original.chmod(0o700)
            with self.assertRaisesRegex(ValueError, "explicit SHA-256"):
                candidate.capture_inspector((original, "0" * 64, "b" * 40), root)
            self.assertFalse((root / ".inspector").exists())
            original.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "explicit SHA-256"):
                candidate.capture_inspector((original, digest, "b" * 40), root)
            self.assertFalse((root / ".inspector").exists())

    def test_empty_test_selection_fails_and_prior_test_failure_stops_packaging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "no Node tests"):
                candidate.node_tests(root, "plugins/webvtt")
            tests = root / "plugins/webvtt/tests"
            tests.mkdir(parents=True)
            (tests / "first.test.mjs").write_text("test fixture; never run", encoding="utf-8")
            commands = []
            class FailingRunner:
                def run(self, name, args, **kwargs):
                    commands.append((name, args, kwargs))
                    if name == "webvtt-tests":
                        raise RuntimeError("failed selected tests")
            with self.assertRaisesRegex(RuntimeError, "failed selected tests"):
                candidate.build(root, root / "output", FailingRunner(), {"packages": []}, offline=True)
            self.assertNotIn("webvtt-package", [name for name, _, _ in commands])
            self.assertNotIn("flat-json-build", [name for name, _, _ in commands])
            for name, framework in (("packaging-tests", "python"), ("rust-workspace", "rust"), ("webvtt-tests", "node")):
                self.assertEqual(next(kwargs["tests"] for command, _, kwargs in commands if command == name), framework)
            install = next(args for name, args, _ in commands if name == "smapi-dependencies")
            self.assertIn("--offline", install)
            self.assertIn("--frozen-lockfile", install)
            self.assertIn("--ignore-scripts", install)

    def test_workflow_is_nonpublishing_read_only_and_pins_actions(self):
        workflow = (candidate.ROOT / ".github/workflows/candidate-build.yml").read_text(encoding="utf-8")
        self.assertIn("  pull_request:\n", workflow)
        self.assertIn("permissions:\n  contents: read\n", workflow)
        self.assertIn("persist-credentials: false", workflow)
        for forbidden in ("pull_request_target", "secrets.", "write-all", "contents: write", "id-token: write", "workflow_run", "self-hosted", "cargo publish", "npm publish"):
            self.assertNotIn(forbidden, workflow)
        actions = re.findall(r"uses:\s*(\S+)", workflow)
        self.assertEqual(len(actions), 6)
        self.assertTrue(all(re.fullmatch(r"actions/[a-z-]+@[a-f0-9]{40}", action) for action in actions))
        self.assertNotIn("cargo-target", workflow)
        self.assertNotIn("include-hidden-files", workflow)
        self.assertIn("if-no-files-found: error", workflow)
        self.assertIn("retention-days: 14", workflow)
