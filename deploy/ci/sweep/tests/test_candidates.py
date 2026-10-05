"""Candidate discovery on both axes, against a fake upstream."""

import unittest

import candidates
import pins
import upstream
from tests import support

PIN = "v0.0.0-20260928030816-6648bd0c290e"
C13 = "a0130000a0130000a0130000a0130000a0130000"
SDK13 = "v0.0.0-20261012090000-a0130000a013"
HEAD = "v0.0.0-20261020153840-8b3cc3fdc067"
RELEASE_0_1_3 = {
    "tags": [C13 + "\trefs/tags/v0.1.3"],
    "images": {"gateway:0.1.3": "sha256:" + "13" * 32, "supervisor:0.1.3": "sha256:" + "31" * 32},
    "sdk": {C13: SDK13, "latest": SDK13},
}


def plan(patch=None, pins_file="pins.json", **inputs):
    fake = support.FakeUpstream(support.upstream_data(patch))
    return candidates.build_plan(support.fixture(pins_file), fake, **inputs), fake


def versions(the_plan):
    return [c["version"] for c in the_plan["gateway"]["candidates"]]


class Tags(unittest.TestCase):
    def setUp(self):
        self.tags = candidates.parse_tags("\n".join(support.fixture("upstream.json")["tags"]))

    def test_an_annotated_tag_resolves_to_its_commit_not_the_tag_object(self):
        # `dev` and `v0.1.0-pre.1` are annotated upstream: the first line is
        # the tag object, the `^{}` line is the commit `go get` needs.
        self.assertEqual(self.tags["dev"], "e7fdd6beef98f7f92d86271a169fdd4d3be44cf3")
        self.assertEqual(self.tags["v0.1.0-pre.1"], "f54a7a617760295cc101d6ec7f31df1dba50fc23")
        self.assertNotIn("dev^{}", self.tags)

    def test_a_lightweight_tag_is_its_commit(self):
        self.assertEqual(self.tags["v0.1.2"], "6648bd0c290efbc41ba131ee9831ee45cd431f94")

    def test_releases_are_exact_versions_newest_first(self):
        found = [r["version"] for r in candidates.releases(self.tags)]
        self.assertEqual(found, ["0.1.2", "0.1.1", "0.1.0", "0.0.116", "0.0.115"])

    def test_pre_releases_and_other_tags_are_not_releases(self):
        found = [r["tag"] for r in candidates.releases(self.tags)]
        for tag in ("v0.1.3-pre.4", "v0.1.0-pre.8", "dev", "vm-runtime"):
            self.assertNotIn(tag, found)

    def test_releases_sort_as_numbers(self):
        tags = {"v0.1.9": "a" * 40, "v0.1.10": "b" * 40, "v0.2.0": "c" * 40}
        self.assertEqual([r["version"] for r in candidates.releases(tags)], ["0.2.0", "0.1.10", "0.1.9"])

    def test_noise_is_ignored(self):
        self.assertEqual(candidates.parse_tags("warning: redirecting\n\nnot a ref line\n"), {})


