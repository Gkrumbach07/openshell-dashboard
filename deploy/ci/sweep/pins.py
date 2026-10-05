"""deploy/ci/gateway-pins.json: load it, validate it, derive the range, edit it.

The pins file is the single statement of which gateways this dashboard claims
to work with (ADR 0006). Everything that needs "the floor" or "the ceiling"
derives them here from the required lanes, so the range cannot be restated by
hand somewhere else and drift.

Two invariants are enforced by validate() rather than left to review:

  * release lanes are pinned by digest (tag@sha256 - the tag is for readers,
    the digest is what gets pulled);
  * dev / HEAD builds are never pinned. A dev gateway resolves
    ghcr.io/nvidia/openshell/sandbox:dev at runtime, so even a digest-pinned
    dev lane drifts with upstream HEAD. That is what broke main on 2026-10-02.
"""

import copy
import json
import os
import re

REQUIRED_TOP_KEYS = ("sdk", "sandbox_image", "lanes")
# Keys that would restate the supported range. The range is derived from the
# required lanes and stored nowhere, so these are refused outright.
RANGE_KEYS = ("floor", "floor_release", "ceiling", "ceiling_release", "range")
LANE_KEYS = ("version", "label", "required", "config_schema", "gateway_image", "supervisor_image")

RELEASE_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
# A Go pseudo-version (what `go get module@<commit>` writes) or a tagged
# release. Never a query such as "latest": a query is not a pin.
SDK_PSEUDO_RE = re.compile(r"^v\d+\.\d+\.\d+-(?:[0-9A-Za-z.]+\.)?\d{14}-[0-9a-f]{12}$")
SDK_TAGGED_RE = re.compile(r"^v\d+\.\d+\.\d+$")
SDK_MODULE = "github.com/NVIDIA/OpenShell/sdk/go"

# Tags that move. An image reference carrying one of these is not a release
# even when a digest is attached, because the gateway inside still resolves
# moving images of its own at runtime.
MOVING_TAGS = ("dev", "latest", "main", "nightly", "edge")

CEILING_LABEL = "{version}, newest tested"
FLOOR_LABEL = "{version}, oldest supported"


class PinsError(Exception):
    """The pins file is malformed. str() lists every problem, one per line."""

    def __init__(self, problems):
        self.problems = list(problems)
        Exception.__init__(self, "\n".join(self.problems))


def parse_release(version):
    """'0.1.2' -> (0, 1, 2). None for anything that is not a plain release.

    Pre-releases ('0.1.3-pre.4') and dev builds ('0.1.3-dev.84', 'dev') are
    deliberately not releases: nothing may be pinned to them.
    """
    if not isinstance(version, str):
        return None
    m = RELEASE_RE.match(version)
    return tuple(int(g) for g in m.groups()) if m else None


def split_image(ref):
    """'repo:tag@sha256:...' -> (repo, tag, digest). Missing parts are ''."""
    if not isinstance(ref, str):
        return "", "", ""
    name, _, digest = ref.partition("@")
    repo, tag = name, ""
    # The last colon is a tag separator only when no '/' follows it;
    # otherwise it belongs to a registry port (localhost:5000/gateway).
    head, sep, tail = name.rpartition(":")
    if sep and "/" not in tail:
        repo, tag = head, tail
    return repo, tag, digest


def image_ref(repository, tag, digest):
    return "%s:%s@%s" % (repository, tag, digest)


def known_schemas(pins_path):
    """Config schemas the CI stack can render: one template per schema."""
    directory = os.path.dirname(os.path.abspath(pins_path))
    found = []
    for name in sorted(os.listdir(directory)):
        m = re.match(r"^gateway\.e2e\.(v\d+)\.toml\.tmpl$", name)
        if m:
            found.append(m.group(1))
    return found


def go_mod_sdk(go_mod_text):
    """The SDK version required by backend/go.mod, or None."""
    m = re.search(r"^\s*(?:require\s+)?%s\s+(\S+)" % re.escape(SDK_MODULE), go_mod_text, re.M)
    return m.group(1) if m else None


def _check_image(where, field, ref, version, problems):
    repo, tag, digest = split_image(ref)
    if not repo or not tag:
        problems.append("%s: %s must be repository:tag@sha256:<digest>, got %r" % (where, field, ref))
        return
    if not DIGEST_RE.match(digest):
        problems.append(
            "%s: %s is not pinned by digest (%r). Append @sha256:<digest>: a tag "
            "alone can be re-pushed, and then two CI runs test different gateways." % (where, field, ref)
        )
    if tag in MOVING_TAGS:
        problems.append(
            "%s: %s uses the moving tag %r. dev/HEAD builds are never pinned, with "
            "or without a digest - pin a release." % (where, field, tag)
        )
    elif version is not None and tag != version:
        problems.append(
            "%s: %s is tagged %r but the lane says version %r. The tag is what "
            "people read, so it must name the same release." % (where, field, tag, version)
        )


