"""Candidate discovery: what should this sweep test?

The sweep walks two independent axes (ADR 0006), and each axis holds the other
side still:

  gateway axis  the SDK stays at the pin in backend/go.mod; only the gateway
                image varies. Answers "which gateways does the code we ship
                today work with?"
  sdk axis      the gateways stay at the required lanes; only the SDK varies.
                Answers "can we move to a newer SDK without losing a gateway
                we support?"

Moving both at once is what turned one SDK compile error into "3 releases need
migration" (#75): nothing in that result said which link had failed.

Nothing here opens a socket. The network is the Upstream object passed in.
"""

import re

import pins
from upstream import GATEWAY_REPOSITORY, REGISTRY, SUPERVISOR_REPOSITORY

TAG_LINE_RE = re.compile(r"^([0-9a-f]{40})\s+refs/tags/(\S+?)(\^\{\})?$")
RELEASE_TAG_RE = re.compile(r"^v?(\d+\.\d+\.\d+)$")
PSEUDO_COMMIT_RE = re.compile(r"[-.]\d{14}-([0-9a-f]{12})$")
SEMVER_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$")


class PlanError(Exception):
    """The sweep was asked for something it must not do."""


def parse_tags(ls_remote_text):
    """`git ls-remote --tags` output -> {tag name: commit}.

    An annotated tag is listed twice: once as the tag object and once, with a
    `^{}` suffix, as the commit it points at. Only the commit is usable with
    `go get`, so the peeled line wins whenever there is one.
    """
    commits, peeled = {}, {}
    for line in ls_remote_text.splitlines():
        m = TAG_LINE_RE.match(line.strip())
        if not m:
            continue
        sha, name, is_peeled = m.groups()
        (peeled if is_peeled else commits)[name] = sha
    commits.update(peeled)
    return commits


def releases(tags):
    """Upstream releases, newest first.

    A release is a tag that is exactly vX.Y.Z. Pre-release tags such as
    v0.1.3-pre.4 exist upstream and are not releases; nothing is ever pinned to
    one, so they are not candidates on either axis.
    """
    out = []
    for name, commit in tags.items():
        m = RELEASE_TAG_RE.match(name)
        if m:
            version = m.group(1)
            out.append({"version": version, "tag": name, "commit": commit})
    out.sort(key=lambda r: pins.parse_release(r["version"]), reverse=True)
    return out


def sdk_order(version):
    """Sort key giving Go's ordering of module versions (semver precedence).

    A pseudo-version is a pre-release of its base version whose single
    identifier starts with a fixed-width UTC timestamp, so comparing those
    identifiers as text orders two pseudo-versions by commit time.
    """
    m = SEMVER_RE.match(version or "")
    if not m:
        raise PlanError("%r is not a module version" % (version,))
    major, minor, patch, pre = m.groups()
    identifiers = []
    for part in (pre or "").split("."):
        if part:
            identifiers.append((0, int(part), "") if part.isdigit() else (1, 0, part))
    # A version without a pre-release part sorts after every pre-release of it.
    return (int(major), int(minor), int(patch), 0 if pre else 1, identifiers)


def sdk_commit(version):
    """The 12-character commit prefix inside a pseudo-version, or None."""
    m = PSEUDO_COMMIT_RE.search(version or "")
    return m.group(1) if m else None


def sdk_tag(version, tags):
    """The upstream tag whose commit a pinned SDK version sits on, or None.

    A release tag is preferred when several tags share the commit, so a pin on
    a release reads as that release.
    """
    commit = sdk_commit(version)
    if not commit:
        return None
    matching = sorted(name for name, sha in tags.items() if sha.startswith(commit))
    for name in matching:
        if RELEASE_TAG_RE.match(name):
            return name
    return matching[0] if matching else None


def _position(release, floor, ceiling):
    if release > ceiling:
        return "above"
    if release < floor:
        return "below"
    return "in_range"


def _images(upstream, tag):
    """(gateway ref, supervisor ref, reason-it-was-skipped)."""
    refs = []
    for name, repository in (("gateway", GATEWAY_REPOSITORY), ("supervisor", SUPERVISOR_REPOSITORY)):
        digest = upstream.image_digest(repository, tag)
        if digest is None:
            return None, None, "no published %s image" % name
        refs.append(pins.image_ref("%s/%s" % (REGISTRY, repository), tag, digest))
    return refs[0], refs[1], None