class SdkVersions(unittest.TestCase):
    def test_pseudo_versions_order_by_commit_time(self):
        older = "v0.0.0-20260923091534-d3480d2a7efa"
        self.assertLess(candidates.sdk_order(older), candidates.sdk_order(PIN))
        self.assertLess(candidates.sdk_order(PIN), candidates.sdk_order(HEAD))

    def test_a_tagged_release_sorts_after_any_pseudo_version(self):
        self.assertLess(candidates.sdk_order(HEAD), candidates.sdk_order("v0.1.2"))
        self.assertLess(candidates.sdk_order("v0.1.2"), candidates.sdk_order("v0.1.10"))

    def test_commit_prefix(self):
        self.assertEqual(candidates.sdk_commit(PIN), "6648bd0c290e")
        self.assertEqual(candidates.sdk_commit("v0.1.3-0.20260928030816-6648bd0c290e"), "6648bd0c290e")
        self.assertIsNone(candidates.sdk_commit("v0.1.2"))

    def test_a_query_is_not_a_version(self):
        with self.assertRaises(candidates.PlanError):
            candidates.sdk_order("latest")

    def test_the_pin_is_named_after_its_release_tag(self):
        tags = candidates.parse_tags("\n".join(support.fixture("upstream.json")["tags"]))
        self.assertEqual(candidates.sdk_tags(PIN, tags), ("v0.1.2", None))
        self.assertEqual(candidates.sdk_tags(HEAD, tags), (None, None))

    def test_a_pre_release_tag_is_never_reported_as_the_release_the_pin_is_on(self):
        # main sat on v0.1.0-pre.8 for a week. That must read as "not on a
        # release", with the tag kept only to say where the pin actually is.
        tags = candidates.parse_tags("\n".join(support.fixture("upstream.json")["tags"]))
        self.assertEqual(
            candidates.sdk_tags("v0.0.0-20260923091534-d3480d2a7efa", tags), (None, "v0.1.0-pre.8")
        )
        # v0.1.3-pre.4 and `dev` name the same commit; neither is a release.
        release, other = candidates.sdk_tags("v0.0.0-20261001000000-e7fdd6beef98", tags)
        self.assertIsNone(release)
        self.assertIn(other, ("dev", "v0.1.3-pre.4"))


