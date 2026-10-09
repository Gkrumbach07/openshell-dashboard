"""Everything the workflow writes for a person to read.

The pin commit's message, the `next` pull request, the comment left when
`next` cannot be rebased, the issue check A keeps, and the run summaries.

Two rules about what the text may claim:

  * it says only what this run did or observed. A pull request body is
    written before the push, so it describes the branch, not the run;
  * the pull request body is the same on every run that finds nothing new.
    It carries no run link and no timestamp, so an hourly run that changes
    nothing rewrites nothing.
"""

import textwrap

import nextbranch
import versions
from upstream import UPSTREAM_URL

ADR_PATH = "docs/adrs/0009-console-release-policy.md"
WORKFLOW_PATH = ".github/workflows/follow-upstream.yml"
PINS_PATH = "deploy/ci/gateway-pins.json"

NEXT = "next"
BASE = "main"

# The pull request title is the pin commit's title, and the release notes are
# written from it. `fix`, so it is listed under Bug Fixes in the release that
# follows the merge. The title is not what releases it: publish.yml cuts a
# patch for a merged pull request whose head was `next` in this repository
# (scripts/release/next-merge.mjs).
PR_TITLE = "fix: move to OpenShell %s"

PR_MARKER = "<!-- follow-upstream:next -->"
CONFLICT_MARKER = "<!-- follow-upstream:conflict %s -->"
ISSUE_MARKER = "<!-- follow-upstream:check-a -->"
# The label the retired compat sweep kept its one issue under. Kept, so the
# first run of this workflow rewrites or closes that issue instead of leaving
# it open beside a new one.
ISSUE_LABEL = "compat-migrate"
ISSUE_LABEL_DESCRIPTION = "Follow upstream: main fails the compatibility suite against an upcoming OpenShell release"

PASSED = "passed"
FAILED = "failed"
PULL_FAILED = "pull_failed"
STACK_FAILED = "stack_failed"
BFF_FAILED = "bff_failed"
NO_RESULT = "no_result"

NOT_TESTED_WORDS = {
    PULL_FAILED: "an image could not be pulled, so no gateway was started",
    STACK_FAILED: "the gateway never became healthy",
    BFF_FAILED: "the gateway came up but the BFF did not become healthy in front of it",
    NO_RESULT: "the job did not report a result",
}


def _code(text):
    return "`%s`" % text


def _link(text, repo_url, path):
    """A link that works in an issue or a pull request.

    GitHub rewrites a repository-relative link only inside a rendered file.
    Anywhere else the browser resolves it against the page, which gives a
    404, so those get an absolute URL.
    """
    return "[%s](%s/blob/%s/%s)" % (text, repo_url.rstrip("/"), BASE, path) if repo_url else "%s (`%s`)" % (text, path)


def _kind(version):
    return "stable release" if versions.is_stable(version) else "pre-release"


def _tag_link(tag):
    return "[%s](%s/releases/tag/%s)" % (tag, UPSTREAM_URL, tag)


# --- the pin commit --------------------------------------------------------


def pr_title(release):
    return PR_TITLE % release


def commit_message(target, pinned):
    """The pin commit's message. The trailer is how the commit is found again."""
    version = target["version"]
    paragraphs = [
        "Moves the OpenShell release this branch is built on from %s to %s: the gateway and "
        "supervisor images the compatibility suite runs against, and the Go SDK at the commit "
        "upstream tagged %s (%s)." % (pinned["release"], version, target["tag"], target["commit"][:12])
    ]
    if target["line"] != pinned["line"]:
        paragraphs.append(
            "%s starts gateway release line %s, so the line compiled into the BFF moves from %s "
            "to %s with it." % (version, target["line"], pinned["line"], target["line"])
        )
    if not target["stable"]:
        paragraphs.append(
            "A pre-release, so this is on next and cannot merge. The commit is rewritten in place "
            "when upstream tags another pre-release or releases %s." % target["base"]
        )
    body = "\n\n".join(
        textwrap.fill(paragraph, 72, break_long_words=False, break_on_hyphens=False) for paragraph in paragraphs
    )
    return "%s\n\n%s\n\n%s: %s\n" % (pr_title(version), body, nextbranch.TRAILER, version)


# --- the next pull request -------------------------------------------------


