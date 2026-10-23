import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location("prepare_compatibility", ROOT / "tooling/prepare-compatibility.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
spec = importlib.util.spec_from_file_location("matrix_fixtures", Path(__file__).with_name("test_compatibility_matrix.py"))
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class PrepareCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.policy = prepare.policy(ROOT / "compatibility/macos-aarch64.json")
        self.policy["releasedBaseline"] = "not-selected"

    def report(self):
        rows = []
        for kind in ["paired-candidates", "candidate-plugins-declared-host"]:
            row = fixtures.row(kind, kind)
            row["host"]["commit"] = self.policy["host"]["commit"]
            row["plugins"]["sourceCommit"] = self.policy["candidate"]["buildCommit"]
            row["plugins"]["sdkArtifact"]["sha256"] = self.policy["sdkArtifactSha256"]
            host = fixtures.host_report(row)
            host["host"]["after"] = {"commit": self.policy["host"]["commit"], "dirty": False}
            host["runtime"] = {"approvalMatched": True, "approvedDescriptor": self.policy["runtime"],
                               "inspection": {"environment": self.policy["runtime"]}}
            rows.append({"kind": kind, "status": "passed", "selection": row, "hostReport": host})
        rows.append({"kind": "candidate-host-released-plugins", "status": "not-run", "reason": "No released baseline selected"})
        return {"status": "incomplete", "combinations": rows}

    def test_explicit_policy_rejects_unpinned_or_different_origins(self):
        for mutation in [lambda p: p["host"].update(commit="main"),
                         lambda p: p["host"].update(repository="https://example.invalid/Host"),
                         lambda p: p["candidate"].update(runId=True),
                         lambda p: p["candidate"].update(artifact="other-artifact"),
                         lambda p: p.update(formatVersion=True),
                         lambda p: p.update(releasedBaseline="candidate-is-released")]:
            value = copy.deepcopy(self.policy)
            mutation(value)
            with tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "policy.json"
                path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(ValueError):
                    prepare.policy(path)

    def test_hosted_run_must_match_successful_exact_build(self):
        run = {"id": self.policy["candidate"]["runId"], "head_sha": self.policy["candidate"]["headCommit"],
               "conclusion": "success", "status": "completed", "event": "pull_request",
               "repository": {"full_name": "Anpimi/Tsumugi-plugins"}, "path": ".github/workflows/candidate-build.yml"}
        prepare.check_run(run, self.policy)
        for mutation in [lambda r: r.update(conclusion="failure"), lambda r: r.update(id=1),
                         lambda r: r.update(head_sha="a" * 40), lambda r: r.update(event="workflow_run"),
                         lambda r: r.update(path=".github/workflows/other.yml")]:
            wrong = copy.deepcopy(run)
            mutation(wrong)
            with self.assertRaises(ValueError):
                prepare.check_run(wrong, self.policy)

    def test_scoped_success_preserves_missing_release_gate(self):
        report = self.report()
        prepare.check_selected(report, self.policy)
        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["combinations"][-1]["status"], "not-run")

    def test_failed_empty_dirty_wrong_host_or_runtime_cannot_satisfy_scoped_job(self):
        mutations = [lambda r: r.update(status="passed"),
                     lambda r: r["combinations"][0].update(status="failed"),
                     lambda r: r["combinations"][-1].update(status="passed"),
                     lambda r: r["combinations"].pop(),
                     lambda r: r["combinations"][0]["hostReport"]["cases"][0]["executionCounts"].update(passed=0),
                     lambda r: r["combinations"][0]["hostReport"]["host"].update(dirty=True),
                     lambda r: r["combinations"][0]["hostReport"]["host"]["after"].update(dirty=True),
                     lambda r: r["combinations"][0]["selection"]["host"].update(commit="a" * 40),
                     lambda r: r["combinations"][0]["hostReport"]["runtime"].update(approvalMatched=False),
                     lambda r: r["combinations"][0]["hostReport"]["runtime"]["inspection"].update(environment={})]
        for mutation in mutations:
            wrong = self.report()
            mutation(wrong)
            with self.assertRaises(ValueError):
                prepare.check_selected(wrong, self.policy)

    def test_selected_releases_require_three_passed_exact_archive_rows(self):
        policy = prepare.policy(ROOT / "compatibility/macos-aarch64.json")
        report = self.report()
        report["status"] = "passed"
        common = report["combinations"][0]["selection"]
        row = prepare.released_row(policy, {"host": common["host"], "runtime": common["runtime"]})
        host = fixtures.host_report(row)
        host["host"]["after"] = {"commit": policy["host"]["commit"], "dirty": False}
        host["runtime"] = report["combinations"][0]["hostReport"]["runtime"]
        report["combinations"][-1] = {"kind": row["kind"], "status": "passed", "selection": row, "hostReport": host}
        prepare.check_selected(report, policy)
        for mutate in (lambda r: r.update(status="incomplete"),
                       lambda r: r["combinations"][-1].update(status="not-run"),
                       lambda r: r["combinations"][-1]["selection"]["plugins"]["packages"]["webvtt"]["archive"].update(url="https://example.invalid/other.tar"),
                       lambda r: r["combinations"][-1]["selection"]["plugins"].update(sourceDirty=True)):
            wrong = copy.deepcopy(report)
            mutate(wrong)
            with self.assertRaises(ValueError):
                prepare.check_selected(wrong, policy)

    def test_release_policy_refuses_local_or_unpinned_baselines(self):
        policy = prepare.policy(ROOT / "compatibility/macos-aarch64.json")
        for mutate in (lambda p: p["releasedBaseline"].update(sourceCommit="main"),
                       lambda p: p["releasedBaseline"]["sdkArtifact"].update(sha256="a" * 64),
                       lambda p: p["releasedBaseline"]["packages"].pop("webvtt"),
                       lambda p: p["releasedBaseline"]["packages"]["webvtt"].update(directory="local-candidate")):
            wrong = copy.deepcopy(policy)
            mutate(wrong)
            with tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "policy.json"
                path.write_text(json.dumps(wrong), encoding="utf-8")
                with self.assertRaises(ValueError):
                    prepare.policy(path)
