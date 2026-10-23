import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote


spec = importlib.util.spec_from_file_location("release_plugin", Path(__file__).parents[1] / "release-plugin.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class RecordingGh(release.Gh):
    """An isolated GitHub state model; never invokes gh or any network."""
    def __init__(self, source):
        self.source, self.calls, self.remote, self.tag = source, [], None, None
        self.data = {}
        self.fail = None
        self.corrupt_download = False
        self.read_status = None
        self.next_id = 100

    def response(self, args, status, value):
        body = b"HTTP/2.0 " + str(status).encode() + b" Response\r\nContent-Type: application/json\r\n\r\n" + json.dumps(value).encode()
        return subprocess.CompletedProcess(args, 0 if status == 200 else 1, body, b"")

    def run(self, args):
        self.calls.append(list(args))
        if args[0] == "api":
            if args[3] == "graphql":
                assert args[:4] == ["api", "--hostname", "github.com", "graphql"]
                assert args[4] == args[6] == "--raw-field" and args[7].startswith("tag=")
                data = {"data": {"repository": {"release": {"databaseId": self.remote["id"]} if self.remote else None}}}
                return subprocess.CompletedProcess(args, 1 if self.read_status else 0, json.dumps(data).encode(), b"")
            self.assert_api(args)
            path = unquote(args[-1])
            if self.read_status:
                return self.response(args, self.read_status, {"message": "fixture read error"})
            if "/git/commits/" in path:
                return self.response(args, 200, {"sha": self.source})
            value = self.tag if "/git/ref/" in path else self.remote
            # GitHub's REST tag endpoint cannot locate a draft without its tag.
            if "/releases/tags/" in path and value and value.get("draft"):
                value = None
            return self.response(args, 200 if value else 404, value or {"message": "Not Found"})
        assert args[:1] == ["release"]
        assert args[args.index("--repo") + 1] == release.GH_REPOSITORY
        operation, tag = args[1:3]
        if operation == "create":
            assert self.remote is None and self.tag is None
            assert "--draft" in args and "--prerelease" in args and "--latest=false" in args
            assert args[args.index("--target") + 1] == self.source
            assert Path(args[args.index("--notes-file") + 1]).is_file()
            self.remote = {"id": 42, "html_url": "https://example.invalid/release", "tag_name": tag,
                           "target_commitish": self.source, "draft": True, "prerelease": True, "assets": []}
            self.tag = {"object": {"type": "commit", "sha": self.source, "url": "https://example.invalid/commit"}}
        elif operation == "upload":
            assert self.remote["draft"] is True and "--clobber" not in args
            path = Path(args[3])
            assert path.name not in self.data
            self.data[path.name] = path.read_bytes()
            self.next_id += 1
            self.remote["assets"].append({"id": self.next_id, "name": path.name, "size": len(self.data[path.name]),
                                           "state": "uploaded", "digest": "sha256:" + release.digest(self.data[path.name])})
        elif operation == "download":
            assert self.remote["draft"] is True
            name = args[args.index("--pattern") + 1]
            value = self.data[name] + (b"corrupt" if self.corrupt_download else b"")
            (Path(args[args.index("--dir") + 1]) / name).write_bytes(value)
        elif operation == "edit":
            assert "--draft=false" in args and "--prerelease" in args and "--latest=false" in args
            self.remote["draft"] = False
            if self.tag is None:
                self.tag = {"object": {"type": "commit", "sha": self.source}}
        else:
            raise AssertionError(args)
        if self.fail == operation:
            raise subprocess.TimeoutExpired(["gh", *args], 120)
        return subprocess.CompletedProcess(args, 0, b"fixture success", b"")

    @staticmethod
    def assert_api(args):
        assert args == ["api", "--hostname", "github.com", "--method", "GET", "--include", args[-1]]


class ReleasePluginTests(unittest.TestCase):
    def fixture(self, root, domain="webvtt", version="0.1.0-alpha.1", sdk_actual=None):
        plugin = {"publisher": "tsumugi", "id": domain, "version": version}
        sdk = {"version": "0.1.0-alpha.1", "sha256": "c" * 64, "sourceCommit": "d" * 40,
               "archive": "artifacts/sdk/producer/sdk.crate", "license": "MIT"}
        package = root / "prebuilt"
        (package / "sdk").mkdir(parents=True)
        (package / "manifest.json").write_bytes(release.encoded({"plugin": plugin}))
        (package / "package.json").write_bytes(release.encoded({"version": version}))
        (package / "sdk/lock.json").write_bytes(release.encoded(sdk_actual or sdk))
        (package / "worker.mjs").write_text("throw new Error('this package must never execute');\n", encoding="utf-8")
        record = release.CANDIDATE.archive_package(package, root / "candidate.tar")
        inspection = {key: record[key] for key in ("plugin", "manifestSha256", "fileCount", "byteCount")}
        inspection["packageDigest"] = "e" * 64
        inspector = root / "approved-inspector"
        # This fixture models the read-only inspector protocol. Actual Host
        # package semantics remain the responsibility of separate integration.
        inspector.write_text("#!/usr/bin/env python3\nimport sys\nassert sys.argv[1:] == ['inspect-archive']\nassert sys.stdin.buffer.read()\nprint(" + repr(json.dumps(inspection)) + ")\n", encoding="utf-8")
        inspector.chmod(0o700)
        build = {"formatVersion": 1, "recordKind": "independent-candidate-build", "status": "passed",
                 "sourceCommit": "a" * 40, "sourceDirty": False, "sdkArtifact": sdk,
                 "platform": {"system": "Darwin", "machine": "arm64"}, "packages": [record],
                 "commands": [{"name": framework + "-tests", "status": "passed", "exitCode": 0,
                               "testCounts": {"framework": framework, "executed": 1, "passed": 1, "failed": 0}}
                              for framework in ("python", "rust", "node")]}
        (root / "build.json").write_bytes(release.encoded(build))
        selection = {"formatVersion": 1, "reviewed": True, "plugin": plugin, "sourceCommit": "a" * 40,
                     "buildReport": "build.json", "archive": "candidate.tar", "archiveSha256": record["archiveSha256"],
                     "packageDigest": inspection["packageDigest"], "sdkArtifact": sdk, "compatibilityReports": ["matrix.json"],
                     "hostSupport": {"repository": release.MATRIX.HOST_REPOSITORY, "commit": "b" * 40,
                                     "platform": {"operatingSystem": "macos", "architecture": "aarch64"}, "minimumIsCurrent": True},
                     "inspector": {"binary": "approved-inspector", "sha256": release.digest(inspector.read_bytes()), "declaredHostCommit": "b" * 40},
                     "bootstrap": {"reviewed": True, "reason": "No published Process-3 plugin baseline exists."}}
        results = [self.row(selection, "paired", "paired-candidates"), self.row(selection, "declared", "candidate-plugins-declared-host")]
        absent = {"id": "released", "kind": "candidate-host-released-plugins", "status": "not-run", "reason": "No released baseline"}
        results.append({"id": "released", "kind": absent["kind"], "status": "not-run", "reason": absent["reason"], "selection": absent})
        matrix = self.matrix(results)
        (root / "matrix.json").write_bytes(release.encoded(matrix))
        self.save_selection(root, selection)
        return selection, build, matrix, inspection

    def row(self, selection, name, kind):
        packages = {domain: {"directory": domain, "packageDigest": "e" * 64 if domain == selection["plugin"]["id"] else "f" * 64,
                             "plugin": selection["plugin"] if domain == selection["plugin"]["id"] else
                             {"publisher": "tsumugi", "id": domain, "version": "0.1.0-alpha.1"}} for domain in release.MATRIX.TESTS}
        row = {"id": name, "kind": kind, "host": {"directory": "fixture-host", "commit": "b" * 40},
               "plugins": {"sourceCommit": selection["sourceCommit"], "sourceDirty": False,
                           "sdkArtifact": selection["sdkArtifact"], "packages": packages},
               "runtime": {"tool": "tool", "host": "host", "approval": "approval.json"}}
        descriptor = {"platform": selection["hostSupport"]["platform"], "profile": "node-system-libraries-v1"}
        host = {"schemaVersion": 1, "status": "passed", "host": {"commit": "b" * 40, "dirty": False, "checkout": "/fixture/private/host",
                "after": {"commit": "b" * 40, "dirty": False}}, "consumer": {"status": "passed"},
                "runtime": {"approvalMatched": True, "approvedDescriptor": descriptor, "inspection": {"environment": descriptor}, "toolDirectory": "/fixture/private/tool"},
                "cases": [{"domain": domain, "test": test[1], "status": "passed", "packageDirectory": "/fixture/private/package",
                           "inspection": {"plugin": packages[domain]["plugin"], "packageDigest": packages[domain]["packageDigest"]},
                           "executionCounts": {"passed": 1, "failed": 0, "ignored": 0, "filteredOut": 1}}
                          for domain, test in release.MATRIX.TESTS.items()]}
        return {"id": name, "kind": kind, "status": "passed", "selection": row, "hostReport": host}

    def matrix(self, results):
        coverage = {kind: {"selected": sum(row["kind"] == kind for row in results),
                           "passed": sum(row["kind"] == kind and row["status"] == "passed" for row in results)} for kind in release.MATRIX.KINDS}
        return {"formatVersion": 1, "recordKind": "plugin-host-compatibility-matrix", "profile": "two-domain-core-adoption-v1",
                "status": "passed" if all(row["status"] == "passed" for row in results) and all(c["passed"] for c in coverage.values()) else "incomplete",
                "coverage": coverage, "combinations": results}

    def save_selection(self, root, value):
        (root / "selection.json").write_bytes(release.encoded(value))

    def prepared(self, root):
        self.fixture(root)
        plan, identity = release.prepare(root / "selection.json", root / "prepared")
        return plan, identity

    def test_prepare_freezes_only_one_independent_plugin_and_removes_local_paths(self):
        for domain, version in (("webvtt", "0.1.0-alpha.1"), ("stardew-smapi", "2.3.4-beta.2")):
            with self.subTest(domain=domain), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                selection, _, _, _ = self.fixture(root, domain, version)
                plan, identity = release.prepare(root / "selection.json", root / "prepared")
                self.assertEqual(plan["release"]["tag"], f"{domain}/v{version}")
                self.assertEqual(plan["compatibilityStatus"], "incomplete")
                self.assertEqual(plan["missingClasses"], ["candidate-host-released-plugins"])
                self.assertEqual((root / "prepared" / plan["archive"]).read_bytes(), (root / "candidate.tar").read_bytes())
                self.assertEqual(identity, release.digest((root / "prepared/release-plan.json").read_bytes()))
                self.assertEqual(len(list((root / "prepared").iterdir())), 7)
                for path in (root / "prepared").iterdir():
                    if path.suffix != ".tar":
                        self.assertNotIn(b"/fixture/private", path.read_bytes())
                        self.assertNotIn(str(root).encode(), path.read_bytes())
                self.assertFalse(any(path.name == ".inspector" for path in (root / "prepared").iterdir()))
                self.assertFalse(plan["trust"]["automaticBundling"])
                self.assertEqual(plan["archiveSha256"], selection["archiveSha256"])

    def test_prepare_rejects_unreviewed_or_changed_transport_before_inspector(self):
        for field in ("review", "transport"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                selected, _, _, _ = self.fixture(root)
                if field == "review":
                    selected["reviewed"] = False
                else:
                    (root / "candidate.tar").write_bytes(b"changed")
                self.save_selection(root, selected)
                with patch.object(release.subprocess, "run") as child, self.assertRaises(ValueError):
                    release.prepare(root / "selection.json", root / "prepared")
                child.assert_not_called()
                self.assertFalse((root / "prepared").exists())

    def test_prepare_rejects_failed_dirty_wrong_source_sdk_and_zero_effective_builds(self):
        mutations = [lambda r: r.update(status="failed"), lambda r: r.update(sourceDirty=True),
                     lambda r: r.update(sourceCommit="0" * 40), lambda r: r["sdkArtifact"].update(version="other"),
                     lambda r: r["commands"][0]["testCounts"].update(executed=0),
                     lambda r: r["commands"][0].update(status="failed"),
                     lambda r: r["packages"].append(copy.deepcopy(r["packages"][0]))]
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                _, report, _, _ = self.fixture(root)
                mutate(report)
                (root / "build.json").write_bytes(release.encoded(report))
                with patch.object(release.subprocess, "run") as child, self.assertRaises(ValueError):
                    release.prepare(root / "selection.json", root / "prepared")
                child.assert_not_called()

    def test_prepare_rejects_incomplete_false_host_runtime_and_wrong_package_evidence(self):
        mutations = [lambda r: r["hostReport"]["cases"][0]["executionCounts"].update(passed=0),
                     lambda r: r["hostReport"]["host"].update(dirty=True),
                     lambda r: r["hostReport"]["host"]["after"].update(commit="0" * 40),
                     lambda r: r["hostReport"]["runtime"].update(approvalMatched=False),
                     lambda r: r["hostReport"]["runtime"]["inspection"].update(environment={}),
                     lambda r: r["selection"]["plugins"].update(sourceCommit="0" * 40),
                     lambda r: r["selection"]["plugins"]["sdkArtifact"].update(version="other")]
        for mutate in mutations:
            with self.subTest(mutate=mutate), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                _, _, matrix, _ = self.fixture(root)
                mutate(matrix["combinations"][0])
                (root / "matrix.json").write_bytes(release.encoded(matrix))
                with patch.object(release.subprocess, "run") as child, self.assertRaises(ValueError):
                    release.prepare(root / "selection.json", root / "prepared")
                child.assert_not_called()

    def test_paired_only_and_unreviewed_bootstrap_are_rejected(self):
        for change in ("paired-only", "bootstrap"):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                selection, _, matrix, _ = self.fixture(root)
                if change == "paired-only":
                    matrix = self.matrix([matrix["combinations"][0]])
                    (root / "matrix.json").write_bytes(release.encoded(matrix))
                else:
                    selection["bootstrap"]["reviewed"] = False
                    self.save_selection(root, selection)
                with self.assertRaises(ValueError):
                    release.prepare(root / "selection.json", root / "prepared")

    def test_separate_reports_can_supply_actual_paired_and_declared_classes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            selection, _, matrix, _ = self.fixture(root)
            selection["compatibilityReports"] = ["paired.json", "declared.json"]
            for name, result in zip(selection["compatibilityReports"], matrix["combinations"][:2]):
                (root / name).write_bytes(release.encoded(self.matrix([result])))
            self.save_selection(root, selection)
            plan, _ = release.prepare(root / "selection.json", root / "prepared")
            self.assertEqual(plan["compatibilityStatus"], "incomplete")

    def test_all_classes_require_real_archive_selections_and_no_bootstrap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            selected, _, matrix, _ = self.fixture(root)
            released = self.row(selected, "released", "candidate-host-released-plugins")
            for package in released["selection"]["plugins"]["packages"].values():
                del package["directory"]
                package["archive"] = {"url": "https://example.invalid/released.tar", "sha256": "1" * 64}
            matrix = self.matrix([*matrix["combinations"][:2], released])
            selected["bootstrap"] = None
            self.save_selection(root, selected)
            (root / "matrix.json").write_bytes(release.encoded(matrix))
            plan, _ = release.prepare(root / "selection.json", root / "prepared")
            self.assertEqual(plan["compatibilityStatus"], "passed")
            self.assertEqual(plan["missingClasses"], [])

    def test_inspection_mismatch_sdk_mismatch_and_wrong_inspector_are_rejected(self):
        for changed in ("package", "sdk", "inspector"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                selected, _, _, _ = self.fixture(root, sdk_actual={"different": "captured SDK"} if changed == "sdk" else None)
                if changed == "package":
                    # The reviewed digest is valid syntax but disagrees with the
                    # independent inspector; make original matrix claims agree.
                    selected["packageDigest"] = "0" * 64
                    value = json.loads((root / "matrix.json").read_text())
                    for result in value["combinations"][:2]:
                        result["selection"]["plugins"]["packages"]["webvtt"]["packageDigest"] = "0" * 64
                        result["hostReport"]["cases"][0]["inspection"]["packageDigest"] = "0" * 64
                    (root / "matrix.json").write_bytes(release.encoded(value))
                elif changed == "inspector":
                    selected["inspector"]["sha256"] = "0" * 64
                self.save_selection(root, selected)
                with self.assertRaises(ValueError):
                    release.prepare(root / "selection.json", root / "prepared")
                self.assertFalse((root / "prepared").exists())

    def test_inspector_executes_captured_bytes_after_original_is_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            original = release.CANDIDATE.capture_inspector
            def capture(*args):
                value = original(*args)
                (root / "approved-inspector").write_text("must not execute replacement", encoding="utf-8")
                return value
            with patch.object(release.CANDIDATE, "capture_inspector", side_effect=capture):
                release.prepare(root / "selection.json", root / "prepared")

    def test_existing_output_and_symbolic_archive_are_preserved_and_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.fixture(root)
            release.prepare(root / "selection.json", root / "prepared")
            marker = (root / "prepared/release-plan.json").read_bytes()
            with self.assertRaises(FileExistsError):
                release.prepare(root / "selection.json", root / "prepared")
            self.assertEqual((root / "prepared/release-plan.json").read_bytes(), marker)
            (root / "candidate.tar").rename(root / "real.tar")
            (root / "candidate.tar").symlink_to("real.tar")
            with self.assertRaises(OSError):
                release.prepare(root / "selection.json", root / "linked-output")

    def test_publish_dry_run_makes_no_gh_call_and_preserves_unsigned_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan, identity = self.prepared(root)
            gh = RecordingGh(plan["sourceCommit"])
            result = release.publish(root / "prepared", identity, root / "attempt", gh=gh)
            self.assertEqual(result["status"], "dry-run")
            self.assertEqual(gh.calls, [])
            self.assertEqual(json.loads((root / "attempt/receipt.json").read_text())["status"], "dry-run")

    def test_only_valid_semver_prereleases_can_select_independent_release_tags(self):
        for version in ("1.0.0", "1.0.0-01", "01.0.0-alpha.1", "1.0.0-alpha..1", "1.0.0-alpha/other"):
            with self.subTest(version=version), self.assertRaises(ValueError):
                release.plugin_identity({"publisher": "tsumugi", "id": "webvtt", "version": version})
        release.plugin_identity({"publisher": "tsumugi", "id": "webvtt", "version": "1.0.0-0.alpha01"})

    def test_changed_plan_or_asset_stops_before_any_remote_call(self):
        for changed in ("plan", "asset"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                plan, identity = self.prepared(root)
                selected = root / "prepared" / (release.PLAN if changed == "plan" else plan["archive"])
                selected.write_bytes(selected.read_bytes() + b"changed")
                gh = RecordingGh(plan["sourceCommit"])
                with self.assertRaises(ValueError):
                    release.publish(root / "prepared", identity, root / "attempt", True, gh)
                self.assertEqual(gh.calls, [])
                self.assertFalse((root / "attempt").exists())

    def test_fake_gh_publishes_only_after_every_uploaded_asset_is_read_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan, identity = self.prepared(root)
            gh = RecordingGh(plan["sourceCommit"])
            result = release.publish(root / "prepared", identity, root / "attempt", True, gh)
            self.assertEqual(result["status"], "published")
            self.assertEqual(gh.remote["draft"], False)
            writes = [args for args in gh.calls if args[0] == "release"]
            self.assertEqual([args[1] for args in writes], ["create", *(["upload"] * 7), *(["download"] * 7), "edit"])
            self.assertEqual(set(gh.data), {release.PLAN, *[asset["name"] for asset in plan["assets"]]})
            self.assertTrue(all("--clobber" not in call for call in gh.calls))
            self.assertEqual(result["remote"]["id"], 42)

    def test_explicit_empty_draft_recovery_checks_identity_and_never_recreates(self):
        for changed in (None, "id", "source", "published", "assets", "tag"):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                plan, identity = self.prepared(root)
                gh = RecordingGh(plan["sourceCommit"])
                gh.remote = {"id": 42, "tag_name": plan["release"]["tag"], "target_commitish": plan["sourceCommit"],
                             "draft": True, "prerelease": True, "assets": []}
                if changed == "source":
                    gh.remote["target_commitish"] = "0" * 40
                elif changed == "published":
                    gh.remote["draft"] = False
                elif changed == "assets":
                    gh.remote["assets"] = [{"name": "existing"}]
                elif changed == "tag":
                    gh.tag = {"object": {"type": "commit", "sha": plan["sourceCommit"]}}
                if changed:
                    with self.assertRaises(ValueError):
                        release.publish(root / "prepared", identity, root / "attempt", True, gh, 99 if changed == "id" else 42)
                    self.assertTrue(all(args[0] == "api" for args in gh.calls))
                else:
                    result = release.publish(root / "prepared", identity, root / "attempt", True, gh, 42)
                    self.assertEqual(result["status"], "published")
                    self.assertEqual(result["recovery"]["emptyDraftId"], 42)
                    self.assertFalse(any(args[:2] == ["release", "create"] for args in gh.calls))

    def test_graphql_release_lookup_requires_a_verified_repository_and_exact_id(self):
        for response in ({"errors": [{"message": "unavailable"}]}, {"data": None}, {"data": {"repository": None}},
                         {"data": {"repository": {"release": {"databaseId": True}}}}):
            with self.subTest(response=response), patch.object(release.Gh, "run", return_value=
                    subprocess.CompletedProcess([], 0, json.dumps(response).encode(), b"")):
                with self.assertRaises(ValueError):
                    release.Gh().release("webvtt/v0.1.0-alpha.1", missing=True)

    def test_existing_release_tag_or_unavailable_reads_never_mutate(self):
        for conflict in ("release", "tag", "authentication", "transport"):
            with self.subTest(conflict=conflict), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                plan, identity = self.prepared(root)
                gh = RecordingGh(plan["sourceCommit"])
                if conflict == "release":
                    gh.remote = {"id": 999, "assets": []}
                elif conflict == "tag":
                    gh.tag = {"object": {"type": "commit", "sha": "0" * 40}}
                elif conflict == "authentication":
                    gh.read_status = 401
                else:
                    gh.read_status = 500
                with self.assertRaises(ValueError):
                    release.publish(root / "prepared", identity, root / "attempt", True, gh)
                self.assertTrue(all(args[0] == "api" for args in gh.calls))
                self.assertEqual(json.loads((root / "attempt/receipt.json").read_text())["status"], "blocked")

    def test_timeout_retains_remote_success_and_never_retries_mutations(self):
        for operation in ("create", "upload", "edit"):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                plan, identity = self.prepared(root)
                gh = RecordingGh(plan["sourceCommit"])
                gh.fail = operation
                with self.assertRaises(subprocess.TimeoutExpired):
                    release.publish(root / "prepared", identity, root / "attempt", True, gh)
                receipt = json.loads((root / "attempt/receipt.json").read_text())
                self.assertEqual(receipt["status"], "outcome-unknown")
                self.assertEqual(receipt["remote"]["id"], 42)
                self.assertEqual(sum(args[:2] == ["release", operation] for args in gh.calls), 1)
                self.assertTrue(any(e["operation"] == "reconcile-read-only" for e in receipt["events"]))
                if operation == "upload":
                    self.assertEqual(len(receipt["remote"]["assets"]), 1)
                if operation == "edit":
                    self.assertFalse(receipt["remote"]["draft"])

    def test_upload_readback_mismatch_retains_draft_and_blocks_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan, identity = self.prepared(root)
            gh = RecordingGh(plan["sourceCommit"])
            gh.corrupt_download = True
            with self.assertRaisesRegex(ValueError, "readback"):
                release.publish(root / "prepared", identity, root / "attempt", True, gh)
            self.assertTrue(gh.remote["draft"])
            self.assertFalse(any(args[:2] == ["release", "edit"] for args in gh.calls))

    def test_remote_tag_wrong_after_publication_is_reported_without_rollback(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan, identity = self.prepared(root)
            gh = RecordingGh(plan["sourceCommit"])
            original = gh.run
            def run(args):
                result = original(args)
                if args[:2] == ["release", "edit"]:
                    gh.tag["object"]["sha"] = "0" * 40
                return result
            gh.run = run
            with self.assertRaisesRegex(ValueError, "remote tag"):
                release.publish(root / "prepared", identity, root / "attempt", True, gh)
            receipt = json.loads((root / "attempt/receipt.json").read_text())
            self.assertFalse(receipt["remote"]["draft"])
            self.assertEqual(receipt["status"], "outcome-unknown")
            self.assertFalse(any("delete" in call for call in gh.calls))

    def test_conflicting_tag_during_upload_is_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan, identity = self.prepared(root)
            gh = RecordingGh(plan["sourceCommit"])
            original = gh.run
            def run(args):
                result = original(args)
                if args[:2] == ["release", "download"]:
                    gh.tag["object"]["sha"] = "0" * 40
                return result
            gh.run = run
            with self.assertRaisesRegex(ValueError, "remote tag"):
                release.publish(root / "prepared", identity, root / "attempt", True, gh)
            self.assertTrue(gh.remote["draft"])
            self.assertFalse(any(args[:2] == ["release", "edit"] for args in gh.calls))

    def test_gh_never_uses_shell_and_non_http_errors_are_not_absence(self):
        with patch.object(release.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, b"", b"not found")) as runner:
            with self.assertRaisesRegex(ValueError, "unknown"):
                release.Gh().api("repos/example/release", missing=True)
            self.assertEqual(runner.call_args.args[0][0], "gh")
            self.assertFalse(runner.call_args.kwargs.get("shell", False))
            self.assertEqual(runner.call_args.kwargs["stdin"], subprocess.DEVNULL)


if __name__ == "__main__":
    unittest.main()