def _ci_note(has_bot_token):
    if has_bot_token:
        return (
            "**CI** runs on every push to `next`. Its `compat` job is the compatibility suite "
            "against the release pinned here, on the SDK pinned here."
        )
    return (
        "**CI does not start by itself on this pull request.** `next` is pushed with the "
        "workflow's default token, and GitHub starts no workflow for what that token pushes. "
        "To run CI on the commit that is here now, close this pull request and reopen it. With "
        "the repository secret `UPSTREAM_BOT_TOKEN` set, it starts by itself."
    )


def pr_body(plan, outcome, has_bot_token=False, automerge=False, repo_url="", release_branch=None):
    """The description of the `next` pull request, from what is on the branch."""
    doc = outcome["pins"]
    release = doc["release"]
    stable = versions.is_stable(release)
    pinned = plan["pinned"]
    target = plan.get("target") or {}
    people = outcome.get("people") or []
    new_line = versions.line(release) != pinned["line"]

    lines = [
        PR_MARKER,
        "This is `next`: the move to the upcoming OpenShell release, opened early (%s, decisions 7 "
        "and 8). The %s workflow keeps the branch and rewrites this description, so an edit made "
        "here by hand is lost."
        % (_link("ADR 0009", repo_url, ADR_PATH), _link("Follow upstream", repo_url, WORKFLOW_PATH)),
        "",
    ]
    if stable:
        lines += [
            "**Where it is.** `next` pins OpenShell %s, a stable release. `main` pins %s. This is "
            "ready to merge once its checks pass." % (_code(release), _code(pinned["release"])),
        ]
    else:
        lines += [
            "**Where it is.** `next` pins OpenShell %s, a pre-release. `main` pins %s. Until "
            "upstream releases %s this stays a draft and its `pins a stable release` check fails, "
            "which is what keeps it from merging; that check says nothing about compatibility. When "
            "the release is out, the workflow moves the pin to it and marks this ready for review."
            % (_code(release), _code(pinned["release"]), _code(versions.base(release))),
        ]
    if target.get("skipped") and release == target.get("version"):
        lines += [
            "",
            "Upstream also released %s since %s. The branch goes straight to the newest release; "
            "the ones in between are not walked through."
            % (", ".join(_code(version) for version in target["skipped"]), _code(pinned["release"])),
        ]

    lines += [
        "",
        "**What moved.** One commit, always the first after `main`. It changes %s, `backend/go.mod` "
        "and `backend/go.sum`, %sand the generated block of `README.md`."
        % (
            _code(PINS_PATH),
            "the gateway release line compiled into the BFF, " if new_line else "",
        ),
        "",
        "| | Pinned on `next` |",
        "|---|---|",
        "| release | %s |" % _code(release),
        "| gateway | %s |" % _code(doc["gateway_image"]),
        "| supervisor | %s |" % _code(doc["supervisor_image"]),
        "| Go SDK | %s |" % _code(doc["sdk"]),
    ]

    if new_line:
        lines += [
            "",
            "**This starts gateway release line %s.** `main` is on %s, and the line compiled into "
            "the BFF moves with the pin."
            % (_code(versions.line(release) + ".x"), _code(pinned["line"] + ".x")),
        ]
        if release_branch:
            name, sha, created = release_branch
            lines += [
                "%s %s from `main` at %s, so the %s line can still get critical and security fixes "
                "after this merges. A commit that reaches `main` after that and before this merges "
                "is not on it; cherry-pick it there if the old line needs it."
                % (
                    _code(name),
                    "was created by the run that wrote this," if created else "exists; it was created",
                    _code(sha[:12]),
                    _code(pinned["line"] + ".x"),
                ),
            ]

    lines += [
        "",
        "**Work that needs the upcoming release goes here.** Open a pull request into `next` only "
        "for a change that cannot build or pass on `main`; everything else goes to `main`. When "
        "`main` moves, the workflow rebases `next` onto it and force-pushes, so rebase a branch "
        "cut from `next` after that. Commits on `next` besides the pin move: %d." % len(people),
        "",
        _ci_note(has_bot_token),
        "",
    ]
    if automerge:
        lines += [
            "**Merging.** `UPSTREAM_AUTOMERGE` is on: once this is ready for review, the workflow asks "
            "GitHub to merge it by rebase when the checks `main` requires have passed. If `main` "
            "requires none, GitHub refuses that, and this is merged by hand with *Rebase and merge*.",
        ]
    else:
        lines += [
            "**Merging.** Nothing merges this automatically. Use *Rebase and merge*, so the pin move "
            "and each commit on `next` land on `main` as they are.",
        ]
    lines += [
        "After the merge, a patch release is cut by itself once CI has passed on `main`.",
    ]
    if new_line:
        lines += [
            "",
            "**That release is numbered as a patch.** The first console release for a new gateway "
            "release line should be a minor (ADR 0009, decision 2), and working the version out from "
            "the move is not built yet. If that matters for this release, settle it before merging: "
            "the patch is cut without anyone being asked.",
        ]
    return "\n".join(lines) + "\n"


