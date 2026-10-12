"""Putting what was prepared on GitHub: the branch, its pull request, a comment.

Split in two on purpose.

build() decides. It reads what the `next` job prepared and what GitHub says
about the pull requests from `next`, and writes down every step to take. It
runs without a token.

execute() acts. It is handed the token, so it does as little as possible: it
runs `git push` and `gh` with exactly the arguments build() chose, in a fixed
order, and stops at the first one that fails. It runs nothing else, and a
test holds it to that.

Only a pull request whose head is `next` IN THIS REPOSITORY is ever created,
rewritten, commented on or closed. `gh pr list --head next` also matches a
fork's branch of the same name, and anyone can open one.
"""

import os
import re
import shutil
import subprocess
import tempfile

import report
import versions

NEXT = report.NEXT
BASE = report.BASE
REMOTE = "origin"

# Hands git the token for one command, from the environment: it is never
# written to the git config and never appears on a command line.
CREDENTIAL_HELPER = '!f() { echo "username=x-access-token"; echo "password=${GH_TOKEN}"; }; f'


class PublishError(Exception):
    """A step failed in a way a person has to look at."""


def own_pull(pulls, branch=NEXT, base=BASE):
    """The pull request from `branch` IN THIS REPOSITORY into `base`, or None.

    pulls: what `gh pr list --head <branch> --json
    number,title,body,isDraft,headRefName,headRefOid,baseRefName,isCrossRepository,comments`
    printed. A pull request is ours only when GitHub says outright that it is
    not cross-repository; an entry without that field is not shown to be
    ours and is left alone.
    """
    own = [
        pull
        for pull in pulls or []
        if pull.get("isCrossRepository") is False
        and pull.get("headRefName") == branch
        and pull.get("baseRefName") == base
        and isinstance(pull.get("number"), int)
    ]
    # The oldest is the one the workflow opened and keeps rewriting.
    return min(own, key=lambda pull: pull["number"]) if own else None


def is_spent(merged_pulls, sha):
    """Was a pull request from `next`, at exactly this commit, merged?

    Then everything on the branch is in `main`, whichever merge method put it
    there and whatever that did to the commit ids.
    """
    return bool(sha) and any(
        pull.get("isCrossRepository") is False
        and pull.get("headRefName") == NEXT
        and pull.get("baseRefName") == BASE
        and pull.get("headRefOid") == sha
        for pull in merged_pulls or []
    )


def _same_text(left, right):
    normal = lambda text: (text or "").replace("\r\n", "\n").strip()
    return normal(left) == normal(right)


def build(plan, outcome, open_pulls=None, has_bot_token=False, automerge=False, repo_url="", release_branch_sha=None):
    """Every step to take on GitHub for what the `next` job prepared, as plain data.

    release_branch_sha: where `release/<old line>` is on the remote, or None
    when it does not exist. Only looked at when the plan names such a branch.
    """
    target = plan.get("target")
    action = outcome["action"]
    own = own_pull(open_pulls)
    publish = {
        "action": action,
        "release_branch": None,
        "push": None,
        "pr": None,
        "comment": None,
        "automerge": False,
        "delete": None,
    }

    if action == "delete":
        publish["delete"] = {
            "expected": outcome["next"],
            "pr": own["number"] if own else None,
            "comment": "Closing: %s. The Follow upstream workflow opens `next` again when upstream "
            "tags a release ahead of `main`." % outcome["reason"],
        }
        return publish
    if action == "leave" or target is None or not target["ready"]:
        return publish

    # The branch for the line main is about to leave. It has to exist before
    # the pull request can merge, and the pull request cannot merge before the
    # target is a stable release, which is when the plan first names it.
    branch_note = None
    if target.get("release_branch"):
        name = target["release_branch"]
        if release_branch_sha is None:
            publish["release_branch"] = {"name": name, "sha": outcome["main"]}
            branch_note = (name, outcome["main"], True)
        else:
            branch_note = (name, release_branch_sha, False)

    if action in ("create", "update"):
        publish["push"] = {"sha": outcome["sha"], "expected": outcome["next"] or "", "created": action == "create"}

    doc = outcome.get("pins")
    if not doc or versions.parse(doc.get("release")) is None:
        raise PublishError(
            "`next` holds no %s this workflow can read, so its pull request cannot be described. "
            "Someone changed the branch by hand; it needs a person." % report.PINS_PATH
        )
    release = doc["release"]
    draft = not versions.is_stable(release)
    title = report.pr_title(release)
    body = report.pr_body(plan, outcome, has_bot_token, automerge, repo_url, branch_note)
    if own is None:
        publish["pr"] = {"number": None, "title": title, "body": body, "draft": draft}
    else:
        change = None
        if bool(own.get("isDraft")) != draft:
            change = "draft" if draft else "ready"
        publish["pr"] = {
            "number": own["number"],
            "title": title,
            "body": body,
            "draft": draft,
            "set_title": own.get("title") != title,
            "set_body": not _same_text(own.get("body"), body),
            "set_draft": change,
        }

    if action == "conflict":
        marker = report.CONFLICT_MARKER % report.conflict_key(outcome)
        already = own is not None and any(marker in (comment.get("body") or "") for comment in own.get("comments") or [])
        if not already:
            publish["comment"] = {"body": report.conflict_comment(plan, outcome)}

    # Never for a pre-release, and never for a branch that is not on the
    # release the plan is moving to. Not again once GitHub has it on.
    already_on = own is not None and bool(own.get("autoMergeRequest"))
    publish["automerge"] = bool(
        automerge
        and not draft
        and action != "conflict"
        and release == target["version"]
        and target["stable"]
        and not already_on
    )
    return publish