class GatewayAxis(unittest.TestCase):
    def test_nothing_newer_released(self):
        the_plan, _ = plan()
        self.assertEqual(versions(the_plan), ["0.1.2", "0.1.1", "0.1.0", "dev"])
        self.assertEqual(the_plan["range"], {"floor": "0.1.0", "ceiling": "0.1.2"})
        positions = {c["version"]: (c["position"], c["lane"]) for c in the_plan["gateway"]["candidates"]}
        self.assertEqual(
            positions,
            {
                "0.1.2": ("in_range", "ceiling"),
                "0.1.1": ("in_range", None),
                "0.1.0": ("in_range", "floor"),
                "dev": ("head", None),
            },
        )

    def test_nothing_below_the_floor_is_swept_by_default(self):
        the_plan, fake = plan()
        self.assertNotIn("0.0.116", versions(the_plan))
        self.assertNotIn("gateway:0.0.116", fake.digest_lookups)

    def test_a_newer_release_is_above_the_range_and_listed_first(self):
        the_plan, _ = plan(RELEASE_0_1_3)
        self.assertEqual(versions(the_plan), ["0.1.3", "0.1.2", "0.1.1", "0.1.0", "dev"])
        self.assertEqual(the_plan["gateway"]["candidates"][0]["position"], "above")

    def test_candidates_carry_the_digest_they_will_be_tested_and_pinned_at(self):
        the_plan, _ = plan(RELEASE_0_1_3)
        newest = the_plan["gateway"]["candidates"][0]
        self.assertEqual(newest["gateway_image"], "ghcr.io/nvidia/openshell/gateway:0.1.3@sha256:" + "13" * 32)
        self.assertEqual(newest["supervisor_image"], "ghcr.io/nvidia/openshell/supervisor:0.1.3@sha256:" + "31" * 32)
        # The lookup agrees with what is checked in for the existing lanes.
        doc = support.fixture("pins.json")
        by_version = {c["version"]: c for c in the_plan["gateway"]["candidates"]}
        for lane in doc["lanes"]:
            self.assertEqual(by_version[lane["version"]]["gateway_image"], lane["gateway_image"])
            self.assertEqual(by_version[lane["version"]]["supervisor_image"], lane["supervisor_image"])

    def test_a_repushed_release_tag_is_noticed(self):
        # The tag 0.1.2 now resolves to a digest other than the one the lane pins.
        the_plan, _ = plan({"images": {"gateway:0.1.2": "sha256:" + "ff" * 32}})
        flags = {c["version"]: c["repushed"] for c in the_plan["gateway"]["candidates"]}
        self.assertEqual(flags, {"0.1.2": True, "0.1.1": False, "0.1.0": False, "dev": False})
        # The sweep tests what the tag resolves to today; the SDK legs keep the pinned lane.
        swept = the_plan["gateway"]["candidates"][0]["gateway_image"]
        pinned = [leg for leg in support.fixture("pins.json")["lanes"] if leg["version"] == "0.1.2"][0]["gateway_image"]
        self.assertTrue(swept.endswith("ff" * 32))
        self.assertNotEqual(swept, pinned)

    def test_a_tag_without_a_published_image_is_skipped_not_swept(self):
        the_plan, _ = plan({"tags": RELEASE_0_1_3["tags"], "sdk": RELEASE_0_1_3["sdk"]})
        self.assertNotIn("0.1.3", versions(the_plan))
        self.assertEqual(the_plan["gateway"]["skipped"], [{"version": "0.1.3", "reason": "no published gateway image"}])

    def test_a_gateway_without_its_supervisor_is_skipped(self):
        patch = {"tags": RELEASE_0_1_3["tags"], "images": {"gateway:0.1.3": "sha256:" + "13" * 32}, "sdk": RELEASE_0_1_3["sdk"]}
        the_plan, _ = plan(patch)
        self.assertEqual(the_plan["gateway"]["skipped"], [{"version": "0.1.3", "reason": "no published supervisor image"}])

    def test_a_registry_outage_stops_the_sweep(self):
        # "Not published" and "could not ask" are different answers. Treating
        # an outage as the first would report "nothing newer released".
        patch = dict(RELEASE_0_1_3, outage=["gateway:0.1.3"])
        with self.assertRaises(upstream.UpstreamError):
            plan(patch)

    def test_without_a_cap_every_release_from_the_floor_up_is_swept(self):
        # However many there are: a scheduled run passes no cap.
        many = {"tags": [], "images": {}, "sdk": {}}
        for patch_number in range(3, 12):
            commit = ("b%03d0000" % patch_number) * 5
            many["tags"].append("%s\trefs/tags/v0.1.%d" % (commit, patch_number))
            many["images"]["gateway:0.1.%d" % patch_number] = "sha256:" + "%02d" % patch_number * 32
            many["images"]["supervisor:0.1.%d" % patch_number] = "sha256:" + "%02d" % (patch_number + 50) * 32
            many["sdk"][commit] = "v0.0.0-202611%02d090000-%s" % (patch_number, commit[:12])
        many["sdk"]["latest"] = many["sdk"][("b0110000") * 5]
        the_plan, _ = plan(many)
        self.assertEqual(versions(the_plan), ["0.1.%d" % n for n in range(11, -1, -1)] + ["dev"])
        self.assertEqual(the_plan["gateway"]["not_swept"], [])
        self.assertIsNone(the_plan["inputs"]["max_versions"])

    def test_the_cap_narrows_only_what_is_at_or_below_the_ceiling(self):
        the_plan, _ = plan(RELEASE_0_1_3, max_versions=2)
        self.assertEqual(versions(the_plan), ["0.1.3", "0.1.2", "0.1.1", "dev"])
        self.assertEqual(the_plan["gateway"]["not_swept"], ["0.1.0"])

    def test_the_cap_never_removes_a_release_above_the_ceiling(self):
        # 0.1.3 to 0.1.8 exist. With the old "newest five" rule 0.1.3 fell out
        # of the window, and with it the one result that held the ceiling.
        patch = {"tags": [], "images": {}, "sdk": {}}
        for n in range(3, 9):
            commit = ("c%03d0000" % n) * 5
            patch["tags"].append("%s\trefs/tags/v0.1.%d" % (commit, n))
            patch["images"]["gateway:0.1.%d" % n] = "sha256:" + "%02d" % n * 32
            patch["images"]["supervisor:0.1.%d" % n] = "sha256:" + "%02d" % (n + 50) * 32
            patch["sdk"][commit] = "v0.0.0-202611%02d090000-%s" % (n, commit[:12])
        patch["sdk"]["latest"] = patch["sdk"][("c0080000") * 5]
        for cap in (1, 2, 5):
            the_plan, _ = plan(patch, max_versions=cap)
            swept = versions(the_plan)
            with self.subTest(max_versions=cap):
                for n in range(3, 9):
                    self.assertIn("0.1.%d" % n, swept)
                for version in the_plan["gateway"]["not_swept"]:
                    self.assertLessEqual(pins.parse_release(version), (0, 1, 2))

    def test_a_release_without_an_image_does_not_use_up_the_cap(self):
        patch = {"tags": RELEASE_0_1_3["tags"], "sdk": RELEASE_0_1_3["sdk"]}
        the_plan, _ = plan(patch, max_versions=3)
        self.assertEqual(versions(the_plan), ["0.1.2", "0.1.1", "0.1.0", "dev"])

    def test_a_cap_below_one_is_refused(self):
        # max_versions=0 used to sweep nothing but dev and then report that
        # nothing was wrong.
        for cap in (0, -1):
            with self.assertRaises(candidates.PlanError) as caught:
                plan(RELEASE_0_1_3, max_versions=cap)
            self.assertIn("at least 1", str(caught.exception))

    def test_head_can_be_left_out(self):
        the_plan, fake = plan(include_head=False)
        self.assertEqual(versions(the_plan), ["0.1.2", "0.1.1", "0.1.0"])
        self.assertNotIn("gateway:dev", fake.digest_lookups)
        self.assertNotIn("latest", fake.sdk_queries)

    def test_dev_is_marked_as_head_never_as_a_release(self):
        the_plan, _ = plan()
        dev = the_plan["gateway"]["candidates"][-1]
        self.assertEqual((dev["version"], dev["kind"], dev["position"]), ("dev", "dev", "head"))

    def test_since_extends_the_sweep_below_the_floor(self):
        the_plan, _ = plan(since="0.0.116")
        self.assertEqual(versions(the_plan), ["0.1.2", "0.1.1", "0.1.0", "0.0.116", "dev"])
        below = [c for c in the_plan["gateway"]["candidates"] if c["version"] == "0.0.116"][0]
        self.assertEqual(below["position"], "below")

    def test_since_cannot_hide_part_of_the_range(self):
        with self.assertRaises(candidates.PlanError):
            plan(since="0.1.1")
        with self.assertRaises(candidates.PlanError):
            plan(since="dev")


