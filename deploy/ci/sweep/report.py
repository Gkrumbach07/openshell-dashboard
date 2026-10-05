"""Report rendering: the issue, the step summary and the PR text.

Every row says in words WHICH LINK failed and what to do about it, because the
two links are repaired in different places:

  wire: gateway<->SDK    a real gateway and the BFF built against an SDK
                         disagree at run time. Found only by the compat suite.
                         Fixed by choosing which gateways and which SDK go
                         together, or by adapting the BFF to the gateway.
  source: SDK<->BFF      the BFF does not compile, vet or pass its unit tests
                         against an SDK. No gateway is involved. Fixed by
                         editing BFF code.

A sweep that reported the second as the first is what produced "3 releases
need migration" (#75) for three gateways that worked.

Two rules about what the text may claim:

  * a row says only what the run observed. "Passes", "fails" and "works with
    none" are never said about a lane the run has no result for;
  * the report is written before the PR job runs, so it never says a pull
    request exists. It says which job opens it and what to do if that job
    did not succeed.
"""

import textwrap

import outcomes
import pins

ISSUE_MARKER = "<!-- compat-sweep -->"
ISSUE_LABEL = "compat-migrate"
ADR_PATH = "docs/adrs/0006-compat-links-and-sweep-axes.md"
PINS_PATH = "deploy/ci/gateway-pins.json"
README_PATH = "README.md"

WIRE_LINK = "wire: gateway<->SDK"
SOURCE_LINK = "source: SDK<->BFF"

GATEWAY_BRANCH = "compat-sweep/gateway"
SDK_BRANCH = "compat-sweep/sdk"

# PR titles are commit subjects, and semantic-release reads them on main. Both
# use `fix`, which cuts a release, on purpose: a moved ceiling changes the
# range every released artifact declares, and a moved SDK changes what the
# released BFF contains. A type that released nothing would leave what is
# published and what is on main out of step until an unrelated change shipped.
GATEWAY_TITLE = "fix(compat): support gateway %s"
SDK_TITLE = "fix(sdk): move to the OpenShell SDK at %s"

# Measured 2026-10-05 (ADR 0006): gateway 0.0.116 is served by dashboard
# v0.2.0 and the 0.2.x maintenance line cut from it. No build spans it and the
# 0.1.x gateways.
LEGACY_LINE_CEILING = (0, 0, 116)

# Room for the compiler output inside an issue body (GitHub caps it at 65536).
LOG_BUDGET = 6000

OUTCOME_WORDS = {
    outcomes.COMPATIBLE: "compat suite passed",
    outcomes.INCOMPATIBLE: "compat suite FAILED",
    outcomes.PULL_FAILED: "an image could not be pulled",
    outcomes.STACK_FAILED: "gateway did not start",
    outcomes.BFF_FAILED: "the BFF did not start against it",
    outcomes.SOURCE_INCOMPATIBLE: "source check failed",
    outcomes.SDK_UNRESOLVED: "SDK not resolved",
    outcomes.NO_RESULT: "no result",
}

# What a leg that never reached its gateway got stuck on, and where to read why.
SETUP_WORDS = {
    outcomes.PULL_FAILED: (
        "an image could not be pulled, so no gateway was started",
        "The `Pull images` step names the image. If this repeats, the release's image "
        "cannot be pulled from a runner, and a person has to look at the registry.",
    ),
    outcomes.STACK_FAILED: (
        "the gateway never became healthy",
        "The `Start gateway stack` step prints the gateway's own log. The usual cause is "
        "a config schema the CI stack has no template for.",
    ),
    outcomes.BFF_FAILED: (
        "the gateway came up but the BFF did not become healthy in front of it",
        "The `Start the BFF` step and the gateway log in the run say why.",
    ),
}

# Which step of the source check failed. `go vet` compiles test code as well,
# so a test double that no longer satisfies an SDK interface fails there even
# though `go build ./...` passed.
SOURCE_STEP_WORDS = {
    "get": "`go get` could not take this SDK into backend/go.mod",
    "tidy": "`go mod tidy` failed",
    "build": "`go build ./...` failed (the BFF does not compile)",
    "vet": "`go vet ./...` failed (it also compiles the tests)",
    "test": "`go test ./...` failed (the unit tests do not pass)",
}


