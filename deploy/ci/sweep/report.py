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
"""

import textwrap

import outcomes
import pins

ISSUE_MARKER = "<!-- compat-sweep -->"
ISSUE_LABEL = "compat-migrate"
ADR = "docs/adrs/0006-compat-links-and-sweep-axes.md"
PINS_PATH = "deploy/ci/gateway-pins.json"

WIRE_LINK = "wire: gateway<->SDK"
SOURCE_LINK = "source: SDK<->BFF"

GATEWAY_BRANCH = "compat-sweep/gateway"
SDK_BRANCH = "compat-sweep/sdk"

# Gateways up to this release are served by the 0.x maintenance line. No build
# spans them and the 0.1.x gateways (ADR 0006).
LEGACY_LINE_CEILING = (0, 0, 116)

# Room for the compiler output inside an issue body (GitHub caps it at 65536).
LOG_BUDGET = 6000

OUTCOME_WORDS = {
    outcomes.COMPATIBLE: "compat suite passed",
    outcomes.INCOMPATIBLE: "compat suite FAILED",
    outcomes.STACK_FAILED: "gateway did not start",
    outcomes.SOURCE_INCOMPATIBLE: "source check failed",
    outcomes.NO_RESULT: "no result",
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


def _range(decision):
    return "%s to %s" % (_code(decision["range"]["floor"]), _code(decision["range"]["ceiling"]))


def _sdk_name(version, tag):
    return "%s (upstream %s)" % (_code(version), tag) if tag else _code(version)


def _where(row):
    if row["kind"] != "release":
        return "upstream HEAD"
    words = {"above": "above the range", "in_range": "in the range", "below": "below the range"}[row["position"]]
    return "%s (the %s lane)" % (words, row["lane"]) if row.get("lane") else words


def _gateway_link(row):
    if row["outcome"] == outcomes.INCOMPATIBLE:
        return WIRE_LINK
    if row["outcome"] == outcomes.STACK_FAILED:
        return "none tested: no request reached the gateway"
    if row["outcome"] == outcomes.NO_RESULT:
        return "unknown"
    return "none"


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
            "Early warning only. HEAD did not start under the CI stack; if that survives "
            "into a release the ceiling cannot move. Read the stack log in the run."
        )
    if status == outcomes.INFO:
        if row["outcome"] == outcomes.COMPATIBLE:
            return (
                "Informational. It works with the code we ship, so the floor could be "
                "lowered by adding a required lane for it. A person decides that."
            )
        text = "Informational, and expected below the floor: it is outside the range we claim."
        if pins.parse_release(version) <= LEGACY_LINE_CEILING:
            text += " Gateways up to 0.0.116 are served by the 0.x maintenance line, not by main."
        return text
    if status == outcomes.BUMP:
        return "Merge the PR on %s. It moves the ceiling lane to %s and changes %s only." % (
            _code(GATEWAY_BRANCH),
            version,
            _code(PINS_PATH),
        )
    if status == outcomes.HELD:
        return (
            "Nothing yet. It passes, but %s below it does not, and the ceiling never "
            "moves past a release that failed." % row["held_by"]
        )
    if status == outcomes.STACK:
        return (
            "Not a compatibility result: the gateway never became healthy, so neither link "
            "was tested. Read the stack log in the run. The usual causes are a config schema "
            "the CI stack has no template for and an image that cannot be pulled."
        )
    if status == outcomes.WIRE and row["position"] == "above":
        return (
            "Leave the gateway pins alone: the range stops at %s. With the SDK held at the "
            "pin, the code we ship and gateway %s disagree at run time. Read the failing test "
            "in the run. If the SDK axis shows a newer SDK passing every supported gateway, "
            "merge that PR and the next sweep retests %s against it; if not, the BFF has to "
            "adapt before the ceiling can move." % (ceiling, version, version)
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
    return "Nothing."


def _sdk_result(row):
    if row["status"] == outcomes.SOURCE:
        return "source check failed: " + SOURCE_STEP_WORDS.get(row["source_step"], "see the output below")
    words = {
        outcomes.COMPATIBLE: "passes",
        outcomes.INCOMPATIBLE: "FAILS",
        outcomes.STACK_FAILED: "did not start",
        outcomes.SOURCE_INCOMPATIBLE: "not reached",
        outcomes.NO_RESULT: "no result",
    }
    return "source check passes; " + "; ".join(
        "gateway %s %s" % (lane["version"], words[lane["outcome"]]) for lane in row["lanes"]
    )


def _sdk_link(row):
    return {
        outcomes.SOURCE: SOURCE_LINK,
        outcomes.WIRE: WIRE_LINK,
        outcomes.STACK: "none tested: a pinned gateway did not start",
        outcomes.MISSING: "unknown",
    }.get(row["status"], "none")


def _sdk_action(row, decision):
    status, early = row["status"], row["early_warning"]
    floor = decision["range"]["floor"]
    if status == outcomes.MISSING:
        return "Unknown. A leg did not report, so nothing is known about the row. Re-run the sweep."
    if status == outcomes.BUMP:
        return (
            "Merge the PR on %s. It changes backend/go.mod, backend/go.sum and the sdk field "
            "of %s only; no gateway moves." % (_code(SDK_BRANCH), _code(PINS_PATH))
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
    if status == outcomes.STACK:
        return (
            "Inconclusive: a pinned gateway did not start, so the wire was not tested. That "
            "is a CI stack problem, not an SDK one. Read the stack log and re-run the sweep."
        )
    dropped = _join(row["dropped"])
    passing = [lane["version"] for lane in row["lanes"] if lane["outcome"] == outcomes.COMPATIBLE]
    lead = "Early warning only: nothing to merge. " if early else "No PR. "
    if not passing:
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
        )
    return lead + (
        "This SDK would drop gateway %s, which we support. A person decides whether the "
        "range may shrink." % dropped
    )


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
        if r["status"] == outcomes.SOURCE:
            out += [
                "<details><summary>Source check output for SDK %s (failed at: %s)</summary>"
                % ("@latest" if r["kind"] == "latest" else r["label"], r["source_step"]),
                "",
                "```text",
                clip(r.get("source_log")) or "(the leg captured no output)",
                "```",
                "",
                "</details>",
                "",
            ]
    return out


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
    early = []
    for row in decision["gateway"]["rows"]:
        if row["status"] in outcomes.NEEDS_ATTENTION and row["early_warning"]:
            early.append("gateway `dev`: %s (%s)" % (OUTCOME_WORDS[row["outcome"]], _gateway_link(row)))
    for row in decision["sdk"]["rows"]:
        if row["status"] in outcomes.NEEDS_ATTENTION and row["early_warning"]:
            early.append("SDK `@latest`: %s (%s)" % (_sdk_result(row), _sdk_link(row)))
    return bullets, early


def _body(decision, run_url):
    bullets, early = _headline(decision)
    out = [
        "- **Supported gateway range:** %s, derived from the required lanes in %s."
        % (_range(decision), _code(PINS_PATH)),
        "- **SDK pin:** %s." % _sdk_name(decision["sdk_pin"], decision.get("sdk_pin_tag")),
        "",
    ]
    if not decision.get("sdk_pin_tag"):
        out += [
            "> The SDK pin is not the commit of an upstream release tag. ADR 0006 pins the "
            "SDK to a release-tag commit; this one was moved by hand.",
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

    notes = []
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
    if decision["notes"]["not_swept"]:
        notes.append(
            "Not swept because of the max_versions cap: %s. Re-run with a larger cap to cover them."
            % _join(_code(v) for v in decision["notes"]["not_swept"])
        )
    if not decision.get("head_probed", True):
        notes.append("Upstream HEAD (gateway `dev`, SDK `@latest`) was not probed: include_head was off.")
    if decision["incomplete"]:
        notes.append(
            "This run is INCOMPLETE: at least one leg did not report. Rows marked "
            "\"no result\" are unknown, not passing."
        )
    if notes:
        out += ["## Notes", ""] + ["- " + n for n in notes] + [""]
    if run_url:
        out += ["[Sweep run](%s)" % run_url, ""]
    return out


def render_issue(decision, run_url=""):
    """(title, body) of the singleton issue. Only meaningful when action is upsert."""
    preamble = [
        ISSUE_MARKER,
        "Maintained by `.github/workflows/compat-sweep.yml` ([ADR 0006](%s)). Rewritten in "
        "place by every sweep and closed automatically when nothing is outstanding. Do not "
        "edit it by hand: the next sweep overwrites it." % ADR,
        "",
        "The version chain is gateway -> SDK -> BFF -> UI, and each link is proven "
        "separately. Every row below names the link that failed.",
        "",
    ]
    return decision["issue"]["title"], "\n".join(preamble + _body(decision, run_url))


def render_summary(decision, run_url=""):
    """The step summary: always the whole picture, including what the run will do."""
    actions = [
        "issue: **%s**" % decision["issue"]["action"],
        "gateway PR: **%s**" % decision["gateway"]["pr"],
        "SDK PR: **%s**" % decision["sdk"]["pr"],
    ]
    out = ["# Compat sweep", "", " | ".join(actions), ""] + _body(decision, run_url)
    return "\n".join(out)


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
        "**The other axis has a PR too** (%s). The sweep proved each change against main "
        "as it is today, not the two together. Merge one, update the other branch so CI "
        "reruns the required lanes on the combination, then merge the second." % _code(branch),
        "",
    ]


def render_pr(axis, decision, run_url="", has_sweep_token=False):
    """Title, body and commit message for one axis's PR.

    The titles use commit types that do not cut a release on their own
    (semantic-release publishes from main): `ci` for a pins-only change and
    `build` for a dependency move.
    """
    floor, ceiling = decision["range"]["floor"], decision["range"]["ceiling"]
    pin = _sdk_name(decision["sdk_pin"], decision.get("sdk_pin_tag"))
    opener = "Opened by the [compat sweep](%s)" % run_url if run_url else "Opened by the compat sweep"
    if axis == "gateway":
        bump = decision["gateway"]["bump"]
        version = bump["version"]
        title = "ci(compat): move the gateway ceiling to %s" % version
        summary = (
            "The compat sweep ran backend/test/compat against gateway %s with the BFF "
            "built from the checked-in backend/go.mod, and it passed.\n\n"
            "This moves the ceiling lane in %s from %s to "
            "%s, pinned by digest. The floor lane (%s) and the SDK pin are unchanged. "
            "Supported range after this change: %s to %s."
            % (version, PINS_PATH, bump["from"], version, floor, floor, version)
        )
        body = [
            "%s, gateway axis ([ADR 0006](%s))." % (opener, ADR),
            "",
            "**What was proven.** The BFF built from the checked-in `backend/go.mod` (SDK %s) "
            "passes `backend/test/compat` against gateway `%s`, pulled by the digest pinned "
            "here. That is the wire link (gateway<->SDK) for this pair." % (pin, version),
            "",
            "**What this changes.** %s only. The ceiling lane moves from `%s` to `%s`; the "
            "floor lane (`%s`) is untouched and the SDK pin does not move on this axis. "
            "Supported range after merge: `%s` to `%s`." % (_code(PINS_PATH), bump["from"], version, floor, floor, version),
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
        ]
    else:
        bump = decision["sdk"]["bump"]
        tag = bump["tag"]
        title = "build(sdk): move the OpenShell SDK to %s" % tag
        lanes = _join("`%s`" % lane for lane in bump["lanes"])
        summary = (
            "The compat sweep moved the SDK to %s (the commit of upstream "
            "release %s), built, vetted and unit-tested the BFF against it, and ran "
            "backend/test/compat against every required lane (%s). All passed.\n\n"
            "This changes backend/go.mod, backend/go.sum and the sdk field of "
            "%s. No gateway image moves, so the supported range stays "
            "%s to %s."
            % (bump["version"], tag, _join(bump["lanes"]), PINS_PATH, floor, ceiling)
        )
        body = [
            "%s, SDK axis ([ADR 0006](%s))." % (opener, ADR),
            "",
            "**What was proven.** With the SDK at `%s` (the commit of upstream release %s):"
            % (bump["version"], tag),
            "",
            "- the source link (SDK<->BFF): `go build ./...`, `go vet ./...` and "
            "`go test ./...` pass in `backend/`;",
            "- the wire link (gateway<->SDK): `backend/test/compat` passes against every "
            "required lane, %s, at the digests already pinned." % lanes,
            "",
            "**What this changes.** `backend/go.mod`, `backend/go.sum` and the `sdk` field of "
            "%s only. The pin moves from %s. No gateway image moves on this axis, so the "
            "supported range stays `%s` to `%s`." % (_code(PINS_PATH), pin, floor, ceiling),
            "",
        ]
    body += _both_axes_note(decision, axis)
    body += [
        _ci_note(has_sweep_token),
        "",
        "Never merged automatically. A later sweep rewrites this PR in place, or closes it if "
        "the result no longer holds.",
    ]
    # A commit body wrapped at 72 columns; image references and versions stay whole.
    paragraphs = [
        textwrap.fill(paragraph, 72, break_long_words=False, break_on_hyphens=False)
        for paragraph in summary.split("\n\n")
    ]
    commit = "%s\n\n%s\n" % (title, "\n\n".join(paragraphs))
    return {"title": title, "body": "\n".join(body) + "\n", "commit": commit}