class SdkAxis(unittest.TestCase):
    def test_nothing_to_try_when_the_pin_is_the_newest_release(self):
        the_plan, fake = plan()
        self.assertEqual(the_plan["sdk"], {"candidates": [], "legs": []})
        self.assertEqual(the_plan["sdk_pin_tag"], "v0.1.2")
        # The newest release IS the pin, so its commit is not even resolved.
        self.assertEqual(fake.sdk_queries, ["latest"])

    def test_the_newest_release_tag_is_the_only_bump_target(self):
        the_plan, fake = plan(RELEASE_0_1_3)
        self.assertEqual(
            the_plan["sdk"]["candidates"],
            [{"id": "sdk-release", "kind": "release", "label": "v0.1.3", "tag": "v0.1.3", "commit": C13, "version": SDK13}],
        )
        self.assertEqual(fake.sdk_queries, [C13, "latest"])

    def test_the_sdk_does_not_wait_for_a_gateway_image(self):
        # A tag is source. It is a candidate even before any image is pushed.
        the_plan, _ = plan({"tags": RELEASE_0_1_3["tags"], "sdk": RELEASE_0_1_3["sdk"]})
        self.assertEqual([c["id"] for c in the_plan["sdk"]["candidates"]], ["sdk-release"])

    def test_head_is_added_as_early_warning_when_it_is_ahead(self):
        the_plan, _ = plan({"sdk": {"latest": HEAD}})
        self.assertEqual(
            the_plan["sdk"]["candidates"],
            [{"id": "sdk-latest", "kind": "latest", "label": "latest", "tag": None, "commit": None, "version": HEAD}],
        )

    def test_head_equal_to_the_release_candidate_is_not_tested_twice(self):
        the_plan, _ = plan(RELEASE_0_1_3)
        self.assertEqual([c["id"] for c in the_plan["sdk"]["candidates"]], ["sdk-release"])

    def test_release_and_head_can_both_be_candidates(self):
        patch = dict(RELEASE_0_1_3, sdk={C13: SDK13, "latest": HEAD})
        the_plan, _ = plan(patch)
        self.assertEqual([(c["id"], c["version"]) for c in the_plan["sdk"]["candidates"]], [("sdk-release", SDK13), ("sdk-latest", HEAD)])

    def test_a_pre_release_tag_is_never_a_candidate(self):
        # v0.1.3-pre.4 exists upstream and is newer than the pin. It is not a release.
        the_plan, fake = plan()
        self.assertNotIn("e7fdd6beef98f7f92d86271a169fdd4d3be44cf3", fake.sdk_queries)
        self.assertEqual(the_plan["sdk"]["candidates"], [])

    def test_never_moves_the_pin_backwards(self):
        # Pinned by hand to a commit newer than every release: no candidate.
        doc = support.fixture("pins.json")
        doc["sdk"] = HEAD
        data = support.upstream_data({"sdk": {"6648bd0c290efbc41ba131ee9831ee45cd431f94": PIN, "latest": HEAD}})
        the_plan = candidates.build_plan(doc, support.FakeUpstream(data))
        self.assertEqual(the_plan["sdk"]["candidates"], [])
        self.assertIsNone(the_plan["sdk_pin_tag"])
        self.assertIsNone(the_plan["sdk_pin_other_tag"])

    def test_every_candidate_is_tested_against_every_required_lane(self):
        patch = dict(RELEASE_0_1_3, sdk={C13: SDK13, "latest": HEAD})
        the_plan, _ = plan(patch)
        legs = [(leg["id"], leg["sdk_version"], leg["lane"]) for leg in the_plan["sdk"]["legs"]]
        self.assertEqual(
            legs,
            [
                ("sdk-release-0.1.0", SDK13, "0.1.0"),
                ("sdk-release-0.1.2", SDK13, "0.1.2"),
                ("sdk-latest-0.1.0", HEAD, "0.1.0"),
                ("sdk-latest-0.1.2", HEAD, "0.1.2"),
            ],
        )

    def test_sdk_legs_use_the_pinned_gateways_untouched(self):
        the_plan, _ = plan(RELEASE_0_1_3)
        lanes = {lane["version"]: lane for lane in support.fixture("pins.json")["lanes"]}
        for leg in the_plan["sdk"]["legs"]:
            self.assertEqual(leg["gateway_image"], lanes[leg["lane"]]["gateway_image"])
            self.assertEqual(leg["supervisor_image"], lanes[leg["lane"]]["supervisor_image"])
            self.assertEqual(leg["config_schema"], lanes[leg["lane"]]["config_schema"])
            self.assertNotIn("0.1.3", leg["gateway_image"])

    def test_legs_carry_exact_versions_never_a_query(self):
        patch = dict(RELEASE_0_1_3, sdk={C13: SDK13, "latest": HEAD})
        the_plan, _ = plan(patch)
        for leg in the_plan["sdk"]["legs"]:
            self.assertRegex(leg["sdk_version"], pins.SDK_PSEUDO_RE)