def _join(items):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def _code(text):
    return "`%s`" % text


def adr_link(repo_url=""):
    """A link to ADR 0006 that works where it is rendered.

    GitHub rewrites a repository-relative link only inside a rendered file.
    In an issue, a pull request or a step summary the browser resolves it
    against the page, which gives a 404, so those get an absolute URL.
    """
    target = "%s/blob/main/%s" % (repo_url.rstrip("/"), ADR_PATH) if repo_url else ADR_PATH
    return "[ADR 0006](%s)" % target


def _range(decision):
    return "%s to %s" % (_code(decision["range"]["floor"]), _code(decision["range"]["ceiling"]))


def _sdk_name(version, tag):
    return "%s (upstream %s)" % (_code(version), tag) if tag else _code(version)


def _pin_name(decision):
    """The SDK pin, and where it sits when that is not a release tag."""
    version = decision["sdk_pin"]
    if decision.get("sdk_pin_tag"):
        return _sdk_name(version, decision["sdk_pin_tag"])
    other = decision.get("sdk_pin_other_tag")
    if other:
        return "%s (at upstream %s, which is not a release)" % (_code(version), _code(other))
    return "%s (not on any upstream tag)" % _code(version)


def _pr_job(axis):
    return "%s axis PR" % axis


def _where(row):
    if row["kind"] != "release":
        return "upstream HEAD"
    words = {"above": "above the range", "in_range": "in the range", "below": "below the range"}[row["position"]]
    return "%s (the %s lane)" % (words, row["lane"]) if row.get("lane") else words


def _gateway_link(row):
    if row["outcome"] == outcomes.INCOMPATIBLE:
        return WIRE_LINK
    if row["outcome"] in outcomes.SETUP_FAILED:
        return "none tested: no request reached the gateway"
    if row["outcome"] == outcomes.NO_RESULT:
        return "unknown"
    return "none"


def _held_action(row):
    below, why = row["held_by"], row.get("held_why", outcomes.HELD_FAILED)
    if why == outcomes.HELD_FAILED:
        return (
            "Nothing yet. It passes, but %s below it does not, and the ceiling never "
            "moves past a release that failed." % below
        )
    if why == outcomes.HELD_MISSING:
        return (
            "Nothing yet. It passes, but the leg for %s below it did not report, and the "
            "ceiling never moves past a release without a result. Re-run the sweep." % below
        )
    if why == outcomes.HELD_SETUP:
        return (
            "Nothing yet. It passes, but %s below it could not be tested in this run, and the "
            "ceiling never moves past a release without a result." % below
        )
    return (
        "Nothing yet. It passes, but %s below it was not swept (%s), and the ceiling never "
        "moves past a release without a result. If %s never gets a result, a person moves the "
        "ceiling by hand." % (below, row.get("held_reason") or "no result", below)
    )


