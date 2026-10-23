#!/usr/bin/env python3
"""Prepare reviewed fixed bytes and explicitly publish one experimental plugin."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import quote


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("release_compatibility", HERE / "compatibility-matrix.py")
MATRIX = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MATRIX)
CANDIDATE, PACKAGER = MATRIX.CANDIDATE, MATRIX.PACKAGER
REPOSITORY = "Anpimi/Tsumugi-plugins"
GH_REPOSITORY = "github.com/" + REPOSITORY
KIND = "unsigned-experimental-development-archive"
PLAN = "release-plan.json"
PRERELEASE_PART = r"(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-" + PRERELEASE_PART + r"(?:\." + PRERELEASE_PART + r")*")
ASSET = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def read_json(path, limit=8 * 1024 * 1024):
    return CANDIDATE.json_object(CANDIDATE.capture_file(path, limit)[0])


def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError(f"invalid {label} fields")
    return value


def new_directory(path):
    path = Path(os.path.abspath(path))
    held = PACKAGER.directory(path.parent)
    try:
        os.mkdir(path.name, mode=0o700, dir_fd=held)
    finally:
        os.close(held)
    return path


def write_files(path, files):
    held = PACKAGER.directory(path)
    try:
        for name, data in files.items():
            PACKAGER.write(held, name, data, False)
    finally:
        os.close(held)


def plugin_identity(value):
    exact(value, ("publisher", "id", "version"), "plugin identity")
    if (value["id"] not in MATRIX.TESTS or not isinstance(value["publisher"], str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", value["publisher"])
            or not isinstance(value["version"], str) or len(value["version"]) > 96 or not VERSION.fullmatch(value["version"])):
        raise ValueError("select one official domain plugin with an explicit prerelease version")
    return value


def support_endpoint(value):
    exact(value, ("repository", "commit", "platform", "minimumIsCurrent"), "Host support endpoint")
    if value["repository"] != MATRIX.HOST_REPOSITORY or value["minimumIsCurrent"] is not True:
        raise ValueError("this experimental policy supports one exact minimum/current public Host")
    MATRIX.pinned(value["commit"], 40, "supported Host")
    exact(value["platform"], ("operatingSystem", "architecture"), "runtime platform")
    if value["platform"] != {"operatingSystem": "macos", "architecture": "aarch64"}:
        raise ValueError("this release policy currently supports only macOS aarch64")
    return value


def bootstrap_policy(value, released):
    if released:
        if value is not None:
            raise ValueError("bootstrap must be null when released-plugin evidence is available")
        return None
    exact(value, ("reviewed", "reason"), "bootstrap review")
    if value["reviewed"] is not True or not isinstance(value["reason"], str) or not value["reason"].strip():
        raise ValueError("missing released plugins require an explicit reviewed bootstrap reason")
    return value


def validate_build(report, selection):
    if (report.get("formatVersion") != 1 or report.get("recordKind") != "independent-candidate-build"
            or report.get("status") != "passed" or report.get("sourceDirty") is not False
            or report.get("sourceCommit") != selection["sourceCommit"]
            or report.get("sdkArtifact") != selection["sdkArtifact"]):
        raise ValueError("build report does not match the reviewed clean source and SDK")
    commands = report.get("commands")
    if not isinstance(commands, list) or not commands:
        raise ValueError("build report has no executed commands")
    frameworks = set()
    for command in commands:
        if not isinstance(command, dict) or command.get("status") != "passed" or command.get("exitCode") != 0:
            raise ValueError("every reported build command must have passed")
        if "testCounts" in command:
            counts = command["testCounts"]
            if (not isinstance(counts, dict) or type(counts.get("executed")) is not int
                    or counts["executed"] <= 0 or counts.get("status") == "unavailable"
                    or counts.get("successful") is False
                    or any(counts.get(key, 0) != 0 for key in ("failed", "errors", "cancelled", "unexpectedSuccesses"))):
                raise ValueError("build tests require effective successful execution")
            frameworks.add(counts.get("framework"))
    if not {"python", "rust", "node"}.issubset(frameworks):
        raise ValueError("build report must retain Python, Rust and Node execution counts")
    packages = report.get("packages")
    matches = [p for p in packages if isinstance(p, dict) and p.get("plugin") == selection["plugin"]] if isinstance(packages, list) else []
    if len(matches) != 1 or matches[0].get("archiveSha256") != selection["archiveSha256"]:
        raise ValueError("build report must select exactly the reviewed plugin archive")
    package = matches[0]
    if package.get("packageDigest") not in (None, selection["packageDigest"]):
        raise ValueError("build report's Host package digest disagrees")
    return package


def compatibility(reports, selection):
    """Check original matrix decisions, then publish only path-free summaries."""
    summaries, passed = [], set()
    for report in reports:
        if (report.get("formatVersion") != 1 or report.get("recordKind") != "plugin-host-compatibility-matrix"
                or report.get("profile") != "two-domain-core-adoption-v1"):
            raise ValueError("unsupported compatibility evidence")
        results = report.get("combinations")
        if not isinstance(results, list) or not results:
            raise ValueError("compatibility report has no combinations")
        rows = MATRIX.validate_matrix({"formatVersion": 1, "combinations": [r["selection"] for r in results]})
        coverage = {kind: {"selected": sum(r["kind"] == kind for r in results),
                           "passed": sum(r["kind"] == kind and r["status"] == "passed" for r in results)} for kind in MATRIX.KINDS}
        expected_status = "failed" if any(r["status"] == "failed" for r in results) else (
            "incomplete" if any(r["status"] != "passed" for r in results) or any(c["passed"] == 0 for c in coverage.values()) else "passed")
        if report.get("coverage") != coverage or report.get("status") != expected_status or expected_status == "failed":
            raise ValueError("compatibility matrix summary is inconsistent or failed")
        for result, row in zip(results, rows):
            kind = row["kind"]
            if result.get("id") != row["id"] or result.get("kind") != kind:
                raise ValueError("compatibility result does not match its selection")
            if result.get("status") == "not-run":
                if kind != "candidate-host-released-plugins" or row.get("status") != "not-run":
                    raise ValueError("only the released-plugin class may remain not-run")
                continue
            if result.get("status") != "passed" or row.get("status") == "not-run":
                raise ValueError("every executed compatibility row must have passed")
            host = result.get("hostReport")
            MATRIX.verify_result(host, row)
            identity = host["host"]
            runtime = host.get("runtime", {})
            approved = runtime.get("approvedDescriptor")
            if (identity.get("dirty") is not False
                    or identity.get("after") != {"commit": row["host"]["commit"], "dirty": False}
                    or row["host"]["commit"] != selection["hostSupport"]["commit"]
                    or host.get("consumer", {}).get("status") != "passed"
                    or runtime.get("approvalMatched") is not True or not isinstance(approved, dict)
                    or runtime.get("inspection", {}).get("environment") != approved
                    or approved.get("platform") != selection["hostSupport"]["platform"]):
                raise ValueError("compatibility evidence differs from the clean supported Host/runtime")
            if kind != "candidate-host-released-plugins":
                plugins = row["plugins"]
                selected = plugins["packages"][selection["plugin"]["id"]]
                if (plugins["sourceCommit"] != selection["sourceCommit"] or plugins["sourceDirty"] is not False
                        or plugins["sdkArtifact"] != selection["sdkArtifact"]
                        or selected["plugin"] != selection["plugin"] or selected["packageDigest"] != selection["packageDigest"]):
                    raise ValueError("compatibility evidence does not cover the reviewed candidate bytes")
            passed.add(kind)
            summaries.append({"id": row["id"], "kind": kind, "status": "passed", "hostCommit": identity["commit"],
                              "hostCleanBeforeAndAfter": True, "platform": approved["platform"],
                              "sourceCommit": row["plugins"]["sourceCommit"], "sdkArtifact": row["plugins"]["sdkArtifact"],
                              "cases": [{key: case[key] for key in ("domain", "test", "status", "inspection", "executionCounts")} for case in host["cases"]]})
    if not {"paired-candidates", "candidate-plugins-declared-host"}.issubset(passed):
        raise ValueError("both paired and declared-Host actual compatibility evidence are required")
    bootstrap = bootstrap_policy(selection["bootstrap"], "candidate-host-released-plugins" in passed)
    return {"profile": "two-domain-core-adoption-v1", "status": "incomplete" if bootstrap else "passed",
            "missingClasses": ["candidate-host-released-plugins"] if bootstrap else [], "combinations": summaries,
            "bootstrap": bootstrap, "evidenceOrigin": "operator-reviewed reports; not independently authenticated build provenance"}


def prepare(selection_path, output):
    selection_path = Path(os.path.abspath(selection_path))
    selection = read_json(selection_path)
    exact(selection, ("formatVersion", "reviewed", "plugin", "sourceCommit", "buildReport", "archive", "archiveSha256",
                      "packageDigest", "sdkArtifact", "compatibilityReports", "hostSupport", "inspector", "bootstrap"), "reviewed selection")
    if type(selection["formatVersion"]) is not int or selection["formatVersion"] != 1 or selection["reviewed"] is not True:
        raise ValueError("an explicit reviewed formatVersion 1 selection is required")
    plugin_identity(selection["plugin"])
    support_endpoint(selection["hostSupport"])
    MATRIX.pinned(selection["sourceCommit"], 40, "plugin source")
    MATRIX.pinned(selection["archiveSha256"], 64, "transport archive")
    MATRIX.pinned(selection["packageDigest"], 64, "Host package digest")
    sdk = selection["sdkArtifact"]
    if not isinstance(sdk, dict) or not isinstance(sdk.get("version"), str) or not sdk["version"]:
        raise ValueError("complete SDK artifact selection is required")
    MATRIX.pinned(sdk.get("sha256"), 64, "SDK archive")
    MATRIX.pinned(sdk.get("sourceCommit"), 40, "SDK producer")
    base = selection_path.parent
    selected_path = lambda value: MATRIX.selected_path(base, value)
    build = read_json(selected_path(selection["buildReport"]))
    package = validate_build(build, selection)
    paths = selection["compatibilityReports"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= 16:
        raise ValueError("select between one and sixteen actual compatibility reports")
    evidence = compatibility([read_json(selected_path(path)) for path in paths], selection)
    archive, _ = CANDIDATE.capture_file(selected_path(selection["archive"]), PACKAGER.MAX_BYTES + 1024 * 1024)
    if digest(archive) != selection["archiveSha256"]:
        raise ValueError("reviewed transport digest mismatch")
    inspector = exact(selection["inspector"], ("binary", "sha256", "declaredHostCommit"), "inspector selection")
    MATRIX.pinned(inspector["sha256"], 64, "inspector binary")
    MATRIX.pinned(inspector["declaredHostCommit"], 40, "declared inspector Host")
    if inspector["declaredHostCommit"] != selection["hostSupport"]["commit"]:
        raise ValueError("inspector must declare the reviewed Host endpoint")
    # A disposable capture is never copied to the release output. The child only
    # inspects the captured archive; neither operation starts plugin code.
    with tempfile.TemporaryDirectory(prefix="plugin-release-inspector-") as temporary:
        binary, _, _ = CANDIDATE.capture_inspector((selected_path(inspector["binary"]), inspector["sha256"], inspector["declaredHostCommit"]), Path(temporary))
        result = subprocess.run([str(binary), "inspect-archive"], input=archive, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=False)
        if result.returncode or len(result.stdout) > PACKAGER.MAX_MANIFEST_BYTES:
            raise ValueError("approved Host archive inspection failed")
        inspection = CANDIDATE.verify_inspection(result.stdout, package)
    if inspection["packageDigest"] != selection["packageDigest"]:
        raise ValueError("reviewed Host package digest mismatch")
    # This reads one data file only after the real Host admitted the complete tar.
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as admitted:
        lock = admitted.extractfile("sdk/lock.json")
        if lock is None:
            raise ValueError("the admitted package has no SDK lock")
        sdk_bytes = lock.read(PACKAGER.MAX_MANIFEST_BYTES + 1)
    if len(sdk_bytes) > PACKAGER.MAX_MANIFEST_BYTES or CANDIDATE.json_object(sdk_bytes) != sdk:
        raise ValueError("reviewed SDK artifact mismatch")
    plugin = selection["plugin"]
    tag = f"{plugin['id']}/v{plugin['version']}"
    archive_name = f"{plugin['id']}-{plugin['version']}.tar"
    notes = (f"# {plugin['id']} {plugin['version']}\n\n"
             "Unsigned experimental development archive. This is not a TUF-authenticated repository, "
             "publisher authentication, automatic bundled-plugin selection or execution approval.\n\n"
             f"Source commit: `{selection['sourceCommit']}` (reviewed declaration).\n"
             f"Supported experimental Host: `{selection['hostSupport']['commit']}`; macOS aarch64 only; minimum = current.\n"
             f"Archive SHA-256: `{selection['archiveSha256']}`.\nHost packageDigest: `{selection['packageDigest']}`.\n\n"
             "Paired-candidate and declared-Host journeys passed for these exact package identities.\n"
             + ("First-publication bootstrap: no released-plugin baseline has been tested; the compatibility matrix remains incomplete.\n" if evidence["bootstrap"] else "All three selected compatibility classes passed.\n"))
    files = {archive_name: archive, "sdk-lock.json": encoded(sdk), "inspection.json": encoded(inspection),
             "compatibility.json": encoded(evidence), "release-notes.md": notes.encode("utf-8"),
             "build-summary.json": encoded({"recordKind": build["recordKind"], "sourceCommit": build["sourceCommit"],
                  "sourceDirty": False, "platform": build.get("platform"), "sdkArtifact": sdk,
                  "commands": [{key: command[key] for key in ("name", "status", "exitCode", "testCounts") if key in command} for command in build["commands"]]})}
    plan = {"formatVersion": 1, "recordKind": "reviewed-plugin-release-plan", "publicationKind": KIND,
            "repository": REPOSITORY, "plugin": plugin, "sourceCommit": selection["sourceCommit"], "sourceDirty": False,
            "sdkArtifact": sdk, "packageDigest": selection["packageDigest"], "archive": archive_name,
            "archiveSha256": selection["archiveSha256"], "hostSupport": selection["hostSupport"],
            "compatibilityStatus": evidence["status"], "missingClasses": evidence["missingClasses"], "bootstrap": evidence["bootstrap"],
            "release": {"tag": tag, "targetCommit": selection["sourceCommit"], "prerelease": True, "latest": False},
            "trust": {"tufSigning": "not-run", "automaticBundling": False, "sourceProvenanceIndependentlyVerified": False},
            "inspector": {"sha256": inspector["sha256"], "declaredHostCommit": inspector["declaredHostCommit"], "sourceProvenanceIndependentlyVerified": False},
            "assets": [{"name": name, "sha256": digest(data), "bytes": len(data)} for name, data in sorted(files.items())]}
    files[PLAN] = encoded(plan)
    destination = new_directory(output)
    write_files(destination, files)
    return plan, digest(files[PLAN])


def captured_plan(prepared, expected):
    MATRIX.pinned(expected, 64, "reviewed release plan")
    data, _ = CANDIDATE.capture_file(Path(prepared) / PLAN, 1024 * 1024)
    if digest(data) != expected:
        raise ValueError("prepared release plan differs from the explicitly approved digest")
    plan = CANDIDATE.json_object(data)
    if (plan.get("formatVersion") != 1 or plan.get("recordKind") != "reviewed-plugin-release-plan"
            or plan.get("publicationKind") != KIND or plan.get("repository") != REPOSITORY
            or plan.get("sourceDirty") is not False
            or plan.get("trust") != {"tufSigning": "not-run", "automaticBundling": False, "sourceProvenanceIndependentlyVerified": False}):
        raise ValueError("only reviewed unsigned experimental releases can be published")
    plugin = plugin_identity(plan.get("plugin"))
    support_endpoint(plan.get("hostSupport"))
    source = MATRIX.pinned(plan.get("sourceCommit"), 40, "release source")
    tag = f"{plugin['id']}/v{plugin['version']}"
    if plan.get("release") != {"tag": tag, "targetCommit": source, "prerelease": True, "latest": False}:
        raise ValueError("release must use its independent prerelease tag and exact source commit")
    assets = plan.get("assets")
    if not isinstance(assets, list) or len(assets) != 6:
        raise ValueError("prepared release must contain its exact reviewed asset set")
    files = {PLAN: data}
    for asset in assets:
        exact(asset, ("name", "sha256", "bytes"), "asset")
        name = asset["name"]
        if not isinstance(name, str) or not ASSET.fullmatch(name) or name in files:
            raise ValueError("release asset names must be unique ordinary basenames")
        MATRIX.pinned(asset["sha256"], 64, "release asset")
        captured, _ = CANDIDATE.capture_file(Path(prepared) / name, PACKAGER.MAX_BYTES + 1024 * 1024)
        if type(asset["bytes"]) is not int or len(captured) != asset["bytes"] or digest(captured) != asset["sha256"]:
            raise ValueError("prepared release asset differs from reviewed bytes")
        files[name] = captured
    required = {PLAN, f"{plugin['id']}-{plugin['version']}.tar", "sdk-lock.json", "inspection.json", "compatibility.json", "release-notes.md", "build-summary.json"}
    if set(files) != required or plan.get("archive") not in files or digest(files[plan["archive"]]) != plan.get("archiveSha256"):
        raise ValueError("prepared release contains an unexpected asset set")
    evidence = CANDIDATE.json_object(files["compatibility.json"])
    observed = {row.get("kind") for row in evidence.get("combinations", []) if isinstance(row, dict) and row.get("status") == "passed"}
    if (not {"paired-candidates", "candidate-plugins-declared-host"}.issubset(observed)
            or evidence.get("profile") != "two-domain-core-adoption-v1"
            or evidence.get("bootstrap") != plan.get("bootstrap")
            or evidence.get("missingClasses") != plan.get("missingClasses")
            or evidence.get("status") != plan.get("compatibilityStatus")):
        raise ValueError("prepared plan and compatibility eligibility disagree")
    bootstrap = bootstrap_policy(plan.get("bootstrap"), "candidate-host-released-plugins" in observed)
    if (plan.get("compatibilityStatus") != ("incomplete" if bootstrap else "passed")
            or plan.get("missingClasses") != (["candidate-host-released-plugins"] if bootstrap else [])):
        raise ValueError("prepared compatibility limitations do not match the release policy")
    return plan, files


class Gh:
    def run(self, args):
        return subprocess.run(["gh", *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=120, check=False)

    def api(self, path, missing=False):
        result = self.run(["api", "--hostname", "github.com", "--method", "GET", "--include", path])
        # --include exposes the actual HTTP status, so authentication, transport
        # errors and timeouts cannot be mistaken for an absent release or tag.
        raw = result.stdout.replace(b"\r\n", b"\n")
        blocks = raw.split(b"\n\n")
        for number, block in enumerate(blocks[:-1]):
            if block.startswith(b"HTTP/"):
                match = re.match(rb"HTTP/\S+ (\d{3})\b", block)
                if match:
                    status = int(match[1])
                    if status == 404 and missing:
                        return None
                    if result.returncode or status != 200:
                        raise ValueError("GitHub read did not return an authenticated successful response")
                    return CANDIDATE.json_object(b"\n\n".join(blocks[number + 1:]))
        raise ValueError("GitHub read has no usable HTTP status; outcome is unknown")


def publish(prepared, expected, output, execute=False, gh=None):
    plan, files = captured_plan(Path(os.path.abspath(prepared)), expected)
    attempt = new_directory(output)
    upload = new_directory(attempt / "upload")
    write_files(upload, files)
    receipt = {"formatVersion": 1, "recordKind": "plugin-publication-receipt", "planSha256": expected,
               "repository": REPOSITORY, "tag": plan["release"]["tag"], "status": "dry-run", "events": [],
               "publicationKind": KIND, "remote": None}
    journal = (attempt / "events.jsonl").open("x", encoding="utf-8")

    def event(operation, outcome):
        value = {"operation": operation, "outcome": outcome}
        receipt["events"].append(value)
        journal.write(json.dumps(value) + "\n")
        journal.flush()
        os.fsync(journal.fileno())

    gh = gh or Gh()
    tag = plan["release"]["tag"]
    prefix = f"repos/{REPOSITORY}"
    release_path = f"{prefix}/releases/tags/{quote(tag, safe='')}"
    ref_path = f"{prefix}/git/ref/tags/{quote(tag, safe='')}"
    created_id = None

    def observe():
        value = gh.api(release_path, missing=True)
        if value is not None:
            receipt["remote"] = {key: value.get(key) for key in ("id", "html_url", "tag_name", "target_commitish", "draft", "prerelease")}
            receipt["remote"]["assets"] = [{key: asset.get(key) for key in ("id", "name", "size", "state", "digest")} for asset in value.get("assets", [])]
        return value

    def checked_release(value, draft):
        if (not isinstance(value, dict) or type(value.get("id")) is not int
                or (created_id is not None and value["id"] != created_id)
                or value.get("tag_name") != tag or value.get("target_commitish") != plan["sourceCommit"]
                or value.get("draft") is not draft or value.get("prerelease") is not True):
            raise ValueError("remote release differs from this exact publication attempt")
        return value

    def mutate(operation, args):
        event(operation, "outcome-unknown")
        result = gh.run(args)
        if result.returncode:
            raise ValueError(f"{operation} did not complete successfully; inspect retained remote state before any retry")
        event(operation, "command-returned-success")

    def check_tag(allow_missing=False):
        ref = gh.api(ref_path, missing=allow_missing)
        if ref is None:
            return
        target = ref.get("object", {})
        for _ in range(4):
            if target.get("type") != "tag":
                break
            target = gh.api(f"{prefix}/git/tags/{MATRIX.pinned(target.get('sha'), 40, 'remote tag')}").get("object", {})
        receipt["remoteTag"] = {key: target.get(key) for key in ("type", "sha")}
        if target.get("type") != "commit" or target.get("sha") != plan["sourceCommit"]:
            raise ValueError("remote tag does not identify the reviewed source commit")

    try:
        if not execute:
            event("publication", "not-run; explicit --execute authorization is required")
            return receipt
        receipt["status"] = "checking"
        commit = gh.api(f"{prefix}/git/commits/{plan['sourceCommit']}")
        if commit.get("sha") != plan["sourceCommit"]:
            raise ValueError("reviewed source commit is not available in the publication repository")
        if observe() is not None or gh.api(ref_path, missing=True) is not None:
            raise ValueError("release/tag already exists; no overwrite or automatic resumption is allowed")
        receipt["status"] = "outcome-unknown"
        mutate("create-draft", ["release", "create", tag, "--repo", GH_REPOSITORY, "--draft", "--prerelease", "--latest=false",
                                  "--target", plan["sourceCommit"], "--title", f"{plan['plugin']['id']} {plan['plugin']['version']}",
                                  "--notes-file", str(upload / "release-notes.md")])
        remote = checked_release(observe(), True)
        created_id = remote["id"]
        event("create-draft", "remote-draft-confirmed")
        for name in sorted(files):
            mutate(f"upload:{name}", ["release", "upload", tag, str(upload / name), "--repo", GH_REPOSITORY])
            checked_release(observe(), True)
        remote = checked_release(observe(), True)
        assets = remote.get("assets", [])
        if (len(assets) != len(files) or {asset.get("name") for asset in assets} != set(files)
                or any(asset.get("state") != "uploaded" or asset.get("size") != len(files[asset["name"]]) for asset in assets)):
            raise ValueError("draft assets do not match the exact reviewed release set")
        downloads = new_directory(attempt / "download")
        for name in sorted(files):
            result = gh.run(["release", "download", tag, "--repo", GH_REPOSITORY, "--pattern", name, "--dir", str(downloads)])
            if result.returncode or CANDIDATE.capture_file(downloads / name, PACKAGER.MAX_BYTES + 1024 * 1024)[0] != files[name]:
                raise ValueError("uploaded asset readback does not match reviewed bytes; draft retained")
        event("verify-uploaded-assets", "passed")
        confirmed_assets = [{key: asset.get(key) for key in ("id", "name", "size", "state", "digest")} for asset in assets]
        check_tag(allow_missing=True)
        mutate("publish-prerelease", ["release", "edit", tag, "--repo", GH_REPOSITORY, "--draft=false", "--prerelease", "--latest=false"])
        remote = checked_release(observe(), False)
        if [{key: asset.get(key) for key in ("id", "name", "size", "state", "digest")} for asset in remote.get("assets", [])] != confirmed_assets:
            raise ValueError("remote assets changed during publication; inspect published state")
        check_tag()
        receipt["status"] = "published"
        event("publication", "published-prerelease-confirmed")
        return receipt
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        receipt["status"] = "outcome-unknown" if any(e["outcome"] == "outcome-unknown" for e in receipt["events"]) else "blocked"
        receipt["failure"] = str(error) if isinstance(error, ValueError) else type(error).__name__
        try:
            observe()
            event("reconcile-read-only", "remote-state-recorded")
        except (OSError, ValueError, subprocess.SubprocessError):
            event("reconcile-read-only", "unavailable; inspect remote state before retry")
        raise
    finally:
        journal.close()
        write_files(attempt, {"receipt.json": encoded(receipt)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    preparing = commands.add_parser("prepare", help="inspect reviewed fixed bytes without publication")
    preparing.add_argument("--selection", type=Path, required=True)
    preparing.add_argument("--output", type=Path, required=True)
    publishing = commands.add_parser("publish", help="dry-run by default; only a trusted operator may explicitly execute")
    publishing.add_argument("--prepared", type=Path, required=True)
    publishing.add_argument("--expected-plan-sha256", required=True)
    publishing.add_argument("--output", type=Path, required=True)
    publishing.add_argument("--execute", action="store_true", help="explicitly authorize remote draft creation, uploads, tag creation and publication")
    args = parser.parse_args()
    if args.command == "prepare":
        _, identity = prepare(args.selection, args.output)
        print(f"Prepared one unsigned experimental prerelease. Reviewed plan SHA-256: {identity}")
        print("Publication and production TUF signing remain NOT-RUN.")
    else:
        result = publish(args.prepared, args.expected_plan_sha256, args.output, args.execute)
        print(f"Publication status: {result['status']}; retained receipt: {args.output / 'receipt.json'}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, subprocess.SubprocessError) as error:
        print(f"Plugin release stopped: {error}", file=sys.stderr)
        sys.exit(1)