def conflict_key(outcome):
    """What makes two conflicts the same one, so the comment is left once.

    The commit `next` is on and the files in conflict. `main` moving again
    while both stay the same is the same conflict, and says nothing new.
    """
    conflict = outcome["conflict"]
    return "%s %s %s" % (outcome["next"], conflict["stage"], ",".join(sorted(conflict["files"])))


def conflict_comment(plan, outcome):
    conflict = outcome["conflict"]
    target = plan.get("target") or {}
    commit = conflict.get("commit")
    if conflict["stage"] == "rebase":
        headline = "**`next` could not be rebased onto `main`.**"
        doing = "Replaying"
        remedy = "rebase `next` onto `main` by hand, resolve the conflict and force-push"
    else:
        headline = "**The pin on `next` could not be moved to OpenShell %s.**" % _code(target.get("version", "?"))
        doing = "Folding the move into the pin commit and replaying"
        remedy = (
            "take the change to these files out of that commit, or drop the commit, and force-push: "
            "the pin move writes them, and a commit on top that edits the same lines cannot follow it"
        )
    lines = [
        CONFLICT_MARKER % conflict_key(outcome),
        "%s %s %s conflicts in:"
        % (
            headline,
            doing,
            "%s (%s)" % (_code(commit["sha"][:12]), commit["subject"]) if commit else "the commits on it",
        ),
        "",
    ]
    lines += ["- %s" % _code(path) for path in sorted(conflict["files"])]
    lines += [
        "",
        "`next` was left exactly as it was. The workflow regenerates `backend/go.sum` and "
        "`frontend/package-lock.json` by itself and stops for anything else. To carry on, %s; the "
        "next run takes it from there. This comment is not repeated while `next` and the files in "
        "conflict stay the same." % remedy,
    ]
    return "\n".join(lines) + "\n"


# --- check A ---------------------------------------------------------------


def check_outcome(pull, stack, bff, compat):
    """One result from the four steps of check A, each `success`, `failure` or `skipped`.

    The first step that did not succeed names what happened. Only a failing
    compatibility suite is a compatibility result: an image that cannot be
    pulled, a gateway that never starts and a BFF that never becomes healthy
    sent the gateway nothing, so they say nothing about it.
    """
    for step, outcome in ((pull, PULL_FAILED), (stack, STACK_FAILED), (bff, BFF_FAILED)):
        if step != "success":
            return outcome
    if compat == "success":
        return PASSED
    if compat == "failure":
        return FAILED
    return NO_RESULT


def check_decision(plan, result):
    """What the run concludes from check A.

    Returns {"issue": upsert | close | keep, "incomplete": bool, "why": str}.
    Unknown is never read as a pass or a failure: it leaves the issue as it
    is and turns the run red.
    """
    target = plan.get("target")
    if target is None:
        return {
            "issue": "close",
            "incomplete": False,
            "why": "upstream has no release ahead of `main`, so there is nothing for check A to test",
        }
    if not target["ready"]:
        return {"issue": "keep", "incomplete": False, "why": target["waiting_for"]}
    outcome = (result or {}).get("outcome", NO_RESULT)
    if outcome == PASSED:
        return {
            "issue": "close",
            "incomplete": False,
            "why": "`main` passes the compatibility suite against OpenShell `%s`" % target["version"],
        }
    if outcome == FAILED:
        return {
            "issue": "upsert",
            "incomplete": False,
            "why": "`main` FAILS the compatibility suite against OpenShell `%s`" % target["version"],
        }
    return {
        "issue": "keep",
        "incomplete": True,
        "why": "check A could not be run against OpenShell `%s`: %s"
        % (target["version"], NOT_TESTED_WORDS.get(outcome, NOT_TESTED_WORDS[NO_RESULT])),
    }