def _gateway_action(row, decision):
    version, status = row["version"], row["status"]
    floor, ceiling = decision["range"]["floor"], decision["range"]["ceiling"]
    if status == outcomes.MISSING:
        return "Unknown. This leg did not report, so nothing is known about the row. Re-run the sweep."
    if row["kind"] != "release":
        if status == outcomes.OK:
            return "Nothing. Upstream HEAD still works with the code we ship. HEAD is never pinned."
        if status == outcomes.WIRE:
            return (
                "Early warning only: nothing to pin and nothing to merge. Whatever changed "
                "on HEAD ships in the next release, so read the failing test now, while it "
                "is one change."
            )
        return (
            "Early warning only. HEAD could not be tested under the CI stack (%s); if that "
            "survives into a release the ceiling cannot move. %s"
            % SETUP_WORDS.get(row["outcome"], SETUP_WORDS[outcomes.STACK_FAILED])
        )
    if status == outcomes.INFO:
        if row["outcome"] == outcomes.COMPATIBLE:
            return (
                "Informational. It works with the code we ship, so the floor could be "
                "lowered by adding a required lane for it. A person decides that."
            )
        text = "Informational, and expected below the floor: it is outside the range we claim."
        if pins.parse_release(version) <= LEGACY_LINE_CEILING:
            text += (
                " Gateways this old are not served by main: 0.0.116 is served by dashboard "
                "v0.2.0 and the 0.2.x maintenance line."
            )
        return text
    if status == outcomes.BUMP:
        return (
            "Passed, so the ceiling can move to %s. The `%s` job of this run opens or rewrites "
            "the pull request on %s; it changes %s only (and the generated range block of "
            "README.md, where there is one). Merge that pull request if the job succeeded. If it "
            "failed or did not run, no pull request was opened, and its log says why."
            % (version, _pr_job("gateway"), _code(GATEWAY_BRANCH), _code(PINS_PATH))
        )
    if status == outcomes.HELD:
        return _held_action(row)
    if status == outcomes.STACK:
        what, where = SETUP_WORDS.get(row["outcome"], SETUP_WORDS[outcomes.STACK_FAILED])
        return "Not a compatibility result: %s, so neither link was tested. %s" % (what, where)
    if status == outcomes.WIRE and row["position"] == "above":
        return (
            "Leave the gateway pins alone: the range stops at %s. With the SDK held at the "
            "pin, the code we ship and gateway %s disagree at run time. Read the failing test "
            "in the run. If the SDK axis below shows a newer SDK passing every supported "
            "gateway, moving to that SDK comes first, and the next sweep retests %s against it; "
            "if not, the BFF has to adapt before the ceiling can move." % (ceiling, version, version)
        )
    if status == outcomes.WIRE:
        text = (
            "We claim %s to %s, so this is a broken promise. Reproduce with "
            "`OPENSHELL_VERSION=%s OPENSHELL_CONFIG_SCHEMA=auto make compat` and read which "
            "request fails. Then fix it, or narrow the range by hand." % (floor, ceiling, version)
        )
        if row.get("repushed"):
            text += (
                " Upstream re-pushed this release: its tag no longer resolves to the digest the "
                "lane pins, so CI, which pulls the pinned digest, may still be green."
            )
        elif row.get("lane"):
            text += " It is a required lane, so CI on main is red too."
        return text
    if row.get("passed_over_for"):
        return "Nothing. The ceiling moves past it to %s." % row["passed_over_for"]
    if row.get("not_proposed"):
        return (
            "Nothing from this run. It passes, but a leg above the ceiling did not report, so "
            "this run cannot say where the ceiling belongs and proposes nothing. Re-run the sweep."
        )
    return "Nothing."


def _lane_words(lane):
    version, outcome = lane["version"], lane["outcome"]
    return {
        outcomes.COMPATIBLE: "gateway %s passes",
        outcomes.INCOMPATIBLE: "gateway %s FAILS",
        outcomes.PULL_FAILED: "gateway %s: an image could not be pulled",
        outcomes.STACK_FAILED: "gateway %s did not start",
        outcomes.BFF_FAILED: "gateway %s: the BFF did not start against it",
        outcomes.SOURCE_INCOMPATIBLE: "gateway %s not reached",
        outcomes.SDK_UNRESOLVED: "gateway %s not reached",
        outcomes.NO_RESULT: "gateway %s no result",
    }[outcome] % version


def _source_step(row):
    return SOURCE_STEP_WORDS.get(row.get("source_step"), "the source check failed; see the output below")


def _sdk_result(row):
    status = row["status"]
    if status == outcomes.SOURCE:
        return "source check failed: " + _source_step(row)
    if status == outcomes.UNRESOLVED:
        return "not resolved: " + _source_step(row)
    if status == outcomes.FLAKY:
        failed = [l["version"] for l in row["lanes"] if l["outcome"] in (outcomes.SOURCE_INCOMPATIBLE, outcomes.SDK_UNRESOLVED)]
        passed = [
            l["version"]
            for l in row["lanes"]
            if l["outcome"] in (outcomes.COMPATIBLE, outcomes.INCOMPATIBLE) + outcomes.SETUP_FAILED
        ]
        return "the legs disagree: %s on the leg for gateway %s, and the same check passed on the leg for gateway %s" % (
            _source_step(row),
            _join(failed),
            _join(passed),
        )
    lanes = "; ".join(_lane_words(lane) for lane in row["lanes"])
    # "The source check passes" is something a leg has to have seen. A leg
    # that never reported saw nothing.
    if all(lane["outcome"] == outcomes.NO_RESULT for lane in row["lanes"]):
        return "no leg reported" + ("; " + lanes if lanes else "")
    return "source check passes; " + lanes


