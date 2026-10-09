"""Upstream's release tags: which are releases, how they order, which to follow.

OpenShell tags a stable release `vX.Y.Z` and a pre-release of it
`vX.Y.Z-pre.N`. Those two shapes are the only tags this repository follows.
Every other tag upstream has (`dev`, `vm-runtime`, anything it adds later) is
ignored, not guessed at.

A version is written here the way the images are tagged, without the `v`:
`0.1.4`, `0.1.4-pre.2`.

Nothing in this file opens a socket.
"""

import re

TAG_LINE_RE = re.compile(r"^([0-9a-f]{40})\s+refs/tags/(\S+?)(\^\{\})?$")
VERSION_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-pre\.(0|[1-9]\d*))?$")


class VersionError(Exception):
    """Something that had to be a release version is not one."""


def parse(version):
    """'0.1.4' -> (0, 1, 4, None); '0.1.4-pre.2' -> (0, 1, 4, 2); anything else -> None."""
    if not isinstance(version, str):
        return None
    m = VERSION_RE.match(version)
    if not m:
        return None
    major, minor, patch, pre = m.groups()
    return int(major), int(minor), int(patch), (None if pre is None else int(pre))


def _parsed(version):
    parts = parse(version)
    if parts is None:
        raise VersionError(
            "%r is not an OpenShell release: expected X.Y.Z, or X.Y.Z-pre.N for a pre-release" % (version,)
        )
    return parts


def is_stable(version):
    """True for X.Y.Z, False for X.Y.Z-pre.N. Raises for anything else."""
    return _parsed(version)[3] is None


def order(version):
    """Sort key: semver precedence. A pre-release sorts before its stable release."""
    major, minor, patch, pre = _parsed(version)
    return (major, minor, patch, 1 if pre is None else 0, pre or 0)


def base(version):
    """'0.1.4-pre.2' -> '0.1.4': the stable release a pre-release leads up to."""
    return "%d.%d.%d" % _parsed(version)[:3]


def line(version):
    """'0.1.4-pre.2' -> '0.1': the minor release line a release belongs to."""
    return "%d.%d" % _parsed(version)[:2]


def parse_tags(ls_remote_text):
    """`git ls-remote --tags` output -> {tag name: commit}.

    An annotated tag is listed twice: once as the tag object and once, with a
    `^{}` suffix, as the commit it points at. Only the commit is usable with
    `go get`, so the peeled line wins whenever there is one.
    """
    commits, peeled = {}, {}
    for text in ls_remote_text.splitlines():
        m = TAG_LINE_RE.match(text.strip())
        if not m:
            continue
        sha, name, is_peeled = m.groups()
        (peeled if is_peeled else commits)[name] = sha
    commits.update(peeled)
    return commits


def releases(tags):
    """Upstream's stable releases and pre-releases, newest first.

    Only tags that are exactly `v` plus a version count. `0.1.4` without the
    `v`, `dev`, `vm-runtime` and `v0.1.4-rc1` are all something else.
    """
    found = []
    for name, commit in tags.items():
        if not name.startswith("v") or parse(name[1:]) is None:
            continue
        version = name[1:]
        found.append({"version": version, "tag": name, "commit": commit, "stable": is_stable(version)})
    found.sort(key=lambda release: order(release["version"]), reverse=True)
    return found


def select_target(pinned, found):
    """The upstream release `main` should move to next, or None.

    pinned: the release `main` pins. found: releases(), in any order.

    A stable release above the pin is always the target, and when several are
    waiting it is the newest: the ones in between are skipped, not walked
    through. Only when there is none does a pre-release count, and then only
    one that leads up to a release above the pin. `0.1.3-pre.8` says nothing
    to a branch that is already on `0.1.3`.
    """
    pin = order(pinned)
    stable = [release for release in found if release["stable"] and order(release["version"]) > pin]
    if stable:
        return max(stable, key=lambda release: order(release["version"]))
    ahead = [
        release
        for release in found
        # The second test only matters for a pin that is itself a pre-release:
        # the pin is never its own target.
        if not release["stable"] and order(base(release["version"])) > pin and order(release["version"]) > pin
    ]
    if ahead:
        return max(ahead, key=lambda release: order(release["version"]))
    return None
