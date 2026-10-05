"""The source link check, with the Go toolchain replaced by a script."""

import sys
import unittest

import sourcecheck

SDK = "v0.0.0-20261012090000-a0130000a013"


class FakeGo(object):
    """Fails the named step with the given output; everything else succeeds."""

    def __init__(self, fail_at=None, output=""):
        self.fail_at, self.output, self.commands, self.dirs = fail_at, output, [], []

    def __call__(self, command, cwd):
        self.commands.append(" ".join(command))
        self.dirs.append(cwd)
        failing = dict(sourcecheck.steps(SDK)).get(self.fail_at)
        if failing == command:
            return 1, self.output
        return 0, ""


class SourceCheck(unittest.TestCase):
    def test_runs_get_tidy_build_vet_test_in_order(self):
        go = FakeGo()
        result = sourcecheck.check(SDK, "backend", run=go)
        self.assertEqual(result, {"ok": True, "step": None, "log": ""})
        self.assertEqual(
            go.commands,
            [
                "go get github.com/NVIDIA/OpenShell/sdk/go@" + SDK,
                "go mod tidy",
                "go build ./...",
                "go vet ./...",
                "go test ./...",
            ],
        )
        self.assertEqual(set(go.dirs), {"backend"})

    def test_a_compile_error_stops_the_check_and_keeps_the_compiler_text(self):
        error = "pkg/handlers/x.go:12:3: h.svc.ListProviders undefined\n"
        go = FakeGo(fail_at="build", output=error)
        result = sourcecheck.check(SDK, "backend", run=go)
        self.assertFalse(result["ok"])
        self.assertEqual(result["step"], "build")
        self.assertEqual(result["log"], "$ go build ./...\n" + error)
        # Nothing after the failing step runs: there is no binary to vet or test.
        self.assertEqual(go.commands[-1], "go build ./...")
        self.assertEqual(len(go.commands), 3)

    def test_each_step_is_reported_by_name(self):
        for step in ("get", "tidy", "build", "vet", "test"):
            result = sourcecheck.check(SDK, "backend", run=FakeGo(fail_at=step, output="boom"))
            self.assertEqual((result["ok"], result["step"]), (False, step))

    def test_the_sdk_is_always_an_exact_version(self):
        get = sourcecheck.steps(SDK)[0][1]
        self.assertEqual(get[-1], "github.com/NVIDIA/OpenShell/sdk/go@" + SDK)

    def test_echo_shows_commands_and_output(self):
        lines = []
        sourcecheck.check(SDK, "backend", run=FakeGo(fail_at="vet", output="vet: bad\n"), echo=lines.append)
        self.assertIn("$ go vet ./...", lines)
        self.assertIn("vet: bad", lines)

    def test_output_that_is_not_utf_8_is_kept_not_fatal(self):
        # A failing test may print anything. A decoding error here used to
        # end the check without naming a step, and the report then said the
        # BFF "does not compile".
        script = "import sys; sys.stdout.buffer.write(b'\\xff\\xfe FAIL: TestX'); sys.exit(3)"
        code, output = sourcecheck.run_command([sys.executable, "-c", script], ".")
        self.assertEqual(code, 3)
        self.assertIn("FAIL: TestX", output)
        self.assertIn("\ufffd", output)

    def test_stderr_is_part_of_the_output(self):
        script = "import sys; sys.stderr.write('vet: bad'); sys.exit(1)"
        self.assertEqual(sourcecheck.run_command([sys.executable, "-c", script], "."), (1, "vet: bad"))

    def test_a_missing_toolchain_is_a_failure_not_a_crash(self):
        code, output = sourcecheck.run_command(["definitely-not-a-real-binary-xyz"], ".")
        self.assertEqual(code, 127)
        self.assertIn("definitely-not-a-real-binary-xyz", output)


if __name__ == "__main__":
    unittest.main()