def _sdk_link(row):
    return {
        outcomes.SOURCE: SOURCE_LINK,
        outcomes.WIRE: WIRE_LINK,
        outcomes.STACK: "none tested: a leg did not reach its gateway",
        outcomes.UNRESOLVED: "none tested: the SDK did not resolve",
        outcomes.MISSING: "unknown",
        outcomes.FLAKY: "unknown",
    }.get(row["status"], "none")


def _sdk_action(row, decision):
    status, early = row["status"], row["early_warning"]
    floor = decision["range"]["floor"]
    if status == outcomes.MISSING:
        return "Unknown. A leg did not report, so nothing is known about the row. Re-run the sweep."
    if status == outcomes.FLAKY:
        return (
            "Unknown. Every leg runs the same source check on the same SDK, so a check that "
            "fails on one and passes on another is not a property of the SDK: a flaky unit "
            "test, or the network. Re-run the sweep. The failing leg's output is below; an "
            "open SDK PR is left as it is."
        )
    if status == outcomes.BUMP:
        return (
            "Passed the source check and every supported gateway. The `%s` job of this run "
            "opens or rewrites the pull request on %s; it changes backend/go.mod, backend/go.sum "
            "and the sdk field of %s only (and the generated range block of README.md, where "
            "there is one), and no gateway moves. Merge that pull request if the job succeeded. "
            "If it failed or did not run, no pull request was opened, and its log says why."
            % (_pr_job("sdk"), _code(SDK_BRANCH), _code(PINS_PATH))
        )
    if status == outcomes.OK:
        return (
            "Nothing. The SDK at upstream HEAD passes the source check and every supported "
            "gateway, so the next release should be a plain bump. @latest is never pinned."
        )
    if status == outcomes.SOURCE:
        if early:
            return (
                "Early warning only: nothing to merge. The BFF no longer passes the source "
                "check against the SDK at upstream HEAD, so the next release will need this "
                "source migration. This is not a gateway problem. The output is below."
            )
        return (
            "Migrate the BFF. The source check fails against this SDK, which is a change to "
            "make in backend/ and NOT a gateway problem: no gateway was contacted. Fix what "
            "the output below names and move the pin in that same PR; the required compat "
            "lanes then prove the wire."
        )
    if status == outcomes.UNRESOLVED:
        lead = "Early warning only: nothing to merge. " if early else ""
        return lead + (
            "Not a result yet: the SDK could not be fetched or resolved into backend/go.mod, "
            "which is the network as often as the SDK. Re-run the sweep first. If it repeats, "
            "the output below says why - a package the BFF imports is gone, or the SDK needs a "
            "newer Go - and that is a source migration to make in backend/. No gateway was "
            "contacted, and an open SDK PR is left as it is."
        )
    unknown = [lane for lane in row["lanes"] if lane["outcome"] not in (outcomes.COMPATIBLE, outcomes.INCOMPATIBLE)]
    if status == outcomes.STACK:
        return (
            "Inconclusive: %s, so the wire was not tested there. Read that leg's log: an image "
            "or a gateway that fails is a CI stack problem, while a BFF that does not start may "
            "be this SDK. Then re-run the sweep." % _join(_lane_words(lane) for lane in unknown)
        )
    dropped = _join(row["dropped"])
    lead = "Early warning only: nothing to merge. " if early else "No PR. "
    # Only what was seen. A lane without a result is neither "works" nor "does
    # not work", so it is named as unknown instead of being counted.
    not_known = (
        " Not known from this run: %s." % _join(_lane_words(lane) for lane in unknown) if unknown else ""
    )
    if all(lane["outcome"] == outcomes.INCOMPATIBLE for lane in row["lanes"]):
        return lead + (
            "This SDK works with none of the gateways we support (%s). Moving to it would "
            "replace the whole supported range, which is a new line of the dashboard, not a bump."
            % dropped
        )
    if row["drops_floor"]:
        return lead + (
            "This SDK would drop gateway %s, the floor of the supported range. Raising the "
            "floor breaks deployments still running %s, so a person decides: stay on the "
            "current SDK, or raise the floor and move the SDK in one deliberate change."
            % (floor, floor)
        ) + not_known
    return lead + (
        "This SDK would drop gateway %s, which we support. A person decides whether the "
        "range may shrink." % dropped
    ) + not_known