def run_command(command, env=None):
    """Run one command; (exit code, stdout, stderr). Tests replace this."""
    try:
        done = subprocess.run(command, env=env, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as err:
        return 127, "", "%s: %s" % (command[0], err)
    return done.returncode, done.stdout, done.stderr


def _push_command(*args):
    return ["git", "-c", "credential.helper=", "-c", "credential.helper=" + CREDENTIAL_HELPER, "push"] + list(args)


def _is_allowed(command):
    """git push, or gh. Nothing else is run beside the token."""
    if command[:1] == ["gh"]:
        return True
    if command[:1] != ["git"]:
        return False
    rest = command[1:]
    while rest[:1] == ["-c"]:
        rest = rest[2:]
    return rest[:1] == ["push"]


class _Runner(object):
    """Runs a command if it is allowed, and logs it without the credential helper."""

    def __init__(self, run, echo, dry_run):
        self.run, self.echo, self.dry_run = run, echo, dry_run
        self.directory = tempfile.mkdtemp(prefix="upstream-publish-")
        self.files = 0

    def file(self, text):
        self.files += 1
        path = os.path.join(self.directory, "text-%d.md" % self.files)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return path

    def __call__(self, command):
        if not _is_allowed(command):
            raise PublishError("refusing to run %r beside the token: only `git push` and `gh` are run here" % (command,))
        words = [word for word in command if not word.startswith("credential.helper=") and word != "-c"]
        self.echo("%s %s" % ("would run:" if self.dry_run else "$", " ".join(words)))
        if self.dry_run:
            return 0, "", ""
        code, out, err = self.run(command)
        for text in (out, err):
            if text.strip():
                self.echo(text.rstrip())
        return code, out, err


def _lease(branch, expected):
    return "--force-with-lease=refs/heads/%s:%s" % (branch, expected)


# Asks GitHub to merge the pull request by rebase once what the base branch
# requires of it is met. It is the mutation, deliberately, and never
# `gh pr merge --auto`: gh merges on the spot when the pull request is already
# mergeable, and into a branch that requires nothing a pull request is
# mergeable whatever its checks say. The mutation only ever turns auto-merge
# on, and GitHub refuses it where there is nothing to wait for.
AUTOMERGE = (
    "mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: REBASE}) "
    "{ clientMutationId } }"
)


def _enable_automerge(call, number):
    """Turn auto-merge on. Returns why it could not be, or None when it is on."""
    code, out, err = call(["gh", "pr", "view", str(number or "<new>"), "--json", "id", "--jq", ".id"])
    if code != 0:
        return " ".join(err.split()) or "the pull request could not be read"
    code, _, err = call(["gh", "api", "graphql", "-f", "query=" + AUTOMERGE, "-f", "id=" + out.strip()])
    if code != 0:
        return " ".join(err.split()) or "gh gave no reason"
    return None


def execute(publish, run=None, echo=print, dry_run=False):
    """Carry out what build() decided. Returns notes for the run summary.

    Raises PublishError when a step fails and a person has to look. A lease
    that no longer holds is not that: someone pushed to `next` while this run
    worked, and the next run starts from what they pushed.
    """
    call = _Runner(run or run_command, echo, dry_run)
    try:
        return _steps(publish, call, dry_run)
    finally:
        # The pull request body and the comment were written to files for gh.
        shutil.rmtree(call.directory, ignore_errors=True)


def _steps(publish, call, dry_run):
    notes = []

    branch = publish.get("release_branch")
    if branch:
        # An empty lease: the branch must not exist. It is never moved.
        code, _, err = call(_push_command(_lease(branch["name"], ""), REMOTE, "%s:refs/heads/%s" % (branch["sha"], branch["name"])))
        if code != 0:
            raise PublishError("could not create %s:\n%s" % (branch["name"], err.strip()))

    push = publish.get("push")
    if push:
        code, _, err = call(_push_command(_lease(NEXT, push["expected"]), REMOTE, "%s:refs/heads/%s" % (push["sha"], NEXT)))
        if code != 0:
            if "stale info" in err:
                notes.append(
                    "`next` moved while this run was working, so nothing was pushed and its pull "
                    "request was not touched. The next run starts from what is there now."
                )
                return notes
            hint = ""
            if "workflow" in err and "permission" in err:
                hint = (
                    "\nGitHub refuses a push that changes a workflow file unless the token may write "
                    "workflows, and the workflow's default token never may. `main` gained a workflow "
                    "change that this rebase carries. Set the secret UPSTREAM_BOT_TOKEN to a token "
                    "with Contents, Pull requests and Workflows read/write, or rebase `next` onto "
                    "`main` by hand once."
                )
            raise PublishError("could not push %s:\n%s%s" % (NEXT, err.strip(), hint))

    pull = publish.get("pr")
    number = pull["number"] if pull else None
    if pull and number is None:
        command = ["gh", "pr", "create", "--head", NEXT, "--base", BASE, "--title", pull["title"], "--body-file", call.file(pull["body"])]
        if pull["draft"]:
            command.append("--draft")
        code, out, err = call(command)
        if code != 0:
            if push and push["created"]:
                # No pull request, so the branch just pushed would be an orphan
                # that looks like a pending change. Take it away again.
                gone, _, _ = call(_push_command(_lease(NEXT, push["sha"]), REMOTE, ":refs/heads/%s" % NEXT))
                left = "The branch was deleted again, so nothing is left behind." if gone == 0 else "The branch could NOT be deleted again; delete `next` by hand."
            else:
                left = "`next` itself is as this run pushed it."
            raise PublishError(
                "GitHub refused to create the pull request %s -> %s:\n%s\n"
                "With the workflow's default token that is what happens while the repository setting "
                "'Allow GitHub Actions to create and approve pull requests' is off. Do ONE of these, then "
                "run the workflow again: (1) enable that setting under Settings > Actions > General > "
                "Workflow permissions; or (2) add the repository secret UPSTREAM_BOT_TOKEN, a fine-grained "
                "or GitHub App token with Contents, Pull requests and Workflows read/write on this "
                "repository. %s" % (NEXT, BASE, err.strip(), left)
            )
        found = re.search(r"/pull/(\d+)\s*$", out.strip())
        number = int(found.group(1)) if found else None
        if not dry_run:
            notes.append("Opened %s." % (out.strip() or "the pull request"))
    elif pull:
        if pull.get("set_title") or pull.get("set_body"):
            command = ["gh", "api", "--method", "PATCH", "repos/{owner}/{repo}/pulls/%d" % number, "--silent"]
            if pull.get("set_title"):
                command += ["-f", "title=%s" % pull["title"]]
            if pull.get("set_body"):
                command += ["-F", "body=@%s" % call.file(pull["body"])]
            code, _, err = call(command)
            if code != 0:
                raise PublishError("could not update pull request #%d:\n%s" % (number, err.strip()))
        if pull.get("set_draft"):
            command = ["gh", "pr", "ready", str(number)] + (["--undo"] if pull["set_draft"] == "draft" else [])
            code, _, err = call(command)
            if code != 0:
                raise PublishError("could not mark pull request #%d %s:\n%s" % (number, pull["set_draft"], err.strip()))

    comment = publish.get("comment")
    if comment and (number is not None or dry_run):
        code, _, err = call(["gh", "pr", "comment", str(number or "<new>"), "--body-file", call.file(comment["body"])])
        if code != 0:
            raise PublishError("could not comment on pull request #%s:\n%s" % (number, err.strip()))

    if publish.get("automerge") and (number is not None or dry_run):
        refused = _enable_automerge(call, number)
        if refused:
            # Not a reason to fail the run: the pull request is there and can
            # be merged by hand. Say why it will not merge by itself.
            notes.append(
                "**Auto-merge could not be turned on** for pull request #%s: %s. It needs the repository "
                "setting 'Allow auto-merge' and at least one required check on `main`; without a required "
                "check there is nothing for auto-merge to wait for, and GitHub refuses it." % (number, refused)
            )

    delete = publish.get("delete")
    if delete:
        if delete.get("pr") is not None:
            code, _, err = call(["gh", "pr", "close", str(delete["pr"]), "--comment", delete["comment"]])
            if code != 0:
                raise PublishError("could not close pull request #%d:\n%s" % (delete["pr"], err.strip()))
        code, _, err = call(_push_command(_lease(NEXT, delete["expected"]), REMOTE, ":refs/heads/%s" % NEXT))
        if code != 0:
            if "stale info" in err:
                notes.append("`next` moved while this run was working, so it was not deleted.")
                return notes
            raise PublishError("could not delete %s:\n%s" % (NEXT, err.strip()))
    return notes