class Plan(unittest.TestCase):
    def test_a_malformed_pins_file_is_refused_before_any_lookup(self):
        fake = support.FakeUpstream(support.upstream_data())
        with self.assertRaises(pins.PinsError):
            candidates.build_plan(support.fixture("malformed/dev-lane.json")["pins"], fake)
        self.assertEqual(fake.digest_lookups, [])

    def test_no_release_tags_is_an_error_not_an_empty_sweep(self):
        data = support.upstream_data()
        data["tags"] = ["35e0c53718edfaf4cafaf5f291dada62f339e11f\trefs/tags/dev"]
        with self.assertRaises(candidates.PlanError):
            candidates.build_plan(support.fixture("pins.json"), support.FakeUpstream(data))

    def test_ids_are_unique_and_safe_as_artifact_names(self):
        patch = dict(RELEASE_0_1_3, sdk={C13: SDK13, "latest": HEAD})
        the_plan, _ = plan(patch)
        ids = [c["id"] for c in the_plan["gateway"]["candidates"]] + [leg["id"] for leg in the_plan["sdk"]["legs"]]
        self.assertEqual(len(ids), len(set(ids)))
        for an_id in ids:
            self.assertRegex(an_id, r"^[a-z0-9.-]+$")


if __name__ == "__main__":
    unittest.main()
