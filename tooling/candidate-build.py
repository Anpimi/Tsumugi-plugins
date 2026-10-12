#!/usr/bin/env python3
"""Build unreleased plugin candidates from the pinned public SDK, without a host checkout."""
import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import re
import shlex
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return owner


PACKAGER = module("candidate_packager", ROOT / "tooling/package-plugin.py")
JS_PACKAGES = ("plugins/webvtt", "plugins/stardew-smapi", "examples/philosophy")


def json_object(encoded):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate JSON field")
            value[key] = item
        return value
    value = json.loads(encoded, object_pairs_hook=unique)
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value


def capture_file(path, maximum=PACKAGER.MAX_BYTES):
    path = Path(os.path.abspath(path))
    fd = PACKAGER.directory(path.parent)
    try:
        return PACKAGER.snapshot(fd, path.name, maximum)
    finally:
        os.close(fd)


def capture_tree(root):
    """Capture already packaged files through the existing bounded IO owner."""
    fd = PACKAGER.directory(root)
    try:
        files = {}
        size = 0
        for directory, names, filenames in os.walk(root, followlinks=False):
            if any((Path(directory) / name).is_symlink() for name in names):
                raise ValueError("candidate contains a directory link")
            for name in filenames:
                relative = (Path(directory) / name).relative_to(root).as_posix()
                data, executable = PACKAGER.snapshot(fd, relative, PACKAGER.MAX_BYTES)
                files[relative] = (data, executable)
                size += len(data)
                if len(files) > PACKAGER.MAX_FILES or size > PACKAGER.MAX_BYTES:
                    raise ValueError("candidate exceeds the public package limits")
        if "manifest.json" not in files:
            raise ValueError("candidate has no manifest")
        return files
    finally:
        os.close(fd)


def archive_package(package, destination):
    files = capture_tree(package)
    manifest = json_object(files["manifest.json"][0])
    plugin = manifest["plugin"]
    if not isinstance(plugin, dict) or set(plugin) != {"publisher", "id", "version"} or any(not isinstance(v, str) or not v for v in plugin.values()):
        raise ValueError("candidate has no complete plugin identity")
    if "package.json" in files and json_object(files["package.json"][0]).get("version") != plugin["version"]:
        raise ValueError("package and manifest versions disagree")
    # This transport digest is deliberately distinct from the Host packageDigest.
    # Stable tar metadata preserves executable bits without embedding build paths.
    with destination.open("xb") as output:
        with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name, (data, executable) in sorted(files.items()):
                item = tarfile.TarInfo(name)
                item.size, item.mode, item.mtime = len(data), 0o755 if executable else 0o644, 0
                archive.addfile(item, io.BytesIO(data))
    return {"plugin": plugin, "archive": destination.name,
            "archiveSha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "manifestSha256": hashlib.sha256(files["manifest.json"][0]).hexdigest(),
            "fileCount": len(files), "byteCount": sum(len(data) for data, _ in files.values()),
            "packageDigest": None, "inspection": {"status": "not-run", "reason": "no-pinned-host-inspector"}}


def verify_inspection(encoded, package):
    inspection = json_object(encoded)
    if (inspection.get("plugin") != package["plugin"]
            or not isinstance(inspection.get("packageDigest"), str)
            or re.fullmatch("[a-f0-9]{64}", inspection["packageDigest"]) is None
            or inspection.get("manifestSha256") != package["manifestSha256"]
            or type(inspection.get("fileCount")) is not int or inspection["fileCount"] != package["fileCount"]
            or type(inspection.get("byteCount")) is not int or inspection["byteCount"] != package["byteCount"]):
        raise ValueError("Host inspection does not match the actual candidate")
    return inspection


def verify_transport(package, archive_path, expected_sha256):
    encoded, _ = capture_file(archive_path, PACKAGER.MAX_BYTES + 1024 * 1024)
    if hashlib.sha256(encoded).hexdigest() != expected_sha256:
        raise ValueError("candidate archive changed during inspection")
    expected = capture_tree(package)
    actual = {}
    with tarfile.open(fileobj=io.BytesIO(encoded), mode="r:") as archive:
        for member in archive:
            if not member.isfile() or member.name in actual or member.size > PACKAGER.MAX_BYTES:
                raise ValueError("candidate archive contains an invalid file")
            PACKAGER.relative_file(member.name)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError("candidate archive file is unreadable")
            with stream:
                actual[member.name] = (stream.read(member.size + 1), bool(member.mode & 0o111))
    if actual != expected:
        raise ValueError("inspected candidate bytes differ from its transport archive")