def _table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(cell.replace("|", "/") for cell in row) + " |" for row in rows]
    return out


def clip(log, budget=LOG_BUDGET):
    """Keep the start and the end of a long log.

    Compiler errors are at the start; a failing test's verdict is at the end.
    """
    log = (log or "").strip().replace("```", "'''")
    if len(log) <= budget:
        return log
    half = budget // 2
    return log[:half].rstrip() + "\n\n[... %d characters cut ...]\n\n" % (len(log) - 2 * half) + log[-half:].lstrip()


def _gateway_section(decision):
    rows = decision["gateway"]["rows"]
    out = [
        "## Gateway axis: which gateways does the code we ship today work with?",
        "",
        "The SDK stays at the pin; only the gateway image changes. A failure here is on "
        "the **%s** link." % WIRE_LINK,
        "",
    ]
    if not rows:
        return out + ["No gateway was swept.", ""]
    table = [
        [_code(r["version"]), _where(r), OUTCOME_WORDS[r["outcome"]], _gateway_link(r), _gateway_action(r, decision)]
        for r in rows
    ]
    return out + _table(["Gateway", "Where", "Result", "Link that failed", "What to do"], table) + [""]


def _sdk_label(row):
    return "@latest" if row["kind"] == "latest" else row["label"]


def _sdk_section(decision):
    rows = decision["sdk"]["rows"]
    lanes = _join(_code(lane) for lane in decision["lanes"])
    out = [
        "## SDK axis: can we move to a newer SDK without losing a gateway we support?",
        "",
        "The gateways stay at the required lanes (%s); only the SDK changes. Each candidate "
        "is first built, vetted and unit-tested (the **%s** link) and only then run against "
        "the gateways (the **%s** link)." % (lanes, SOURCE_LINK, WIRE_LINK),
        "",
    ]
    if not rows:
        newest = " (%s)" % decision["newest_release"] if decision.get("newest_release") else ""
        head = (
            ", and upstream HEAD has not moved past it"
            if decision.get("head_probed", True)
            else "; upstream HEAD was not probed in this run"
        )
        return out + [
            "Nothing to try: the pin is not older than the SDK of the newest upstream release%s%s."
            % (newest, head),
            "",
        ]
    table = [
        [
            "%s %s" % ("`@latest`" if r["kind"] == "latest" else r["label"], _code(r["version"])),
            _sdk_result(r),
            _sdk_link(r),
            _sdk_action(r, decision),
        ]
        for r in rows
    ]
    out += _table(["SDK", "Result", "Link that failed", "What to do"], table) + [""]
    for r in rows:
        if r["status"] in (outcomes.SOURCE, outcomes.UNRESOLVED, outcomes.FLAKY):
            out += [
                "<details><summary>Source check output for SDK %s (failed at: %s)</summary>"
                % (_sdk_label(r), r.get("source_step") or "unknown"),
                "",
                "```text",
                clip(r.get("source_log")) or "(the leg captured no output)",
                "```",
                "",
                "</details>",
                "",
            ]
    return out


PIN_NOTICE = (
    "The SDK pin is not the commit of an upstream release tag. ADR 0006 pins the SDK to a "
    "release-tag commit; this one was moved by hand. Move it to a release tag's commit in a "
    "PR of its own (backend/go.mod, backend/go.sum and the `sdk` field of %s)."
) % _code(PINS_PATH)


