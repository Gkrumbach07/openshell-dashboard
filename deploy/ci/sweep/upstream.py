"""Everything the sweep learns from the network, behind one small object.

The decision logic never talks to git, a registry or the Go module proxy
directly: it is handed an Upstream. Tests hand it a fake built from fixtures,
which is what lets every decision be exercised without a network and without a
container.

A lookup that fails for a reason other than "that does not exist" raises. An
outage must stop the sweep, not be mistaken for "nothing newer was released".
"""

import json
import subprocess
import urllib.error
import urllib.request

UPSTREAM_REPO = "https://github.com/NVIDIA/OpenShell.git"
SDK_MODULE = "github.com/NVIDIA/OpenShell/sdk/go"
REGISTRY = "ghcr.io"
GATEWAY_REPOSITORY = "nvidia/openshell/gateway"
SUPERVISOR_REPOSITORY = "nvidia/openshell/supervisor"

# Multi-arch images are published as an index; ask for it first so the digest
# returned is the one `docker pull repo@sha256:...` resolves on any runner.
MANIFEST_TYPES = ", ".join(
    (
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    )
)


class UpstreamError(Exception):
    """A lookup failed for a reason other than 'that does not exist'."""


class Upstream(object):
    """The real network. Each method is one question with one answer."""

    def __init__(self, backend_dir="backend", timeout=30):
        self.backend_dir = backend_dir
        self.timeout = timeout
        self._tokens = {}

    def release_tags(self):
        """Raw `git ls-remote --tags` output for the upstream repository.

        Deliberately without --refs: an annotated tag is listed twice, and only
        the peeled `^{}` line names the commit. `go get` needs the commit.
        """
        try:
            return subprocess.check_output(
                ["git", "ls-remote", "--tags", UPSTREAM_REPO], universal_newlines=True, timeout=self.timeout * 4
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as err:
            raise UpstreamError("git ls-remote %s failed: %s" % (UPSTREAM_REPO, err))

    def _token(self, repository):
        if repository not in self._tokens:
            url = "https://%s/token?scope=repository:%s:pull&service=%s" % (REGISTRY, repository, REGISTRY)
            try:
                with urllib.request.urlopen(url, timeout=self.timeout) as response:
                    self._tokens[repository] = json.load(response)["token"]
            except (urllib.error.URLError, ValueError, KeyError, OSError) as err:
                raise UpstreamError("could not get a pull token for %s/%s: %s" % (REGISTRY, repository, err))
        return self._tokens[repository]

    def image_digest(self, repository, tag):
        """'sha256:...' for repository:tag on ghcr.io, or None when the tag is not published."""
        request = urllib.request.Request(
            "https://%s/v2/%s/manifests/%s" % (REGISTRY, repository, tag),
            method="HEAD",
            headers={"Authorization": "Bearer " + self._token(repository), "Accept": MANIFEST_TYPES},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                digest = response.headers.get("Docker-Content-Digest")
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return None
            raise UpstreamError("%s/%s:%s: registry answered HTTP %s" % (REGISTRY, repository, tag, err.code))
        except (urllib.error.URLError, OSError) as err:
            raise UpstreamError("%s/%s:%s: %s" % (REGISTRY, repository, tag, err))
        if not digest:
            raise UpstreamError("%s/%s:%s: registry returned no Docker-Content-Digest" % (REGISTRY, repository, tag))
        return digest

    def sdk_version(self, query):
        """The exact module version a query resolves to.

        `query` is a commit hash or "latest". Go answers with the version it
        would write into go.mod, which for this module is a pseudo-version: the
        SDK is a subdirectory of the upstream repository and carries no tags of
        its own. Resolving once, up front, means every leg of a sweep tests the
        same SDK even if HEAD moves while it runs.
        """
        # stderr is kept apart: Go reports downloads there, and they must not
        # end up inside the JSON.
        try:
            done = subprocess.run(
                ["go", "list", "-m", "-json", "%s@%s" % (SDK_MODULE, query)],
                cwd=self.backend_dir,
                universal_newlines=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=self.timeout * 4,
            )
        except (subprocess.TimeoutExpired, OSError) as err:
            raise UpstreamError("go list %s@%s failed: %s" % (SDK_MODULE, query, err))
        if done.returncode != 0:
            raise UpstreamError("go list %s@%s failed: %s" % (SDK_MODULE, query, done.stderr.strip()))
        try:
            return json.loads(done.stdout)["Version"]
        except (ValueError, KeyError) as err:
            raise UpstreamError("go list %s@%s: unexpected output (%s)" % (SDK_MODULE, query, err))
