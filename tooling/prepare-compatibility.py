#!/usr/bin/env python3
"""Select frozen hosted candidates for one explicitly declared Host endpoint."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile

SPEC = importlib.util.spec_from_file_location("compatibility_matrix", Path(__file__).with_name("compatibility-matrix.py"))
MATRIX = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATRIX)
CAPTURE = MATRIX.CANDIDATE
PACKAGER = MATRIX.PACKAGER


def policy(path):
    value = MATRIX.read_json(path)
    host, candidate = value.get("host", {}), value.get("candidate", {})
    if (type(value.get("formatVersion")) is not int or value["formatVersion"] != 1 or value.get("scope") != "experimental-two-domain-core-adoption-v1"
            or host.get("repository") != MATRIX.HOST_REPOSITORY or host.get("minimumIsCurrent") is not True
            or value.get("platform") != {"operatingSystem": "macos", "architecture": "aarch64"}
            or candidate.get("repository") != "Anpimi/Tsumugi-plugins"
            or type(candidate.get("runId")) is not int or candidate["runId"] <= 0
            or candidate.get("artifact") != "plugin-candidates-macos-14"
            or set(candidate.get("archives", {})) != set(MATRIX.TESTS)
            or value.get("releasedBaseline") != "not-selected"):
        raise ValueError("select an explicit experimental Mac endpoint and hosted candidate pair")
    for label, commit in [("Host", host.get("commit")), ("PR head", candidate.get("headCommit")),
                          ("actual build", candidate.get("buildCommit"))]:
        MATRIX.pinned(commit, 40, label)
    MATRIX.pinned(value.get("sdkArtifactSha256"), 64, "SDK artifact")
    for digest in candidate["archives"].values():
        MATRIX.pinned(digest, 64, "candidate archive")
    if value.get("runtime", {}).get("platform") != value["platform"]:
        raise ValueError("approved runtime platform differs from the endpoint")
    return value


def check_run(run, selected):
    c = selected["candidate"]
    if (run.get("id") != c["runId"] or run.get("conclusion") != "success"
            or run.get("status") != "completed" or run.get("event") != "pull_request"
            or run.get("head_sha") != c["headCommit"]
            or run.get("repository", {}).get("full_name", "").lower() != c["repository"].lower()
            or run.get("path") != ".github/workflows/candidate-build.yml"):
        raise ValueError("the hosted run is not the selected successful candidate build")


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def prepare(selected, host, candidates, runtime, inspector, run_record, output):
    check_run(run_record, selected)
    host = MATRIX.host_checkout({"directory": str(host), "commit": selected["host"]["commit"]},
                                output.parent, output, dict(os.environ))
    build = MATRIX.read_json(candidates / "candidate-build.json")
    if (build.get("status") != "passed" or build.get("sourceDirty") is not False
            or build.get("sourceCommit") != selected["candidate"]["buildCommit"]
            or build.get("platform") != {"system": "Darwin", "machine": "arm64"}
            or build.get("sdkArtifact", {}).get("sha256") != selected["sdkArtifactSha256"]):
        raise ValueError("candidate report does not match the selected build, platform or SDK")
    observed = MATRIX.read_json(runtime / "inspection.json")
    if observed.get("environment") != selected["runtime"]:
        raise ValueError("prepared runtime differs from the explicitly approved descriptor")
    output.mkdir(mode=0o700)
    write_json(output / "runtime-approval.json", selected["runtime"])
    packages = {}
    for name in MATRIX.TESTS:
        matches = [p for p in build.get("packages", []) if p.get("plugin", {}).get("id") == name]
        if len(matches) != 1:
            raise ValueError("each selected domain requires exactly one candidate")
        package = matches[0]
        if package.get("archive") != name + ".tar":
            raise ValueError("candidate archive must use its explicit domain name")
        data, executable = CAPTURE.capture_file(candidates / package["archive"])
        if executable or hashlib.sha256(data).hexdigest() != selected["candidate"]["archives"][name] or package.get("archiveSha256") != selected["candidate"]["archives"][name]:
            raise ValueError("candidate transport does not match the reviewed pin")
        with (output / f"{name}-inspection.stderr.log").open("xb") as errors:
            process = subprocess.run([str(inspector), "inspect-archive"], input=data, stdout=subprocess.PIPE,
                                     stderr=errors, timeout=60, check=False)
        if process.returncode or len(process.stdout) > 1024 * 1024:
            raise ValueError("the selected Host rejected the candidate archive")
        inspection = CAPTURE.verify_inspection(process.stdout, package)
        write_json(output / f"{name}-inspection.json", inspection)
        # Only bytes just admitted by the real Host are materialized. The
        # original descriptor-relative writer still owns all output paths.
        destination = output / name
        destination.mkdir(mode=0o700)
        held = PACKAGER.directory(destination)
        try:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:") as archive:
                for member in archive:
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise ValueError("Host-admitted archive contained an unreadable member")
                    encoded = stream.read(member.size + 1)
                    PACKAGER.write(held, member.name, encoded, bool(member.mode & 0o111))
        finally:
            os.close(held)
        if MATRIX.read_json(destination / "sdk/lock.json") != build["sdkArtifact"]:
            raise ValueError("candidate SDK lock differs from its complete build selection")
        packages[name] = {"directory": str(destination), "packageDigest": inspection["packageDigest"], "plugin": inspection["plugin"]}
    common = {"host": {"directory": str(host), "commit": selected["host"]["commit"]},
              "plugins": {"sourceCommit": build["sourceCommit"], "sourceDirty": False,
                          "sdkArtifact": build["sdkArtifact"], "packages": packages},
              "runtime": {"tool": str(runtime / "tool"), "host": str(runtime / "host"),
                          "approval": str(output / "runtime-approval.json")}}
    matrix = {"formatVersion": 1, "combinations": [
        dict(common, id="paired-current-candidates", kind="paired-candidates"),
        dict(common, id="declared-experimental-host", kind="candidate-plugins-declared-host"),
        {"id": "released-baseline-unavailable", "kind": "candidate-host-released-plugins", "status": "not-run",
         "reason": "No released baseline was selected. Hosted development archives remain candidates."}]}
    MATRIX.validate_matrix(matrix)
    write_json(output / "selection.json", matrix)
    write_json(output / "input-summary.json", {"hostSupport": selected["host"], "platform": selected["platform"],
               "candidateRun": selected["candidate"], "actualBuildCommit": build["sourceCommit"],
               "sdkArtifact": build["sdkArtifact"], "runtimeApprovalMatched": True,
               "publication": "not-run", "scope": "paired and declared endpoint only; released class remains not-run"})
    return matrix


def check_selected(report, selected):
    if report.get("status") != "incomplete":
        raise ValueError("the bootstrap matrix must preserve its incomplete release class")
    rows = report.get("combinations", [])
    expected = {"paired-candidates", "candidate-plugins-declared-host", "candidate-host-released-plugins"}
    if len(rows) != 3 or {r.get("kind") for r in rows} != expected:
        raise ValueError("selected matrix classes changed")
    for row in rows:
        if row["kind"] == "candidate-host-released-plugins":
            if row.get("status") != "not-run" or not row.get("reason"):
                raise ValueError("a candidate cannot be relabelled as a released baseline")
            continue
        selection = row.get("selection", {})
        if (row.get("status") != "passed" or selection.get("host", {}).get("commit") != selected["host"]["commit"]
                or selection.get("plugins", {}).get("sourceCommit") != selected["candidate"]["buildCommit"]
                or selection.get("plugins", {}).get("sdkArtifact", {}).get("sha256") != selected["sdkArtifactSha256"]):
            raise ValueError("the selected declared/paired row did not pass")
        MATRIX.verify_result(row.get("hostReport", {}), selection)
        if row["hostReport"]["host"].get("dirty") is not False:
            raise ValueError("declared Host evidence must identify a clean checkout")
        runtime = row["hostReport"].get("runtime", {})
        if runtime.get("approvalMatched") is not True or runtime.get("approvedDescriptor") != selected["runtime"]:
            raise ValueError("the selected row did not execute with the approved runtime")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["describe", "prepare", "check"])
    parser.add_argument("--policy", required=True, type=Path)
    for name in ["host", "candidates", "runtime", "inspector", "run-record", "output", "report"]:
        parser.add_argument("--" + name, type=Path)
    args = parser.parse_args()
    selected = policy(args.policy)
    if args.mode == "describe":
        print("host_commit=" + selected["host"]["commit"])
        print("run_id=" + str(selected["candidate"]["runId"]))
        print("artifact=" + selected["candidate"]["artifact"])
    elif args.mode == "prepare":
        if not all([args.host, args.candidates, args.runtime, args.inspector, args.run_record, args.output]):
            parser.error("prepare requires explicit Host, candidate, runtime, inspector, run record and new output paths")
        prepare(selected, args.host.absolute(), args.candidates.absolute(), args.runtime.absolute(),
                args.inspector.absolute(), MATRIX.read_json(args.run_record), args.output.absolute())
    else:
        if not args.report:
            parser.error("check requires the actual matrix report")
        check_selected(MATRIX.read_json(args.report), selected)
        print("Paired and declared Host rows passed; full matrix remains incomplete, released baseline not-run.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        parser_message = str(error)
        raise SystemExit(parser_message)
