"""The source link: does the BFF build against a given SDK?

This is the SDK<->BFF half of the chain and it never involves a gateway. The
steps are the ones a person would run after `go get`:

    go get <sdk>@<version>     can the module graph take it at all?
    go mod tidy
    go build ./...             does it compile?
    go vet ./...
    go test ./...              do the unit tests still pass?

The first step that fails ends the check, and its name and output are kept so
the report can show the compiler's own words. That is the difference between
"the BFF does not compile against this SDK" and "a gateway is incompatible":
a compile error must never be reported as the second.

The SDK axis legs and the SDK bump job both go through here, so the tree a PR
commits is produced by exactly the commands the sweep tested.
"""

import subprocess

from upstream import SDK_MODULE


def steps(sdk_version):
    """(name, command) pairs, in the order they run."""
    return [
        ("get", ["go", "get", "%s@%s" % (SDK_MODULE, sdk_version)]),
        ("tidy", ["go", "mod", "tidy"]),
        ("build", ["go", "build", "./..."]),
        ("vet", ["go", "vet", "./..."]),
        ("test", ["go", "test", "./..."]),
    ]


def run_command(command, cwd):
    """Run one command; (exit code, combined output). Tests replace this."""
    try:
        done = subprocess.run(
            command, cwd=cwd, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
        )
    except OSError as err:
        return 127, "%s: %s" % (command[0], err)
    return done.returncode, done.stdout


def check(sdk_version, backend_dir, run=run_command, echo=None):
    """Move the SDK and prove the source link.

    Returns {"ok": bool, "step": the failing step or None, "log": its output}.
    On success the log is empty: there is nothing to report.
    """
    for name, command in steps(sdk_version):
        if echo:
            echo("$ " + " ".join(command))
        code, output = run(command, backend_dir)
        if echo and output:
            echo(output.rstrip())
        if code != 0:
            return {"ok": False, "step": name, "log": "$ %s\n%s" % (" ".join(command), output or "")}
    return {"ok": True, "step": None, "log": ""}
