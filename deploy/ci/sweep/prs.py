"""The sweep's own pull requests: which one is it, and may this run close it?

Each axis has one fixed branch (compat-sweep/gateway, compat-sweep/sdk) and at
most one open pull request from it. Two things about that pull request are
decided here rather than in the workflow's shell:

  * WHICH pull request is the sweep's. `gh pr list --head <branch>` matches
    the branch name in every fork, and the branch names are public in the
    workflow file. Anyone can open a pull request from a fork branch called
    compat-sweep/sdk; the sweep must never rewrite or close that one. Only a
    pull request whose head is in THIS repository is the sweep's own.

  * WHETHER this run may close it. The evidence for an open pull request is
    the sweep that opened it. A later run closes it only when it retested the
    same change and the change no longer holds. The SDK axis tries one release
    per run, the newest, so when upstream has released again and that newer
    SDK fails, the pull request for the older release was not retested: it is
    left open, not closed with a sentence that would be untrue.
"""

import re

import report


def _title_re(template):
    return re.compile("^" + re.escape(template).replace("%s", r"(\S+)") + "$")


GATEWAY_TITLE_RE = _title_re(report.GATEWAY_TITLE)
SDK_TITLE_RE = _title_re(report.SDK_TITLE)


def own_pr(prs, branch):
    """The open pull request from `branch` IN THIS REPOSITORY, or None.

    prs: what `gh pr list --head <branch> --state open --json
    number,title,headRefName,isCrossRepository` printed. A pull request is the
    sweep's own only when GitHub says outright that it is not cross-repository;
    an entry without that field is not shown to be ours and is left alone.
    """
    own = [
        pr
        for pr in prs or []
        if pr.get("isCrossRepository") is False and pr.get("headRefName") == branch and isinstance(pr.get("number"), int)
    ]
    # One head branch can have a pull request per base branch. The oldest is
    # the one the sweep opened and keeps rewriting.
    return min(own, key=lambda pr: pr["number"]) if own else None


def proposed_release(axis, title):
    """The release a sweep pull request proposes, read from its title; None if a person retitled it."""
    m = (GATEWAY_TITLE_RE if axis == "gateway" else SDK_TITLE_RE).match((title or "").strip())
    return m.group(1) if m else None


def close_decision(axis, decision, pr, run_url=""):
    """What a run that does not propose this axis's change does with the open PR.

    Returns {"action": "close" | "leave" | "none", "number", "comment", "why"}.
    `comment` is posted on the pull request when it is closed; `why` goes to
    the job log either way.
    """
    if pr is None:
        return {"action": "none", "number": None, "comment": "", "why": "no open pull request from this repository on the sweep's branch"}
    number = pr["number"]
    run = "The sweep in %s" % run_url if run_url else "The latest sweep"
    again = " Closing; a later sweep opens it again if the result returns."
    if axis == "gateway":
        # Every release above the ceiling is swept on every run, so whatever
        # this pull request proposed was looked at again.
        return {
            "action": "close",
            "number": number,
            "comment": "%s tested every release above the ceiling again and no longer proposes this "
            "change (its summary says why).%s" % (run, again),
            "why": "the gateway axis retests everything above the ceiling, and this run proposes nothing",
        }

    proposed = proposed_release("sdk", pr.get("title"))
    candidate = decision["sdk"].get("candidate")
    if candidate is None:
        return {
            "action": "close",
            "number": number,
            "comment": "%s found nothing left to move: `main` already pins the SDK of the newest "
            "upstream release, or a newer one. Closing." % run,
            "why": "there is no SDK candidate: the pin is not older than the newest release's SDK",
        }
    if proposed is None:
        return {
            "action": "leave",
            "number": number,
            "comment": "",
            "why": "its title no longer names the release it proposes, so this run cannot tell "
            "whether it retested it; a person retitled it, and a person closes it",
        }
    if proposed != candidate:
        return {
            "action": "leave",
            "number": number,
            "comment": "",
            "why": "it proposes the SDK at %s; this run tried the newer %s, which did not pass. "
            "%s was not retested, so nothing new is known about it" % (proposed, candidate, proposed),
        }
    return {
        "action": "close",
        "number": number,
        "comment": "%s retested the SDK at %s and no longer proposes this change (its summary says "
        "which link failed, or what could not be tested).%s" % (run, candidate, again),
        "why": "this run retested the SDK at %s and does not propose it" % candidate,
    }