def _headline(decision):
    """The rows that need a person, one bullet each, most urgent first."""
    bullets = []
    for row in decision["gateway"]["rows"]:
        if row["status"] in outcomes.NEEDS_ATTENTION and not row["early_warning"]:
            bullets.append(
                "Gateway %s, %s: %s. Link: **%s**."
                % (_code(row["version"]), _where(row), OUTCOME_WORDS[row["outcome"]], _gateway_link(row))
            )
    for row in decision["sdk"]["rows"]:
        if row["status"] in outcomes.NEEDS_ATTENTION and not row["early_warning"]:
            bullets.append("SDK %s: %s. Link: **%s**." % (row["label"], _sdk_result(row), _sdk_link(row)))
    if not decision.get("sdk_pin_tag"):
        bullets.append("SDK pin %s. %s" % (_pin_name(decision), PIN_NOTICE))
    early = []
    for row in decision["gateway"]["rows"]:
        if row["status"] in outcomes.NEEDS_ATTENTION and row["early_warning"]:
            early.append("gateway `dev`: %s (%s)" % (OUTCOME_WORDS[row["outcome"]], _gateway_link(row)))
    for row in decision["sdk"]["rows"]:
        if row["status"] in outcomes.NEEDS_ATTENTION and row["early_warning"]:
            early.append("SDK `@latest`: %s (%s)" % (_sdk_result(row), _sdk_link(row)))
    return bullets, early


def _notes(decision):
    notes = []
    floor, ceiling = (pins.parse_release(decision["range"][key]) for key in ("floor", "ceiling"))
    for row in decision["gateway"]["rows"]:
        if row.get("repushed"):
            notes.append(
                "Upstream re-pushed release %s: its tag now resolves to a different digest than "
                "the lane pins. The sweep tested the image the tag resolves to today (%s); CI "
                "still pulls the pinned one. Re-pin the lane by hand if the new image is the "
                "one to support." % (_code(row["version"]), _code(row["gateway_image"]))
            )
    for skipped in decision["notes"]["skipped"]:
        notes.append("Gateway %s was not swept: %s." % (_code(skipped["version"]), skipped["reason"]))
    not_swept = decision["notes"]["not_swept"]
    in_range = [v for v in not_swept if floor <= pins.parse_release(v) <= ceiling]
    if in_range:
        notes.append(
            "Inside the supported range but NOT swept in this run: %s. max_versions=%s narrowed "
            "it to the newest releases at or below the ceiling. A run with max_versions left "
            "empty (every scheduled run) covers the whole range; this one cannot close the issue."
            % (_join(_code(v) for v in in_range), decision.get("max_versions"))
        )
    rest = [v for v in not_swept if v not in in_range]
    if rest:
        notes.append("Also left out by max_versions: %s." % _join(_code(v) for v in rest))
    if not decision.get("head_probed", True):
        notes.append(
            "Upstream HEAD (gateway `dev`, SDK `@latest`) was not probed: include_head was off. "
            "This run cannot close the issue."
        )
    if decision["incomplete"]:
        notes.append(
            "This run is INCOMPLETE: at least one leg did not report, or legs disagreed. Rows "
            "marked \"no result\" or \"unknown\" are unknown, not passing."
        )
    return notes


def _body(decision, run_url):
    bullets, early = _headline(decision)
    out = [
        "- **Supported gateway range:** %s, derived from the required lanes in %s."
        % (_range(decision), _code(PINS_PATH)),
        "- **SDK pin:** %s." % _pin_name(decision),
        "",
    ]
    if bullets:
        out += ["### Needs a person", ""] + ["- " + b for b in bullets] + [""]
    if early:
        out += ["### Early warning from upstream HEAD (nothing to pin, nothing to merge)", ""]
        out += ["- " + e for e in early] + [""]
    if not bullets and not early:
        out += ["Nothing is outstanding on either axis.", ""]
    out += _gateway_section(decision) + _sdk_section(decision)

    notes = _notes(decision)
    if notes:
        out += ["## Notes", ""] + ["- " + n for n in notes] + [""]
    if run_url:
        out += ["[Sweep run](%s)" % run_url, ""]
    return out


