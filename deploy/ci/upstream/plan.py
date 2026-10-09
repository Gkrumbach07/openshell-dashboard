"""What is upstream ahead of this branch, and what would moving to it pin?

One run of the workflow answers this once, in a job that can only read, and
every later job works from the answer: the `next` job pins exactly the image
digests check A tested, even if upstream re-pushes a tag in between.

Nothing here opens a socket. The network is the Upstream object passed in.
"""

import pins
import versions
from upstream import GATEWAY_REPOSITORY, REGISTRY, SUPERVISOR_REPOSITORY


class PlanError(Exception):
    """The plan cannot be made from what was found."""


def _images(upstream, version):
    """(gateway ref, supervisor ref, what is missing)."""
    refs = []
    for name, repository in (("gateway", GATEWAY_REPOSITORY), ("supervisor", SUPERVISOR_REPOSITORY)):
        digest = upstream.image_digest(repository, version)
        if digest is None:
            return None, None, "upstream has tagged v%s but has not published its %s image yet" % (version, name)
        refs.append(pins.image_ref("%s/%s" % (REGISTRY, repository), version, digest))
    return refs[0], refs[1], None


def _pin_on_tag(doc, tags):
    """Is the pinned SDK the commit the pinned release's tag points at?

    None when it cannot be told: upstream deletes a train's pre-release tags
    once it goes stable, and a tagged (non-pseudo) SDK version names no commit.
    """
    tagged = tags.get("v" + doc["release"])
    commit = pins.sdk_commit(doc["sdk"])
    if not tagged or not commit:
        return None
    return tagged.startswith(commit)


def build(doc, upstream):
    """Everything one run needs to know, as plain data.

    doc: the pins of the branch the workflow runs on, which is `main` for
    every run that acts.
    """
    problems = pins.validate(doc)
    if problems:
        raise pins.PinsError(problems)
    tags = versions.parse_tags(upstream.release_tags())
    found = versions.releases(tags)
    if not found:
        raise PlanError(
            "upstream lists no release tags (vX.Y.Z or vX.Y.Z-pre.N). That is an outage or a "
            "changed tag scheme, not 'nothing new'; refusing to conclude anything from it."
        )

    pinned = doc["release"]
    plan = {
        "pinned": {
            "release": pinned,
            "line": versions.line(pinned),
            "stable": versions.is_stable(pinned),
            "sdk": doc["sdk"],
            "sdk_on_tag": _pin_on_tag(doc, tags),
        },
        "config_schema": doc["config_schema"],
        "sandbox_image": doc["sandbox_image"],
        "newest_stable": next((release["version"] for release in found if release["stable"]), None),
        "target": None,
    }

    target = versions.select_target(pinned, found)
    if target is None:
        return plan

    gateway, supervisor, waiting_for = _images(upstream, target["version"])
    new_line = versions.line(target["version"]) != versions.line(pinned)
    plan["target"] = {
        "version": target["version"],
        "tag": target["tag"],
        "commit": target["commit"],
        "stable": target["stable"],
        "base": versions.base(target["version"]),
        "line": versions.line(target["version"]),
        "same_line": not new_line,
        # Stable releases between the pin and the target. They are skipped:
        # the branch goes straight to the newest.
        "skipped": sorted(
            (
                release["version"]
                for release in found
                if release["stable"]
                and target["stable"]
                and versions.order(pinned) < versions.order(release["version"]) < versions.order(target["version"])
            ),
            key=versions.order,
        ),
        # The branch that keeps the line `main` is about to leave. It is made
        # when the move is to a stable release, which is the first moment the
        # pull request could merge.
        "release_branch": "release/%s" % versions.line(pinned) if new_line and target["stable"] else None,
        "gateway_image": gateway,
        "supervisor_image": supervisor,
        "ready": waiting_for is None,
        "waiting_for": waiting_for,
    }
    return plan