def validate(doc, schemas=None, go_mod_version=None):
    """Return every problem with a pins document as a list of sentences.

    An empty list means the file is well formed. Nothing is raised, so the
    caller sees all the problems at once instead of fixing them one CI run at
    a time.

    schemas: config schemas the stack has a template for (None skips the check).
    go_mod_version: the SDK version in backend/go.mod (None skips the check).
    """
    problems = []
    if not isinstance(doc, dict):
        return ["the pins file must be a JSON object"]

    # Other top-level keys are left alone, so another tool may keep its own
    # data here. Only a second copy of the range is refused: the moment it
    # exists, it can disagree with the lanes.
    for key in RANGE_KEYS:
        if key in doc:
            problems.append(
                "top-level key %r is not allowed: the supported range is derived "
                "from the required lanes, never written down a second time." % key
            )
    for key in REQUIRED_TOP_KEYS:
        if key not in doc:
            problems.append("missing top-level key %r" % key)

    sdk = doc.get("sdk")
    if "sdk" in doc:
        if not isinstance(sdk, str) or not (SDK_PSEUDO_RE.match(sdk) or SDK_TAGGED_RE.match(sdk)):
            problems.append(
                "sdk must be an exact module version such as "
                "v0.0.0-20260928030816-6648bd0c290e, got %r. '@latest' and branch "
                "names are queries, not pins." % (sdk,)
            )
        elif go_mod_version is not None and sdk != go_mod_version:
            problems.append(
                "sdk is %s but backend/go.mod requires %s. They are one pin "
                "recorded twice and must move in the same commit." % (sdk, go_mod_version)
            )

    if "sandbox_image" in doc:
        _, _, digest = split_image(doc.get("sandbox_image"))
        if not DIGEST_RE.match(digest):
            problems.append(
                "sandbox_image is not pinned by digest (%r). The workload image is "
                "held constant across lanes, which a moving tag cannot do." % (doc.get("sandbox_image"),)
            )

    lanes = doc.get("lanes")
    if "lanes" in doc and (not isinstance(lanes, list) or not lanes):
        problems.append("lanes must be a non-empty list")
        lanes = []
    seen_versions, seen_labels, any_required = set(), set(), False
    for index, lane in enumerate(lanes or []):
        if not isinstance(lane, dict):
            problems.append("lanes[%d] must be an object" % index)
            continue
        version = lane.get("version")
        where = "lane %s" % (version if isinstance(version, str) and version else "#%d" % index)

        missing = [k for k in LANE_KEYS if k not in lane]
        extra = sorted(set(lane) - set(LANE_KEYS))
        if missing:
            problems.append("%s: missing key(s) %s" % (where, ", ".join(missing)))
        if extra:
            problems.append(
                "%s: unknown key(s) %s. A lane has exactly: %s." % (where, ", ".join(extra), ", ".join(LANE_KEYS))
            )

        release = parse_release(version)
        if "version" in lane and release is None:
            looks_dev = isinstance(version, str) and ("dev" in version or version in MOVING_TAGS)
            if looks_dev:
                problems.append(
                    "%s: a dev lane is not allowed. A dev gateway resolves "
                    "ghcr.io/nvidia/openshell/sandbox:dev at runtime, so even a "
                    "digest-pinned dev lane drifts with upstream HEAD. Upstream HEAD is "
                    "the scheduled sweep's job (early warning only)." % where
                )
            else:
                problems.append(
                    "%s: version must be a release x.y.z, got %r. Pre-releases are not "
                    "releases and are never pinned." % (where, version)
                )
        elif release is not None:
            if version in seen_versions:
                problems.append("%s: version appears in more than one lane" % where)
            seen_versions.add(version)

        label = lane.get("label")
        if "label" in lane:
            if not isinstance(label, str) or not label.strip():
                problems.append("%s: label must be a non-empty string" % where)
            elif label in seen_labels:
                problems.append("%s: label %r is used twice; it names the CI job" % (where, label))
            else:
                seen_labels.add(label)

        if "required" in lane:
            if not isinstance(lane["required"], bool):
                problems.append("%s: required must be true or false" % where)
            elif lane["required"]:
                any_required = True

        if "config_schema" in lane:
            schema = lane["config_schema"]
            if not isinstance(schema, str) or not re.match(r"^v\d+$", schema):
                problems.append("%s: config_schema must look like v1 or v2, got %r" % (where, schema))
            elif schemas is not None and schema not in schemas:
                problems.append(
                    "%s: config_schema %r has no template (known: %s)"
                    % (where, schema, ", ".join(schemas) or "none")
                )

        for field in ("gateway_image", "supervisor_image"):
            if field in lane:
                _check_image(where, field, lane[field], version if release else None, problems)

    if lanes and not any_required:
        problems.append(
            "no lane has required=true. The supported range is the lowest and "
            "highest required lane, so without one this dashboard claims nothing."
        )
    return problems


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def dump(doc):
    """Serialise exactly as the checked-in file is written: the canonical form.

    Round-tripping an untouched document must reproduce it byte for byte, so
    an automated PR shows only the lines it meant to change. Non-ASCII text is
    written as itself, so a comment with a dash in it does not turn into an
    escape sequence the first time a PR rewrites the file.
    """
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def is_canonical(text):
    """Is this file text exactly what dump() would write for its content?

    The automated PRs rewrite the whole file. Only a file that is already in
    canonical form comes back with nothing but the intended lines changed, so
    CI requires it on every PR rather than discovering the difference inside
    a bump (`sweep.py format-pins` rewrites a file into this form).
    """
    try:
        return dump(json.loads(text)) == text
    except ValueError:
        return False