def render_issue(decision, run_url="", repo_url=""):
    """(title, body) of the singleton issue. Only meaningful when action is upsert."""
    preamble = [
        ISSUE_MARKER,
        "Maintained by `.github/workflows/compat-sweep.yml` (%s). Rewritten in "
        "place by every sweep and closed automatically when nothing is outstanding. Do not "
        "edit it by hand: the next sweep overwrites it." % adr_link(repo_url),
        "",
        "The version chain is gateway -> SDK -> BFF -> UI, and each link is proven "
        "separately. Every row below names the link that failed.",
        "",
    ]
    return decision["issue"]["title"], "\n".join(preamble + _body(decision, run_url))


def render_summary(decision, run_url="", repo_url="", dry_run=False):
    """The step summary: always the whole picture, including what the run will do."""
    actions = [
        "issue: **%s**" % decision["issue"]["action"],
        "gateway PR: **%s**" % decision["gateway"]["pr"],
        "SDK PR: **%s**" % decision["sdk"]["pr"],
    ]
    out = ["# Compat sweep", "", " | ".join(actions), ""]
    if dry_run:
        out += [
            "> **Dry run.** This run is not on `main`, so it writes nothing: no issue, no "
            "branch, no pull request. The line above and the rows below are what a run on "
            "`main` would do.",
            "",
        ]
    kept = decision["issue"].get("kept_because") or []
    if kept:
        out += ["The issue is left exactly as it is, open or not, because " + "; and ".join(kept) + ".", ""]
    out += ["What the rows mean: %s." % adr_link(repo_url), ""]
    return "\n".join(out + _body(decision, run_url))


def _ci_note(has_sweep_token):
    if has_sweep_token:
        return (
            "**CI.** Opened with the `SWEEP_TOKEN` secret, so the usual `pull_request` "
            "workflows run on their own."
        )
    return (
        "**CI does not start by itself on this PR.** It was opened with the workflow's "
        "default `GITHUB_TOKEN`, and GitHub does not let that token start new workflow "
        "runs unattended. Do one of these before reviewing:\n\n"
        "- if the merge box shows **Approve workflows to run**, press it;\n"
        "- otherwise close and reopen the PR, or push an empty commit to this branch, "
        "from your own account.\n\n"
        "To make it automatic, add a repository secret `SWEEP_TOKEN` (a fine-grained "
        "token or GitHub App token with read/write on Contents and Pull requests for this "
        "repository). The sweep uses it when present and falls back to the default token."
    )


def _both_axes_note(decision, axis):
    other = "sdk" if axis == "gateway" else "gateway"
    if not decision[other]["bump"]:
        return []
    branch = SDK_BRANCH if axis == "gateway" else GATEWAY_BRANCH
    return [
        "**The other axis proposes a change too** (%s). The sweep proved each change against "
        "main as it is today, not the two together. Merge one, update the other branch so CI "
        "reruns the required lanes on the combination, then merge the second." % _code(branch),
        "",
    ]


RELEASE_NOTE = (
    "**Merging this cuts a release.** The title is a `fix:` on purpose: %s, so the next "
    "published version has to say so."
)