def issue_text(plan, run_url="", repo_url=""):
    """Title and body of the one issue check A keeps, for a failing run."""
    target, pinned = plan["target"], plan["pinned"]
    version = target["version"]
    title = "OpenShell %s: main fails the compatibility suite" % version
    run = "[this run](%s)" % run_url if run_url else "the run that wrote this"
    lines = [
        ISSUE_MARKER,
        "Kept by %s (%s, decision 8). Rewritten in place on every run and closed when check A passes "
        "again. Do not edit it by hand: the next run overwrites it."
        % (_link("the Follow upstream workflow", repo_url, WORKFLOW_PATH), _link("ADR 0009", repo_url, ADR_PATH)),
        "",
        "**Check A failed.** The BFF built from `main` (OpenShell %s, SDK %s) does not pass "
        "`backend/test/compat` against the OpenShell %s %s. The failing tests are in %s."
        % (_code(pinned["release"]), _code(pinned["sdk"]), _code(version), _kind(version), run),
        "",
        "| | Tested |",
        "|---|---|",
        "| upstream tag | %s |" % _tag_link(target["tag"]),
        "| gateway | %s |" % _code(target["gateway_image"]),
        "| supervisor | %s |" % _code(target["supervisor_image"]),
        "",
    ]
    if target["same_line"] and target["stable"]:
        lines += [
            "### What this means",
            "",
            "%s is a stable release on %s, the release line `main` is already for. A console that is "
            "installed today and has not been touched fails against it. **Upstream broke a Stable "
            "interface inside a minor release line**, which OpenShell's release policy (RFC 0014) says "
            "it does not do, and which the console's claim to work with every gateway of its line "
            "rests on (ADR 0009, decision 10)."
            % (_code(version), _code(target["line"] + ".x")),
            "",
            "### What to do",
            "",
            "1. **Report it upstream**, at %s/issues, with the failing test and the request it sends. "
            "The remedy belongs there: a fix in the next patch release." % UPSTREAM_URL,
            "2. Until then the console stays on %s, the last release that passed. Check B, CI on the "
            "`next` pull request, shows whether the console built on the new SDK passes."
            % _code(pinned["release"]),
        ]
    elif target["same_line"]:
        lines += [
            "### What this means",
            "",
            "%s is a pre-release of %s, on the release line `main` is already for. If it is released "
            "as it is, a console that is installed today fails against it, and upstream will have "
            "broken a Stable interface inside a minor release line. It is a pre-release, so there is "
            "still time for that not to happen."
            % (_code(version), _code(target["base"])),
            "",
            "### What to do",
            "",
            "1. Read the failing tests. If a Stable interface changed (proto, SDK, CLI, config, "
            "policy), **report it upstream now**, at %s/issues, before %s is released."
            % (UPSTREAM_URL, _code(target["base"])),
            "2. If the change is one the console has to follow, make it on `next`, where check B (CI "
            "on the `next` pull request) runs the suite on the pre-release's SDK.",
        ]
    else:
        lines += [
            "### What this means",
            "",
            "%s is on release line %s; `main` is for %s. A new minor release line is where upstream "
            "may change a Stable interface, so the console built for the old line is not expected to "
            "pass, and it tells the user so: the compatibility notice reports the new line as "
            "unsupported. This issue says what the move to the new line has to deal with."
            % (_code(version), _code(target["line"] + ".x"), _code(pinned["line"] + ".x")),
            "",
            "### What to do",
            "",
            "Do the work on `next`. Check B, CI on the `next` pull request, runs the suite with the "
            "console built on the new line's SDK, and the console's minor release is held until it "
            "passes (ADR 0009, decision 2).",
        ]
    return title, "\n".join(lines) + "\n"


# --- run summaries ---------------------------------------------------------