def required_lanes(doc):
    """Required lanes, oldest first."""
    lanes = [lane for lane in doc.get("lanes", []) if lane.get("required") is True]
    return sorted(lanes, key=lambda lane: parse_release(lane["version"]))


def supported_range(doc):
    """(floor, ceiling): the lowest and highest required lane versions."""
    lanes = required_lanes(doc)
    if not lanes:
        raise PinsError(["no lane has required=true, so there is no supported range"])
    return lanes[0]["version"], lanes[-1]["version"]


def move_ceiling(doc, version, gateway_image, supervisor_image, config_schema):
    """Return a copy with the ceiling lane moved to a newer release.

    Only the ceiling lane changes; the floor lane and every other field are
    left exactly as they were. When a single required lane is both floor and
    ceiling, moving it would silently raise the floor, so a new ceiling lane
    is added instead and the existing one stays as the floor.

    An advisory lane may already exist for the release (someone trying it out
    ahead of the sweep). It is promoted: the new required lane takes its
    place, with the images that were just tested. Leaving it beside the new
    lane would give the file two lanes for one version, which validate()
    refuses - and the bump would then fail on every run.
    """
    new_release = parse_release(version)
    if new_release is None:
        raise PinsError(["refusing to pin %r: only releases x.y.z are pinned, never dev/HEAD" % (version,)])
    for field, ref in (("gateway_image", gateway_image), ("supervisor_image", supervisor_image)):
        repo, tag, digest = split_image(ref)
        if not repo or tag != version or not DIGEST_RE.match(digest):
            raise PinsError(["refusing to pin %s=%r: expected %s@sha256:<digest>" % (field, ref, version)])

    if not isinstance(config_schema, str) or not re.match(r"^v\d+$", config_schema):
        raise PinsError(["refusing to pin config_schema=%r: the sweep did not report one" % (config_schema,)])

    floor, ceiling = supported_range(doc)
    if new_release <= parse_release(ceiling):
        raise PinsError(["%s is not newer than the current ceiling %s" % (version, ceiling)])

    out = copy.deepcopy(doc)
    lane = {
        "version": version,
        "label": CEILING_LABEL.format(version=version),
        "required": True,
        "config_schema": config_schema,
        "gateway_image": gateway_image,
        "supervisor_image": supervisor_image,
    }
    # Not required, or the range check above would have refused the move.
    out["lanes"] = [existing for existing in out["lanes"] if existing.get("version") != version]
    for index, existing in enumerate(out["lanes"]):
        if existing.get("required") is True and existing["version"] == ceiling:
            if floor == ceiling:
                existing["label"] = FLOOR_LABEL.format(version=floor)
                out["lanes"].insert(index, lane)
            else:
                out["lanes"][index] = lane
            break
    return out


def set_sdk(doc, version):
    """Return a copy with only the recorded SDK pin changed."""
    if not isinstance(version, str) or not (SDK_PSEUDO_RE.match(version) or SDK_TAGGED_RE.match(version)):
        raise PinsError(["refusing to record sdk=%r: not an exact module version" % (version,)])
    out = copy.deepcopy(doc)
    out["sdk"] = version
    return out
