#!/usr/bin/env python3
"""Run explicit prebuilt plugin combinations against pinned public Host checkouts."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tarfile
import urllib.request
import urllib.parse

import importlib.util

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("candidate_build", HERE / "candidate-build.py")
CANDIDATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CANDIDATE)
PACKAGER = CANDIDATE.PACKAGER
KINDS = ("candidate-host-released-plugins", "candidate-plugins-declared-host", "paired-candidates")
TESTS = {
    "webvtt": ("source_adoption", "official_source_checks_gate_atomic_adoption_revision_updates_and_reopening"),
    "stardew-smapi": ("translation_validation", "complete_translation_requires_current_scope_independent_grants_and_saved_check_proof"),
}
HOST_REPOSITORY = "https://github.com/Anpimi/Tsumugi"


def pinned(value, width, label):
    if not isinstance(value, str) or re.fullmatch(f"[a-f0-9]{{{width}}}", value) is None:
        raise ValueError(f"{label} requires an exact lowercase {width}-digit identity")
    return value


def selected_path(base, value):
    if not isinstance(value, str) or not value:
        raise ValueError("selected path must be nonempty")
    return Path(os.path.abspath(base / value))


def read_json(path, maximum=1024 * 1024):
    return CANDIDATE.json_object(CANDIDATE.capture_file(path, maximum)[0])


def validate_matrix(value):
    if type(value.get("formatVersion")) is not int or value["formatVersion"] != 1 or set(value) != {"formatVersion", "combinations"}:
        raise ValueError("unsupported compatibility matrix")
    rows = value["combinations"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 16:
        raise ValueError("select between one and sixteen explicit combinations")
    ids = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("combination must be an object")
        name = row.get("id")
        if not isinstance(name, str) or re.fullmatch("[a-z0-9][a-z0-9-]{0,63}", name) is None or name in ids:
            raise ValueError("combination IDs must be unique portable names")
        ids.add(name)
        if row.get("kind") not in KINDS:
            raise ValueError("unknown compatibility combination kind")
        if row.get("status") == "not-run":
            if set(row) != {"id", "kind", "status", "reason"} or not isinstance(row["reason"], str) or not row["reason"].strip():
                raise ValueError("an unavailable combination requires its explicit reason")
            continue
        if set(row) != {"id", "kind", "host", "plugins", "runtime"}:
            raise ValueError("combination must select Host, plugins and runtime")
        host = row["host"]
        if not isinstance(host, dict) or set(host) not in ({"directory", "commit"}, {"repository", "commit"}):
            raise ValueError("Host selection requires a directory or the public repository")
        pinned(host["commit"], 40, "Host commit")
        if "repository" in host and host["repository"] != HOST_REPOSITORY:
            raise ValueError("automatic checkout is restricted to the public application repository")
        plugins = row["plugins"]
        if not isinstance(plugins, dict) or set(plugins) != {"sourceCommit", "sourceDirty", "sdkArtifact", "packages"}:
            raise ValueError("plugins require source and SDK declarations and both actual packages")
        pinned(plugins["sourceCommit"], 40, "plugin source commit")
        if type(plugins["sourceDirty"]) is not bool:
            raise ValueError("plugin sourceDirty must be explicit")
        if row["kind"] == "candidate-host-released-plugins" and plugins["sourceDirty"]:
            raise ValueError("a dirty source declaration cannot stand in for released plugins")
        sdk = plugins["sdkArtifact"]
        if not isinstance(sdk, dict) or not isinstance(sdk.get("version"), str) or not sdk["version"]:
            raise ValueError("SDK artifact declaration is missing")
        pinned(sdk.get("sha256"), 64, "SDK archive")
        pinned(sdk.get("sourceCommit"), 40, "SDK producer")
        packages = plugins["packages"]
        if not isinstance(packages, dict) or set(packages) != set(TESTS):
            raise ValueError("the conformance profile requires WebVTT and SMAPI packages")
        for name, package in packages.items():
            if not isinstance(package, dict) or set(package) not in ({"directory", "packageDigest", "plugin"}, {"archive", "packageDigest", "plugin"}):
                raise ValueError("package requires a selected directory or archive and exact identity")
            pinned(package["packageDigest"], 64, "Host package digest")
            identity = package["plugin"]
            if (not isinstance(identity, dict) or set(identity) != {"publisher", "id", "version"}
                    or identity["id"] != name or any(not isinstance(v, str) or not v for v in identity.values())):
                raise ValueError("package plugin identity does not match its domain")
            if "archive" in package:
                validate_download(package["archive"])
            elif row["kind"] == "candidate-host-released-plugins":
                raise ValueError("released plugins require exact transport archives")
        runtime = row["runtime"]
        if not isinstance(runtime, dict) or set(runtime) not in ({"tool", "host", "approval"}, {"archive"}):
            raise ValueError("runtime requires explicit approved trees or a transport archive")
        if "archive" in runtime:
            validate_download(runtime["archive"])
    return rows


def validate_https_url(value):
    if not isinstance(value, str):
        raise ValueError("archive URL must be a string")
    url = urllib.parse.urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment:
        raise ValueError("archive URL must be public HTTPS without credentials or a fragment")


def validate_download(value):
    if not isinstance(value, dict) or set(value) != {"url", "sha256"}:
        raise ValueError("archive requires an exact HTTPS URL and transport SHA-256")
    validate_https_url(value["url"])
    pinned(value["sha256"], 64, "transport archive")


class HttpsRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        # Refuse the next hop before urllib can send it, including a transient
        # HTTP hop that might redirect back to HTTPS afterwards.
        validate_https_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def fetch_archive(selection, destination, maximum, max_files):
    # Transport identities are required only for downloaded material. Local
    # directories retain the original Host's complete capture/digest boundary.
    validate_download(selection)
    request = urllib.request.Request(selection["url"], headers={"User-Agent": "Tsumugi-compatibility"})
    with urllib.request.build_opener(HttpsRedirect()).open(request, timeout=60) as response:
        validate_https_url(response.geturl())
        encoded = response.read(maximum + 1)
    if len(encoded) > maximum or hashlib.sha256(encoded).hexdigest() != selection["sha256"]:
        raise ValueError("archive transport identity or size was rejected")
    files = {}
    total = 0
    # Uncompressed tar avoids an unbounded decompression stage. Nothing is
    # extracted until every member has passed the same portable path policy.
    with tarfile.open(fileobj=io.BytesIO(encoded), mode="r:") as archive:
        for member in archive:
            if not member.isfile() or member.name in files or member.size > maximum or member.mode & ~0o777:
                raise ValueError("archive must contain only unique ordinary files")
            PACKAGER.relative_file(member.name)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("archive member is unreadable")
            data = stream.read(member.size + 1)
            total += len(data)
            if len(data) != member.size or total > maximum or len(files) >= max_files:
                raise ValueError("archive material exceeds its bound")
            files[member.name] = (data, bool(member.mode & 0o111))
    destination.mkdir(mode=0o700)
    held = PACKAGER.directory(destination)
    try:
        for name, (data, executable) in files.items():
            PACKAGER.write(held, name, data, executable)
    finally:
        os.close(held)


def command(args, cwd, log, environment, timeout=2700):
    with log.open("xb") as output:
        child = subprocess.Popen(args, cwd=cwd, env=environment, stdout=output, stderr=subprocess.STDOUT,
                                 start_new_session=True)
        try:
            return child.wait(timeout=timeout)
        except BaseException:
            # Let the public Python harness cancel its separately owned Cargo/
            # Worker sessions and retain its failure report before escalation.
            try:
                os.killpg(child.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
            raise


def host_checkout(selection, base, output, environment):
    if "directory" in selection:
        path = selected_path(base, selection["directory"])
    else:
        path = output / "application"
        for number, args in enumerate([
            ["git", "init", str(path)],
            ["git", "-C", str(path), "-c", "credential.helper=", "fetch", "--depth=1", "--no-tags", HOST_REPOSITORY, selection["commit"]],
            ["git", "-C", str(path), "checkout", "--detach", selection["commit"]],
        ]):
            if command(args, base, output / f"checkout-{number}.log", environment):
                raise ValueError("pinned public Host checkout failed")
    actual = subprocess.check_output(["git", "rev-parse", "--show-toplevel", "HEAD"], cwd=path,
                                     env=environment, timeout=10, text=True).splitlines()
    if len(actual) != 2 or Path(actual[0]).resolve() != path.resolve() or actual[1] != selection["commit"]:
        raise ValueError("Host directory is not the selected application commit")
    return path


def verify_result(report, row):
    host = report.get("host")
    if (type(report.get("schemaVersion")) is not int or report["schemaVersion"] != 1
            or report.get("status") != "passed" or not isinstance(host, dict)
            or host.get("commit") != row["host"]["commit"]):
        raise ValueError("Host harness did not pass for the selected commit")
    cases = report.get("cases")
    if not isinstance(cases, list) or len(cases) != 2:
        raise ValueError("Host harness must execute both domain journeys")
    seen = set()
    for case in cases:
        if not isinstance(case, dict):
            raise ValueError("Host harness case must be an object")
        domain = case.get("domain")
        if not isinstance(domain, str) or domain not in TESTS or domain in seen or case.get("test") != TESTS[domain][1]:
            raise ValueError("Host harness changed the selected domain journey")
        seen.add(domain)
        package = row["plugins"]["packages"][domain]
        inspection = case.get("inspection", {})
        counts = case.get("executionCounts", {})
        if (not isinstance(inspection, dict) or not isinstance(counts, dict)
                or case.get("status") != "passed" or inspection.get("plugin") != package["plugin"]
                or inspection.get("packageDigest") != package["packageDigest"]
                or any(type(counts.get(key)) is not int for key in ("passed", "failed", "ignored"))
                or counts.get("passed") != 1 or counts.get("failed") != 0 or counts.get("ignored") != 0):
            raise ValueError("Host package identity or effective domain execution was rejected")


def run_row(row, base, output, environment, offline):
    host = host_checkout(row["host"], base, output, environment)
    harness = host / "crates/plugin-host/scripts/compatibility.py"
    if not harness.is_file():
        raise ValueError("selected Host does not provide this conformance profile")
    packages = {}
    for name, package in row["plugins"]["packages"].items():
        if "directory" in package:
            packages[name] = selected_path(base, package["directory"])
        else:
            packages[name] = output / name
            fetch_archive(package["archive"], packages[name], PACKAGER.MAX_BYTES + 1024 * 1024, PACKAGER.MAX_FILES)
        if read_json(packages[name] / "sdk/lock.json") != row["plugins"]["sdkArtifact"]:
            raise ValueError("package's captured SDK selection differs from the selected artifact")
    runtime = row["runtime"]
    if "archive" in runtime:
        root = output / "runtime"
        fetch_archive(runtime["archive"], root, 256 * 1024 * 1024, 1024)
        runtime = {"tool": root / "tool", "host": root / "host", "approval": root / "approval.json"}
    else:
        runtime = {key: selected_path(base, value) for key, value in runtime.items()}
    args = [sys.executable, str(harness)]
    for name, flag in [("webvtt", "webvtt"), ("stardew-smapi", "smapi")]:
        args += [f"--{flag}-package", str(packages[name]), f"--{flag}-digest", row["plugins"]["packages"][name]["packageDigest"]]
    for name in ("tool", "host", "approval"):
        args += [f"--runtime-{name}", str(runtime[name])]
    args += ["--output", str(output / "host-results")]
    if offline:
        args.append("--offline")
    exit_code = command(args, host, output / "harness.log", environment)
    report = read_json(output / "host-results/compatibility.json")
    if exit_code:
        raise ValueError(f"Host harness exited {exit_code}; retained its failed report and log")
    verify_result(report, row)
    return report


def execute(matrix, base, output, environment, offline=False):
    rows = validate_matrix(matrix)
    report = {"formatVersion": 1, "recordKind": "plugin-host-compatibility-matrix", "status": "failed",
              "profile": "two-domain-core-adoption-v1", "combinations": [], "coverage": {},
              "publication": "not-run", "provenance": "source and artifact origins are caller declarations, not independently authenticated"}
    try:
        for row in rows:
            result = {"id": row["id"], "kind": row["kind"], "selection": row, "status": "not-run"}
            report["combinations"].append(result)
            if row.get("status") == "not-run":
                result["reason"] = row["reason"]
                continue
            directory = output / row["id"]
            try:
                directory.mkdir(mode=0o700)
                result["hostReport"] = run_row(row, base, directory, environment, offline)
                result["status"] = "passed"
            except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
                result.update(status="failed", reason=str(error))
        report["coverage"] = {kind: {"selected": sum(r["kind"] == kind for r in report["combinations"]),
                                     "passed": sum(r["kind"] == kind and r["status"] == "passed" for r in report["combinations"])} for kind in KINDS}
        if any(r["status"] == "failed" for r in report["combinations"]):
            report["status"] = "failed"
        elif any(r["status"] != "passed" for r in report["combinations"]) or any(c["passed"] == 0 for c in report["coverage"].values()):
            report["status"] = "incomplete"
        else:
            report["status"] = "passed"
    finally:
        with (output / "compatibility-matrix.json").open("x", encoding="utf-8") as target:
            json.dump(report, target, indent=2)
            target.write("\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--matrix", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--offline", action="store_true", help="use prepared Cargo caches; remote artifact selections still require HTTPS")
    args = parser.parse_args()
    matrix_path = Path(os.path.abspath(args.matrix))
    matrix = read_json(matrix_path)
    validate_matrix(matrix)
    output = Path(os.path.abspath(args.output))
    held = PACKAGER.directory(output.parent)
    try:
        os.mkdir(output.name, mode=0o700, dir_fd=held)
    finally:
        os.close(held)
    environment = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    if not environment.get("CARGO_TARGET_DIR"):
        environment["CARGO_TARGET_DIR"] = str(output / ".cargo-target")
    report = execute(matrix, matrix_path.parent, output, environment, args.offline)
    print(f"Compatibility matrix {report['status']}: {output / 'compatibility-matrix.json'}")
    return {"passed": 0, "failed": 1, "incomplete": 2}[report["status"]]


if __name__ == "__main__":
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Compatibility matrix interrupted; owned command sessions were cancelled", file=sys.stderr)
        sys.exit(130)
    except (OSError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        print(f"Compatibility matrix failed: {error}", file=sys.stderr)
        sys.exit(1)