def plan_summary(plan, dry_run=False):
    pinned, target = plan["pinned"], plan.get("target")
    lines = ["## Follow upstream%s" % (" (dry run: nothing is pushed, opened or edited)" if dry_run else ""), ""]
    lines.append("- This branch pins OpenShell %s (SDK %s)." % (_code(pinned["release"]), _code(pinned["sdk"])))
    if pinned["sdk_on_tag"] is False:
        lines.append(
            "- **The SDK pin is not the commit upstream tagged `v%s`.** The gateway and the SDK are "
            "meant to come from one release; someone moved one without the other." % pinned["release"]
        )
    if target is None:
        lines.append(
            "- Upstream has no release ahead of it (newest stable release: %s). Nothing to do."
            % _code(plan.get("newest_stable") or "none")
        )
        return "\n".join(lines) + "\n"
    lines.append(
        "- Target: OpenShell %s, a %s (%s, commit %s)%s."
        % (
            _code(target["version"]),
            _kind(target["version"]),
            _tag_link(target["tag"]),
            _code(target["commit"][:12]),
            ", which starts release line %s" % _code(target["line"] + ".x") if not target["same_line"] else "",
        )
    )
    if target["skipped"]:
        lines.append("- Skipped on the way: %s." % ", ".join(_code(version) for version in target["skipped"]))
    if not target["ready"]:
        lines.append("- **Not yet:** %s. The next run looks again." % target["waiting_for"])
    else:
        lines.append("- gateway %s" % _code(target["gateway_image"]))
        lines.append("- supervisor %s" % _code(target["supervisor_image"]))
    return "\n".join(lines) + "\n"


def next_summary(outcome, publish, dry_run=False):
    """What the `next` job did, or in a dry run would do."""
    would = "would be " if dry_run else ""
    action = outcome["action"]
    lines = ["### `next`", ""]
    if action == "create":
        lines.append("- `next` %screated from `main` at %s." % (would, _code(outcome["main"][:12])))
    elif action == "update":
        lines.append("- `next` %sforce-pushed (with lease): %s." % (would, outcome["reason"]))
    elif action == "none":
        lines.append("- `next` is left as it is: %s." % outcome["reason"])
    elif action == "conflict":
        conflict = outcome["conflict"]
        lines.append(
            "- **%s.** In conflict: %s. `next` is left exactly as it was."
            % (outcome["reason"].capitalize(), ", ".join(_code(path) for path in sorted(conflict["files"])))
        )
    elif action == "delete":
        lines.append("- `next` %sdeleted: %s." % (would, outcome["reason"]))
    elif action == "leave":
        lines.append("- `next` is left as it is: %s." % outcome["reason"])
    if outcome.get("sha"):
        lines.append("- Commit: %s." % _code(outcome["sha"]))
    if outcome.get("regenerated"):
        lines.append(
            "- Regenerated after a conflict: %s." % ", ".join(_code(path) for path in sorted(set(outcome["regenerated"])))
        )
    if publish.get("release_branch"):
        lines.append(
            "- %s %screated from `main` at %s."
            % (_code(publish["release_branch"]["name"]), would, _code(publish["release_branch"]["sha"][:12]))
        )
    pull = publish.get("pr")
    if pull:
        if pull["number"] is None:
            lines.append(
                "- A %spull request `next` -> `main` %sopened: %s."
                % ("draft " if pull["draft"] else "", would, _code(pull["title"]))
            )
        else:
            changes = [name for name in ("title", "body") if pull.get("set_" + name)]
            if pull.get("set_draft"):
                changes.append("marked %s" % ("a draft" if pull["set_draft"] == "draft" else "ready for review"))
            if changes:
                lines.append("- Pull request #%d %supdated: %s." % (pull["number"], would, ", ".join(changes)))
            else:
                lines.append("- Pull request #%d is already right; nothing to change." % pull["number"])
    if publish.get("comment"):
        lines.append("- A comment naming the files in conflict %sleft on the pull request." % would)
    elif action == "conflict":
        lines.append("- The pull request already carries a comment about this conflict; it is not repeated.")
    if publish.get("automerge"):
        lines.append("- Auto-merge (rebase) %sturned on for the pull request." % would)
    return "\n".join(lines) + "\n"


def check_summary(plan, decision, dry_run=False):
    why = decision["why"][:1].upper() + decision["why"][1:]
    lines = ["### Check A: `main` against the upcoming release", "", "- %s." % why]
    said = {
        "upsert": "The issue is %s." % ("not written in a dry run" if dry_run else "written, or rewritten in place"),
        "close": "An open issue is %s." % ("not closed in a dry run" if dry_run else "closed"),
        "keep": "The issue, if there is one, is left as it is.",
    }[decision["issue"]]
    lines.append("- %s" % said)
    return "\n".join(lines) + "\n"