def capture_inspector(selection, output):
    """Execute only the approved bytes, independently of the caller's mutable path."""
    binary, expected_digest, declared_commit = selection
    data, executable = capture_file(binary)
    if not executable or hashlib.sha256(data).hexdigest() != expected_digest:
        raise ValueError("Host inspector binary does not match its explicit SHA-256")
    parent = PACKAGER.directory(output)
    try:
        os.mkdir(".inspector", mode=0o700, dir_fd=parent)
        held = os.open(".inspector", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            PACKAGER.write(held, "tsumugi-plugin-package", data, True)
            if PACKAGER.snapshot(held, "tsumugi-plugin-package", PACKAGER.MAX_BYTES) != (data, True):
                raise ValueError("captured Host inspector bytes changed while written")
            fd = os.open("tsumugi-plugin-package", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=held)
            try:
                os.fchmod(fd, 0o500)
            finally:
                os.close(fd)
        finally:
            os.close(held)
    finally:
        os.close(parent)
    # The workflow uploads only candidate archives, inspection records and logs.
    # This private attempt-local executable is never a candidate artifact.
    return output / ".inspector/tsumugi-plugin-package", expected_digest, declared_commit


def tap_escape(value):
    # Match the selected Node 26 TAP reporter's escaping of names, including paths.
    for character, escaped in (("\b", "b"), ("\f", "f"), ("\t", "t"), ("\n", "n"), ("\r", "r"), ("\v", "v")):
        value = value.replace(character, "\\" + escaped)
    return value.replace("\\", "\\\\").replace("#", "\\#")


def test_counts(framework, encoded, args, root):
    """Require complete real runner summaries; never infer success from exit zero."""
    text = encoded.decode("utf-8", errors="replace")
    if framework == "node":
        summary = re.search(
            r"^1\.\.([0-9]+)\n# tests ([0-9]+)\n# suites ([0-9]+)\n# pass ([0-9]+)\n"
            r"# fail ([0-9]+)\n# cancelled ([0-9]+)\n# skipped ([0-9]+)\n# todo ([0-9]+)\n"
            r"# duration_ms [0-9.]+\n?\Z", text, re.MULTILINE)
        if summary is None or len(re.findall(r"^TAP version 13$", text, re.MULTILINE)) != 1:
            raise ValueError("incomplete Node TAP test summary")
        top_level, tested, suites, passed, failed, cancelled, skipped, todo = map(int, summary.groups())
        counts = dict(framework=framework, tested=tested, suites=suites, passed=passed, failed=failed,
                      cancelled=cancelled, skipped=skipped, todo=todo)
        # Node reports an otherwise empty file as a passing file-level test.
        # Such a wrapper is not evidence that a domain test was executed.
        selected = {tap_escape(path) for arg in args[1:] if not str(arg).startswith("-")
                    for path in (str(arg), os.path.abspath(root / arg), os.path.realpath(root / arg))}
        records = re.findall(
            r"^( *)(ok|not ok) ([0-9]+)(?: - ([^\n]*?))?(?: # (SKIP|TODO|EXPECTED FAILURE)(?: [^\n]*)?)?\n"
            r"\1  ---\n(.*?)^\1  \.\.\.$", text[:summary.start()], re.MULTILINE | re.DOTALL)
        actual = dict(tested=0, suites=0, passed=0, unsuccessful=0, skipped=0, todo=0)
        file_results = top_results = 0
        for indent, status, _, name, directive, details in records:
            if len(indent) % 4:
                raise ValueError("invalid Node TAP result indentation")
            kind = re.findall(r"^" + re.escape(indent) + r"  type: '(test|suite)'$", details, re.MULTILINE)
            if len(kind) != 1:
                raise ValueError("incomplete Node TAP result details")
            top_results += not indent
            if kind[0] == "suite":
                actual["suites"] += 1
                continue
            actual["tested"] += 1
            field = "skipped" if directive == "SKIP" else "todo" if directive == "TODO" else "passed" if status == "ok" else "unsuccessful"
            actual[field] += 1
            if not indent and name in selected and field not in {"skipped", "todo"}:
                file_results += 1
        if (top_results != top_level or actual["tested"] != tested or actual["suites"] != suites
                or actual["passed"] != passed or actual["unsuccessful"] != failed + cancelled
                or actual["skipped"] != skipped or actual["todo"] != todo
                or tested != passed + failed + cancelled + skipped + todo):
            raise ValueError("Node TAP results and summary disagree")
        return dict(counts, fileResultsExcluded=file_results, executed=passed + failed + cancelled - file_results)
    if framework == "python":
        runs = re.findall(r"^Ran ([0-9]+) tests? in [^\n]+$", text, re.MULTILINE)
        summary = re.search(r"^(OK|FAILED)(?: \(([^\n]*)\))?\n?\Z", text, re.MULTILINE)
        if len(runs) != 1 or summary is None:
            raise ValueError("incomplete Python unittest summary")
        tested = int(runs[0])
        values = {"failures": 0, "errors": 0, "skipped": 0, "expected failures": 0, "unexpected successes": 0}
        seen = set()
        for item in summary[2].split(", ") if summary[2] else []:
            field, separator, number = item.partition("=")
            if separator != "=" or field not in values or field in seen or re.fullmatch("[0-9]+", number) is None:
                raise ValueError("invalid Python unittest counts")
            values[field] = int(number)
            seen.add(field)
        if values["skipped"] > tested or values["expected failures"] > tested - values["skipped"]:
            raise ValueError("Python unittest counts disagree")
        successful = summary[1] == "OK"
        if successful and (values["failures"] or values["errors"] or values["unexpected successes"]):
            raise ValueError("Python unittest success disagrees with its failures")
        # Failed subtests can outnumber tests; unittest does not report their
        # unique passing-test count, so retain null rather than invent one.
        return dict(framework=framework, tested=tested, passed=tested - values["skipped"] - values["expected failures"] if successful else None,
                    failed=values["failures"], errors=values["errors"], skipped=values["skipped"],
                    expectedFailures=values["expected failures"], unexpectedSuccesses=values["unexpected successes"],
                    successful=successful, executed=tested - values["skipped"])
    if framework == "rust":
        runs = list(map(int, re.findall(r"^running ([0-9]+) tests?$", text, re.MULTILINE)))
        summaries = re.findall(r"^test result: (ok|FAILED)\. ([0-9]+) passed; ([0-9]+) failed; ([0-9]+) ignored; "
                               r"([0-9]+) measured; ([0-9]+) filtered out; finished in [^\n]+$", text, re.MULTILINE)
        if not runs or len(runs) != len(summaries):
            raise ValueError("incomplete Rust test summaries")
        suites = []
        for selected, (status, *numbers) in zip(runs, summaries):
            passed, failed, ignored, measured, filtered = map(int, numbers)
            if selected != passed + failed + ignored + measured or status == "ok" and failed:
                raise ValueError("Rust test counts disagree")
            suites.append(dict(tested=selected, passed=passed, failed=failed, skipped=ignored,
                               measured=measured, filteredOut=filtered, successful=status == "ok", executed=passed + failed))
        totals = {field: sum(suite[field] for suite in suites)
                  for field in ("tested", "passed", "failed", "skipped", "measured", "filteredOut", "executed")}
        return dict(totals, framework=framework, successful=all(suite["successful"] for suite in suites), suites=suites)
    raise ValueError("unsupported test runner")


class CommandRunner:
    def __init__(self, root, output, report):
        self.root, self.output, self.report = root, output, report
        self.environment = dict(os.environ, CARGO_TARGET_DIR=str(output / "cargo-target"))
        cargo_home = os.environ.get("CARGO_HOME", str(Path.home() / ".cargo"))
        prior = os.environ.get("CARGO_ENCODED_RUSTFLAGS")
        flags = prior.split("\x1f") if prior else shlex.split(os.environ.get("RUSTFLAGS", ""))
        flags.extend([f"--remap-path-prefix={root}=/tsumugi-plugins", f"--remap-path-prefix={cargo_home}=/cargo"])
        self.environment.pop("RUSTFLAGS", None)
        self.environment["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(flags)
        self.environment["CARGO_TERM_COLOR"] = "never"

    def run(self, name, args, *, stdout=None, cwd=None, tests=None, timeout=1200):
        if tests and stdout is not None:
            raise ValueError("test commands must retain combined output in their log")
        log = self.output / "logs" / f"{name}.log"
        entry = {"name": name, "command": [str(arg) for arg in args], "log": f"logs/{log.name}", "status": "not-run"}
        self.report["commands"].append(entry)
        print(f"Running {name}", flush=True)
        created = False
        try:
            with log.open("xb") as errors:
                created = True
                if stdout is None:
                    completed = subprocess.run(args, cwd=cwd or self.root, env=self.environment, stdout=errors,
                                               stderr=subprocess.STDOUT, timeout=timeout, check=False)
                else:
                    with stdout.open("xb") as result:
                        completed = subprocess.run(args, cwd=cwd or self.root, env=self.environment, stdout=result,
                                                   stderr=errors, timeout=timeout, check=False)
                entry["exitCode"] = completed.returncode
        except (OSError, subprocess.SubprocessError) as error:
            entry["status"] = "failed"
            entry["failureReason"] = str(error)
            raise
        finally:
            if created:
                encoded = log.read_bytes()
                entry["logSha256"] = hashlib.sha256(encoded).hexdigest()
                if tests:
                    try:
                        entry["testCounts"] = test_counts(tests, encoded, args, cwd or self.root)
                    except ValueError as error:
                        entry["testCounts"] = {"framework": tests, "status": "unavailable"}
                        entry.setdefault("failureReason", str(error))
        counts = entry.get("testCounts", {})
        if tests and counts.get("status") != "unavailable":
            if counts["executed"] <= 0:
                entry["failureReason"] = "no effective tests executed"
            elif counts.get("failed") or counts.get("cancelled") or counts.get("errors") or counts.get("unexpectedSuccesses") or counts.get("successful") is False:
                entry["failureReason"] = "test runner reported unsuccessful tests"
        if completed.returncode or "failureReason" in entry:
            entry["status"] = "failed"
            raise RuntimeError(f"{name} failed; {entry.get('failureReason', 'nonzero exit')}; see {entry['log']}")
        entry["status"] = "passed"


def node_tests(root, relative):
    tests = sorted((root / relative / "tests").glob("*.test.mjs"))
    if not tests:
        raise ValueError(f"no Node tests selected for {relative}")
    return ["node", "--test", "--test-reporter=tap", *[str(path.relative_to(root)) for path in tests]]


def build(root, output, runner, report, offline=False, inspector=None):
    cargo = ["cargo"]
    locked = ["--locked", *(["--offline"] if offline else [])]
    runner.run("prepare-sdk", [sys.executable, "tooling/prepare-sdk.py"])
    runner.run("packaging-tests", [sys.executable, "-m", "unittest", "discover", "-s", "tooling/tests", "-p", "test_*.py"], tests="python")
    runner.run("smapi-dependencies", ["pnpm", "--dir", "plugins/stardew-smapi", "install", "--frozen-lockfile", "--ignore-scripts", *(["--offline"] if offline else [])])
    runner.run("smapi-parser", [sys.executable, "plugins/stardew-smapi/tooling/prepare-parser.py"])
    runner.run("philosophy-metadata", ["node", "examples/philosophy/tooling/prepare.mjs"])
    runner.run("rust-workspace", [*cargo, "test", "--workspace", "--all-features", *locked], tests="rust")
    runner.run("sdk-consumer", [*cargo, "run", *locked, "-p", "tsumugi-sdk-probe", "--", "tooling/sdk-probe/fixtures/manifest.json"])
    for relative in JS_PACKAGES:
        name = Path(relative).name
        runner.run(f"{name}-tests", node_tests(root, relative), tests="node")
        runner.run(f"{name}-package", [sys.executable, "tooling/package-plugin.py", relative, str(output / "packages" / name)])
    runner.run("flat-json-build", [*cargo, "build", *locked, "-p", "tsumugi-flat-json-example", "--bin", "flat-json-worker"])
    worker = output / "cargo-target/debug/flat-json-worker"
    metadata = output / "flat-json-metadata.json"
    runner.run("flat-json-metadata", [str(worker), "--metadata"], stdout=metadata)
    runner.run("flat-json-package", [sys.executable, "tooling/package-flat-json.py", str(metadata), str(worker), str(output / "packages/flat-json")])
    captured_inspector = capture_inspector(inspector, output) if inspector else None
    for name in [*(Path(relative).name for relative in JS_PACKAGES), "flat-json"]:
        package = archive_package(output / "packages" / name, output / f"{name}.tar")
        report["packages"].append(package)
        if captured_inspector:
            binary, expected_digest, declared_commit = captured_inspector
            result = output / f"{name}-inspection.json"
            inspection = {"status": "starting", "reason": "inspection-command-starting", "binarySha256": expected_digest,
                          "declaredHostCommit": declared_commit, "sourceProvenanceNotVerified": True, "record": result.name}
            package["inspection"] = inspection
            failure_reason = "inspection-command-failed"
            try:
                runner.run(f"{name}-inspection", [str(binary), "inspect", str(output / "packages" / name)], stdout=result)
                inspection["reason"] = "validating-inspection-result"
                failure_reason = "inspection-result-rejected"
                value = verify_inspection(result.read_bytes(), package)
                inspection["reason"] = "validating-candidate-transport"
                failure_reason = "candidate-transport-rejected"
                verify_transport(output / "packages" / name, output / package["archive"], package["archiveSha256"])
            except Exception as error:
                inspection.update(status="failed", reason=failure_reason, failureReason=str(error))
                raise
            package["packageDigest"] = value["packageDigest"]
            inspection["status"] = "passed"
            del inspection["reason"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="new directory beneath an existing ordinary parent; never overwritten")
    parser.add_argument("--offline", action="store_true", help="require prepared Cargo and pnpm dependency caches")
    parser.add_argument("--inspector", type=Path, help="explicit public tsumugi-plugin-package binary, not a source checkout")
    parser.add_argument("--inspector-sha256")
    parser.add_argument("--declared-host-commit", help="source declaration only; binary compilation provenance is not independently verified")
    args = parser.parse_args()
    selected = (args.inspector, args.inspector_sha256, args.declared_host_commit)
    if any(value is not None for value in selected):
        if not all(value is not None for value in selected) or re.fullmatch("[a-f0-9]{64}", args.inspector_sha256) is None or re.fullmatch("[a-f0-9]{40}", args.declared_host_commit) is None:
            parser.error("inspection requires an explicit binary, SHA-256 and declared Host commit")
        selected = (Path(os.path.abspath(args.inspector)), args.inspector_sha256, args.declared_host_commit)
    else:
        selected = None
    if os.name != "posix":
        parser.error("the existing descriptor-relative packagers currently support Unix")
    output = Path(os.path.abspath(args.output))
    parent = PACKAGER.directory(output.parent)
    try:
        os.mkdir(output.name, mode=0o700, dir_fd=parent)
    finally:
        os.close(parent)
    for child in ("logs", "packages"):
        (output / child).mkdir(mode=0o700)
    lock_bytes, _ = capture_file(ROOT / "sdk.lock.json", PACKAGER.MAX_MANIFEST_BYTES)
    lock = json_object(lock_bytes)
    git_environment = dict(os.environ, GIT_OPTIONAL_LOCKS="0")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, env=git_environment, timeout=10, text=True).strip()
    dirty = bool(subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=ROOT, env=git_environment, timeout=10))
    report = {"formatVersion": 1, "recordKind": "independent-candidate-build", "status": "failed",
              "sourceCommit": commit, "sourceDirty": dirty, "platform": {"system": platform.system(), "machine": platform.machine()},
              "sdkArtifact": lock, "commands": [], "packages": [],
              "runtimeCompatibility": {"status": "not-run", "reason": "requires-a-separate-fixed-application-host-and-real-worker-adoption-matrix"},
              "publication": {"status": "not-run", "reason": "candidate-build-has-no-release-or-signing-operation"}}
    runner = CommandRunner(ROOT, output, report)
    try:
        for name, command in [("python-version", [sys.executable, "--version"]), ("node-version", ["node", "--version"]),
                              ("pnpm-version", ["pnpm", "--version"]), ("rust-version", ["rustc", "--version"]), ("cargo-version", ["cargo", "--version"])]:
            runner.run(name, command)
        build(ROOT, output, runner, report, args.offline, selected)
        if capture_file(ROOT / "sdk.lock.json", PACKAGER.MAX_MANIFEST_BYTES)[0] != lock_bytes:
            raise ValueError("SDK selection changed during candidate build")
        report["status"] = "passed"
    finally:
        with (output / "candidate-build.json").open("x", encoding="utf-8") as destination:
            json.dump(report, destination, indent=2)
            destination.write("\n")
    print(f"Independent candidates built; report: {output / 'candidate-build.json'}")
    print("Host/Worker/Core runtime compatibility and publication remain NOT-RUN.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Candidate build failed: {error}", file=sys.stderr)
        sys.exit(1)
