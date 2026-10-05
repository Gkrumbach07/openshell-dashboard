"""The real Upstream object, with the socket and the subprocess replaced.

Everything else in this directory uses a fake Upstream. These tests cover the
one thing a fake cannot: that the real one tells "does not exist" (a normal
answer) from "could not ask" (an error that must stop the sweep).
"""

import email.message
import io
import json
import subprocess
import unittest
import urllib.error
from unittest import mock

import upstream

DIGEST = "sha256:" + "ab" * 32


class FakeResponse(io.BytesIO):
    def __init__(self, body=b"", headers=None):
        io.BytesIO.__init__(self, body)
        self.headers = email.message.Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def registry(manifest):
    """A urlopen that hands out a token, then answers the manifest request with `manifest`."""

    def urlopen(request, timeout=None):
        url = request if isinstance(request, str) else request.full_url
        if "/token?" in url:
            return FakeResponse(json.dumps({"token": "t0ken"}).encode())
        if isinstance(manifest, Exception):
            raise manifest
        return manifest

    return urlopen


def http_error(code):
    return urllib.error.HTTPError("https://ghcr.io/v2/x/manifests/y", code, "nope", email.message.Message(), None)


class ImageDigest(unittest.TestCase):
    def lookup(self, manifest):
        with mock.patch("urllib.request.urlopen", registry(manifest)):
            return upstream.Upstream().image_digest(upstream.GATEWAY_REPOSITORY, "0.1.3")

    def test_returns_the_digest_header(self):
        self.assertEqual(self.lookup(FakeResponse(headers={"Docker-Content-Digest": DIGEST})), DIGEST)

    def test_a_missing_tag_is_none(self):
        self.assertIsNone(self.lookup(http_error(404)))

    def test_any_other_http_status_is_an_error(self):
        for code in (401, 403, 429, 500, 503):
            with self.assertRaises(upstream.UpstreamError):
                self.lookup(http_error(code))

    def test_a_network_failure_is_an_error_not_a_missing_tag(self):
        with self.assertRaises(upstream.UpstreamError):
            self.lookup(urllib.error.URLError("temporary failure in name resolution"))

    def test_a_response_without_a_digest_is_an_error(self):
        with self.assertRaises(upstream.UpstreamError):
            self.lookup(FakeResponse())

    def test_asks_for_the_multi_arch_index_with_a_head_request(self):
        seen = []

        def urlopen(request, timeout=None):
            if isinstance(request, str):
                return FakeResponse(json.dumps({"token": "t0ken"}).encode())
            seen.append(request)
            return FakeResponse(headers={"Docker-Content-Digest": DIGEST})

        with mock.patch("urllib.request.urlopen", urlopen):
            upstream.Upstream().image_digest(upstream.SUPERVISOR_REPOSITORY, "0.1.3")
        request = seen[0]
        self.assertEqual(request.get_method(), "HEAD")
        self.assertEqual(request.full_url, "https://ghcr.io/v2/nvidia/openshell/supervisor/manifests/0.1.3")
        self.assertEqual(request.get_header("Authorization"), "Bearer t0ken")
        self.assertIn("application/vnd.oci.image.index.v1+json", request.get_header("Accept"))

    def test_a_token_failure_is_an_error(self):
        def urlopen(request, timeout=None):
            raise urllib.error.URLError("connection refused")

        with mock.patch("urllib.request.urlopen", urlopen):
            with self.assertRaises(upstream.UpstreamError):
                upstream.Upstream().image_digest(upstream.GATEWAY_REPOSITORY, "0.1.3")


class SdkVersion(unittest.TestCase):
    def resolve(self, returncode, stdout="", stderr=""):
        done = subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)
        with mock.patch("subprocess.run", return_value=done) as run:
            version = upstream.Upstream(backend_dir="backend").sdk_version("latest")
        return version, run

    def test_returns_the_version_go_resolved(self):
        out = json.dumps({"Path": upstream.SDK_MODULE, "Version": "v0.0.0-20261005153840-8b3cc3fdc067"})
        version, run = self.resolve(0, stdout=out, stderr="go: downloading something\n")
        self.assertEqual(version, "v0.0.0-20261005153840-8b3cc3fdc067")
        command = run.call_args[0][0]
        self.assertEqual(command, ["go", "list", "-m", "-json", upstream.SDK_MODULE + "@latest"])
        self.assertEqual(run.call_args[1]["cwd"], "backend")

    def test_a_failing_go_command_is_an_error(self):
        with self.assertRaises(upstream.UpstreamError) as caught:
            self.resolve(1, stderr="go: module lookup disabled by GOPROXY=off")
        self.assertIn("GOPROXY=off", str(caught.exception))

    def test_unexpected_output_is_an_error(self):
        with self.assertRaises(upstream.UpstreamError):
            self.resolve(0, stdout="not json")

    def test_a_missing_go_binary_is_an_error(self):
        with mock.patch("subprocess.run", side_effect=OSError("go: not found")):
            with self.assertRaises(upstream.UpstreamError):
                upstream.Upstream().sdk_version("latest")


class ReleaseTags(unittest.TestCase):
    def test_lists_tags_with_their_peeled_commits(self):
        with mock.patch("subprocess.check_output", return_value="abc\trefs/tags/v0.1.2\n") as run:
            text = upstream.Upstream().release_tags()
        self.assertEqual(text, "abc\trefs/tags/v0.1.2\n")
        command = run.call_args[0][0]
        self.assertEqual(command, ["git", "ls-remote", "--tags", upstream.UPSTREAM_REPO])
        # --refs would hide the ^{} lines, which are the only ones naming a commit.
        self.assertNotIn("--refs", command)

    def test_a_failing_git_is_an_error_not_an_empty_tag_list(self):
        failure = subprocess.CalledProcessError(128, ["git"], "fatal: unable to access")
        with mock.patch("subprocess.check_output", side_effect=failure):
            with self.assertRaises(upstream.UpstreamError):
                upstream.Upstream().release_tags()


if __name__ == "__main__":
    unittest.main()