def render_pr(axis, decision, run_url="", has_sweep_token=False, repo_url="", readme_block=False):
    """Title, body and commit message for one axis's PR.

    readme_block: the pending change also regenerates the range block of
    README.md, so the text says so instead of claiming fewer files than the
    diff shows.
    """
    floor, ceiling = decision["range"]["floor"], decision["range"]["ceiling"]
    pin = _sdk_name(decision["sdk_pin"], decision.get("sdk_pin_tag"))
    opener = "Opened by the [compat sweep](%s)" % run_url if run_url else "Opened by the compat sweep"
    readme_md = (
        ", and the generated range block of `%s`, which restates the range and the SDK pin "
        "from that file. Nothing else" % README_PATH
        if readme_block
        else " only"
    )
    readme_txt = (
        ", and regenerates the range block of %s from it. Nothing else changes." % README_PATH
        if readme_block
        else "."
    )
    if axis == "gateway":
        bump = decision["gateway"]["bump"]
        version = bump["version"]
        title = GATEWAY_TITLE % version
        summary = (
            "The compat sweep ran backend/test/compat against gateway %s with the BFF "
            "built from the checked-in backend/go.mod, and it passed.\n\n"
            "This moves the ceiling lane in %s from %s to "
            "%s, pinned by digest%s The floor lane (%s) and the SDK pin are unchanged. "
            "Supported range after this change: %s to %s.\n\n"
            "A fix, not a ci change, so that it is released: the range the published "
            "artifacts declare changes with it."
            % (version, PINS_PATH, bump["from"], version, readme_txt, floor, floor, version)
        )
        body = [
            "%s, gateway axis (%s)." % (opener, adr_link(repo_url)),
            "",
            "**What was proven.** The BFF built from the checked-in `backend/go.mod` (SDK %s) "
            "passes `backend/test/compat` against gateway `%s`, pulled by the digest pinned "
            "here. That is the wire link (gateway<->SDK) for this pair." % (pin, version),
            "",
            "**What this changes.** %s%s. The ceiling lane moves from `%s` to `%s`; the "
            "floor lane (`%s`) is untouched and the SDK pin does not move on this axis. "
            "Supported range after merge: `%s` to `%s`."
            % (_code(PINS_PATH), readme_md, bump["from"], version, floor, floor, version),
            "",
            "| | Pinned |",
            "|---|---|",
            "| gateway | `%s` |" % bump["gateway_image"],
            "| supervisor | `%s` |" % bump["supervisor_image"],
            "| config schema | `%s` (what the gateway accepted in the sweep) |" % bump["config_schema"],
            "",
            "The compat job is named after the lane label, so its check name changes to "
            "`compat (gateway %s)`." % pins.CEILING_LABEL.format(version=version),
            "",
            RELEASE_NOTE % "the supported range that every released artifact declares grows with it",
            "",
        ]
    else:
        bump = decision["sdk"]["bump"]
        tag = bump["tag"]
        title = SDK_TITLE % tag
        lanes = _join("`%s`" % lane for lane in bump["lanes"])
        summary = (
            "The compat sweep moved the SDK to %s (the commit of upstream "
            "release %s), built, vetted and unit-tested the BFF against it, and ran "
            "backend/test/compat against every required lane (%s). All passed.\n\n"
            "This changes backend/go.mod, backend/go.sum and the sdk field of "
            "%s%s No gateway image moves, so the supported range stays "
            "%s to %s.\n\n"
            "A fix, not a build change, so that it is released: the BFF that is "
            "published is built against this SDK."
            % (bump["version"], tag, _join(bump["lanes"]), PINS_PATH, readme_txt, floor, ceiling)
        )
        body = [
            "%s, SDK axis (%s)." % (opener, adr_link(repo_url)),
            "",
            "**What was proven.** With the SDK at `%s` (the commit of upstream release %s):"
            % (bump["version"], tag),
            "",
            "- the source link (SDK<->BFF): `go build ./...`, `go vet ./...` and "
            "`go test ./...` pass in `backend/`;",
            "- the wire link (gateway<->SDK): `backend/test/compat` passes against every "
            "required lane, %s, at the digests already pinned." % lanes,
            "",
            "The `go.mod` and `go.sum` here are the files those legs produced and tested, "
            "copied in unchanged. Nothing was built or run by the job that opened this PR.",
            "",
            "**What this changes.** `backend/go.mod`, `backend/go.sum` and the `sdk` field of "
            "%s%s. The pin moves from %s. No gateway image moves on this axis, so the "
            "supported range stays `%s` to `%s`." % (_code(PINS_PATH), readme_md, pin, floor, ceiling),
            "",
            RELEASE_NOTE % "the published BFF is built against the SDK this moves to",
            "",
        ]
    body += _both_axes_note(decision, axis)
    body += [
        _ci_note(has_sweep_token),
        "",
        "Never merged automatically. A later sweep rewrites this PR in place, or closes it if "
        "it retests the change and the result no longer holds.",
    ]
    # A commit body wrapped at 72 columns; image references and versions stay whole.
    paragraphs = [
        textwrap.fill(paragraph, 72, break_long_words=False, break_on_hyphens=False)
        for paragraph in summary.split("\n\n")
    ]
    commit = "%s\n\n%s\n" % (title, "\n\n".join(paragraphs))
    return {"title": title, "body": "\n".join(body) + "\n", "commit": commit}