def gateway_candidates(
    all_releases, floor, ceiling, upstream, max_versions=5, include_head=True, since=None, pinned=None
):
    """Gateways to test against the code we ship today.

    Every release at or above the floor that has published images, newest
    first, capped at max_versions. Each candidate carries tag@digest references
    resolved now, so the leg tests - and a later PR pins - exactly the image
    that was looked up.

    `pinned` maps a lane's version to the (gateway, supervisor) references it
    pins. A release whose tag no longer resolves to those digests was
    re-pushed upstream; the candidate is marked so the report can say that CI,
    which pulls the pinned digest, and the sweep tested different images.

    `since` lowers the starting point below the floor for a one-off question
    such as "does main work with 0.0.116?". Rows below the floor are
    informational and can never produce a PR.

    Upstream HEAD (`dev`) is appended as early warning when include_head is
    set. It is marked kind=dev and is never a bump target.
    """
    floor_t, ceiling_t = pins.parse_release(floor), pins.parse_release(ceiling)
    lower = floor_t
    if since:
        since_t = pins.parse_release(since.lstrip("v"))
        if since_t is None:
            raise PlanError("since=%r is not a release x.y.z" % (since,))
        if since_t > floor_t:
            raise PlanError(
                "since=%s is above the floor (%s). The sweep always covers the whole "
                "supported range; since can only extend it downwards." % (since, floor)
            )
        lower = since_t

    candidates, skipped, not_swept = [], [], []
    for release in all_releases:
        release_t = pins.parse_release(release["version"])
        if release_t < lower:
            continue
        if len(candidates) >= max_versions:
            not_swept.append(release["version"])
            continue
        gateway, supervisor, reason = _images(upstream, release["version"])
        if reason:
            skipped.append({"version": release["version"], "reason": reason})
            continue
        lane = None
        if release_t == floor_t and release_t == ceiling_t:
            lane = "floor and ceiling"
        elif release_t == floor_t:
            lane = "floor"
        elif release_t == ceiling_t:
            lane = "ceiling"
        candidates.append(
            {
                "id": "gateway-" + release["version"],
                "version": release["version"],
                "kind": "release",
                "position": _position(release_t, floor_t, ceiling_t),
                "lane": lane,
                "repushed": (pinned or {}).get(release["version"], (gateway, supervisor)) != (gateway, supervisor),
                "gateway_image": gateway,
                "supervisor_image": supervisor,
            }
        )

    if include_head:
        gateway, supervisor, reason = _images(upstream, "dev")
        if reason:
            skipped.append({"version": "dev", "reason": reason})
        else:
            candidates.append(
                {
                    "id": "gateway-dev",
                    "version": "dev",
                    "kind": "dev",
                    "position": "head",
                    "lane": None,
                    "repushed": False,
                    "gateway_image": gateway,
                    "supervisor_image": supervisor,
                }
            )
    return {"candidates": candidates, "skipped": skipped, "not_swept": not_swept}


def sdk_candidates(all_releases, pin, upstream, include_head=True):
    """SDK versions worth trying against the gateways we already support.

    Exactly one of them can ever become the pin: the SDK at the commit of the
    newest upstream release tag, and only when that is newer than the current
    pin. The SDK at upstream HEAD (`@latest`) is added as early warning; it is
    marked kind=latest and is never a bump target.

    Queries are resolved to exact versions here, once, so every leg tests the
    same SDK even if HEAD moves while the sweep runs.
    """
    candidates = []
    pin_key = sdk_order(pin)
    if all_releases:
        newest = all_releases[0]
        # Same commit as the pin: nothing to resolve and nothing to test.
        if not newest["commit"].startswith(sdk_commit(pin) or "\0"):
            version = upstream.sdk_version(newest["commit"])
            if sdk_order(version) > pin_key:
                candidates.append(
                    {
                        "id": "sdk-release",
                        "kind": "release",
                        "label": newest["tag"],
                        "tag": newest["tag"],
                        "commit": newest["commit"],
                        "version": version,
                    }
                )
    if include_head:
        version = upstream.sdk_version("latest")
        already = [c["version"] for c in candidates]
        if sdk_order(version) > pin_key and version not in already:
            candidates.append(
                {
                    "id": "sdk-latest",
                    "kind": "latest",
                    "label": "latest",
                    "tag": None,
                    "commit": None,
                    "version": version,
                }
            )
    return candidates


def build_plan(doc, upstream, max_versions=5, include_head=True, since=None):
    """Everything one sweep run will test, as plain data."""
    problems = pins.validate(doc)
    if problems:
        raise pins.PinsError(problems)
    floor, ceiling = pins.supported_range(doc)
    tags = parse_tags(upstream.release_tags())
    all_releases = releases(tags)
    if not all_releases:
        raise PlanError("upstream lists no release tags; refusing to plan a sweep from nothing")

    lanes = [
        {key: lane[key] for key in ("version", "label", "config_schema", "gateway_image", "supervisor_image")}
        for lane in pins.required_lanes(doc)
    ]
    pinned = {lane["version"]: (lane["gateway_image"], lane["supervisor_image"]) for lane in doc["lanes"]}
    gateway = gateway_candidates(all_releases, floor, ceiling, upstream, max_versions, include_head, since, pinned)
    sdks = sdk_candidates(all_releases, doc["sdk"], upstream, include_head)
    legs = []
    for sdk in sdks:
        for lane in lanes:
            legs.append(
                {
                    "id": "%s-%s" % (sdk["id"], lane["version"]),
                    "sdk_id": sdk["id"],
                    "sdk_label": sdk["label"],
                    "sdk_version": sdk["version"],
                    "lane": lane["version"],
                    "config_schema": lane["config_schema"],
                    "gateway_image": lane["gateway_image"],
                    "supervisor_image": lane["supervisor_image"],
                }
            )
    return {
        "inputs": {"max_versions": max_versions, "include_head": bool(include_head), "since": since or None},
        "range": {"floor": floor, "ceiling": ceiling},
        "sdk_pin": doc["sdk"],
        "sdk_pin_tag": sdk_tag(doc["sdk"], tags),
        "newest_release": all_releases[0]["version"],
        "sandbox_image": doc["sandbox_image"],
        "lanes": lanes,
        "gateway": gateway,
        "sdk": {"candidates": sdks, "legs": legs},
    }
