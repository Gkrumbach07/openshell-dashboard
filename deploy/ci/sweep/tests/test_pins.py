"""The pins file: validation, the derived range, and the two edits."""

import copy
import os
import unittest

import pins
from tests import support

REAL_PINS = os.path.join(support.REPO_ROOT, "deploy", "ci", "gateway-pins.json")
REAL_GO_MOD = os.path.join(support.REPO_ROOT, "backend", "go.mod")

NEW_GATEWAY = "ghcr.io/nvidia/openshell/gateway:0.1.3@sha256:" + "13" * 32
NEW_SUPERVISOR = "ghcr.io/nvidia/openshell/supervisor:0.1.3@sha256:" + "31" * 32


class CheckedInPinsFile(unittest.TestCase):
    """The file CI actually reads must satisfy every rule below."""

    def test_is_well_formed_and_agrees_with_go_mod(self):
        doc = pins.load(REAL_PINS)
        with open(REAL_GO_MOD, encoding="utf-8") as fh:
            go_mod_version = pins.go_mod_sdk(fh.read())
        self.assertIsNotNone(go_mod_version)
        problems = pins.validate(doc, schemas=pins.known_schemas(REAL_PINS), go_mod_version=go_mod_version)
        self.assertEqual(problems, [])

    def test_round_trips_byte_for_byte(self):
        # An automated PR rewrites this file; untouched lines must not move.
        with open(REAL_PINS, encoding="utf-8") as fh:
            text = fh.read()
        self.assertEqual(
            pins.dump(pins.load(REAL_PINS)),
            text,
            "gateway-pins.json is not in canonical form; run `python3 deploy/ci/sweep/sweep.py format-pins`",
        )

    def test_does_not_restate_the_range(self):
        doc = pins.load(REAL_PINS)
        for key in ("floor", "floor_release", "ceiling"):
            self.assertNotIn(key, doc)

    def test_the_stack_has_a_template_for_both_config_schemas(self):
        # v1 for gateways up to 0.0.116, v2 from 0.1.0. More may be added.
        self.assertTrue({"v1", "v2"} <= set(pins.known_schemas(REAL_PINS)))


class Validate(unittest.TestCase):
    def test_fixture_is_valid(self):
        self.assertEqual(pins.validate(support.fixture("pins.json"), schemas=["v1", "v2"]), [])

    def test_every_malformed_fixture_is_rejected_for_the_stated_reason(self):
        directory = os.path.join(support.FIXTURES, "malformed")
        names = sorted(os.listdir(directory))
        # The four the pins job must catch, plus the rest.
        for required in ("no-required-lane", "image-without-digest", "version-not-a-release", "dev-lane"):
            self.assertIn(required + ".json", names)
        for name in names:
            case = support.fixture("malformed/" + name)
            problems = pins.validate(case["pins"], schemas=["v1", "v2"])
            with self.subTest(fixture=name):
                self.assertTrue(problems, "accepted a malformed pins file")
                for expected in case["expect_problems"]:
                    self.assertTrue(
                        any(expected in problem for problem in problems),
                        "no problem mentions %r; got %r" % (expected, problems),
                    )

    def test_the_range_may_not_be_written_down_under_any_name(self):
        for key in ("floor", "floor_release", "ceiling", "ceiling_release", "range"):
            doc = support.fixture("pins.json")
            doc[key] = "0.1.2"
            self.assertTrue(any("top-level key %r is not allowed" % key in p for p in pins.validate(doc)), key)

    def test_other_top_level_keys_are_left_alone(self):
        # Only a second copy of the range is refused; this file may carry more.
        doc = support.fixture("pins.json")
        doc["notes"] = {"owner": "someone else's tool"}
        self.assertEqual(pins.validate(doc), [])

    def test_reports_every_problem_at_once(self):
        doc = support.fixture("pins.json")
        doc["floor"] = "0.1.2"
        doc["sdk"] = "latest"
        doc["lanes"][0]["gateway_image"] = "ghcr.io/nvidia/openshell/gateway:0.1.2"
        self.assertGreaterEqual(len(pins.validate(doc)), 3)

    def test_sdk_must_match_go_mod(self):
        doc = support.fixture("pins.json")
        problems = pins.validate(doc, go_mod_version="v0.0.0-20261012090000-a0130000a013")
        self.assertEqual(len(problems), 1)
        self.assertIn("backend/go.mod requires v0.0.0-20261012090000-a0130000a013", problems[0])

    def test_unknown_config_schema_needs_a_template(self):
        doc = support.fixture("pins.json")
        doc["lanes"][0]["config_schema"] = "v3"
        self.assertEqual(pins.validate(doc), [])  # no template list given: not checked
        problems = pins.validate(doc, schemas=["v1", "v2"])
        self.assertIn("config_schema 'v3' has no template", problems[0])

    def test_a_dev_build_version_is_called_a_dev_lane(self):
        doc = support.fixture("pins.json")
        doc["lanes"][0]["version"] = "0.1.3-dev.84"
        self.assertTrue(any("a dev lane is not allowed" in p for p in pins.validate(doc)))

    def test_not_an_object(self):
        self.assertEqual(pins.validate([]), ["the pins file must be a JSON object"])

    def test_go_mod_sdk_reads_the_require_line(self):
        text = "module x\n\nrequire (\n\tgithub.com/NVIDIA/OpenShell/sdk/go v0.0.0-20260928030816-6648bd0c290e\n)\n"
        self.assertEqual(pins.go_mod_sdk(text), "v0.0.0-20260928030816-6648bd0c290e")
        single = "require github.com/NVIDIA/OpenShell/sdk/go v0.1.2\n"
        self.assertEqual(pins.go_mod_sdk(single), "v0.1.2")
        self.assertIsNone(pins.go_mod_sdk("module x\n"))


class DerivedRange(unittest.TestCase):
    def test_floor_and_ceiling_come_from_the_required_lanes(self):
        self.assertEqual(pins.supported_range(support.fixture("pins.json")), ("0.1.0", "0.1.2"))

    def test_order_in_the_file_does_not_matter(self):
        doc = support.fixture("pins.json")
        doc["lanes"].reverse()
        self.assertEqual(pins.supported_range(doc), ("0.1.0", "0.1.2"))

    def test_versions_compare_as_numbers_not_text(self):
        doc = support.fixture("pins.json")
        doc["lanes"][0]["version"] = "0.1.10"
        doc["lanes"][1]["version"] = "0.1.9"
        self.assertEqual(pins.supported_range(doc), ("0.1.9", "0.1.10"))

    def test_advisory_lanes_do_not_widen_the_range(self):
        doc = support.fixture("pins.json")
        advisory = copy.deepcopy(doc["lanes"][0])
        advisory.update(version="0.1.9", required=False)
        doc["lanes"].append(advisory)
        self.assertEqual(pins.supported_range(doc), ("0.1.0", "0.1.2"))

    def test_single_required_lane_is_both_ends(self):
        self.assertEqual(pins.supported_range(support.fixture("pins-single-lane.json")), ("0.1.2", "0.1.2"))

    def test_no_required_lane_has_no_range(self):
        doc = support.fixture("malformed/no-required-lane.json")["pins"]
        with self.assertRaises(pins.PinsError):
            pins.supported_range(doc)


class MoveCeiling(unittest.TestCase):
    def test_only_the_ceiling_lane_changes(self):
        before = support.fixture("pins.json")
        after = pins.move_ceiling(before, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, "v2")

        self.assertEqual(pins.supported_range(after), ("0.1.0", "0.1.3"))
        self.assertEqual(pins.validate(after, schemas=["v1", "v2"]), [])
        # Everything that is not the ceiling lane is untouched.
        for key in ("_comment", "sdk", "sandbox_image"):
            self.assertEqual(after[key], before[key])
        self.assertEqual(after["lanes"][1], before["lanes"][1])
        # ...and the ceiling lane sits where the old one sat, pinned by digest.
        self.assertEqual(
            after["lanes"][0],
            {
                "version": "0.1.3",
                "label": "0.1.3, newest tested",
                "required": True,
                "config_schema": "v2",
                "gateway_image": NEW_GATEWAY,
                "supervisor_image": NEW_SUPERVISOR,
            },
        )
        self.assertEqual(sorted(after["lanes"][0]), sorted(pins.LANE_KEYS))

    def test_the_input_is_not_modified(self):
        before = support.fixture("pins.json")
        snapshot = copy.deepcopy(before)
        pins.move_ceiling(before, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, "v2")
        self.assertEqual(before, snapshot)

    def test_a_single_lane_keeps_its_floor(self):
        before = support.fixture("pins-single-lane.json")
        after = pins.move_ceiling(before, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, "v2")
        self.assertEqual(pins.supported_range(after), ("0.1.2", "0.1.3"))
        self.assertEqual([lane["version"] for lane in after["lanes"]], ["0.1.3", "0.1.2"])
        self.assertEqual(after["lanes"][1]["label"], "0.1.2, oldest supported")
        self.assertEqual(after["lanes"][1]["gateway_image"], before["lanes"][0]["gateway_image"])
        self.assertEqual(pins.validate(after), [])

    def test_dev_is_never_pinned(self):
        doc = support.fixture("pins.json")
        dev_gateway = "ghcr.io/nvidia/openshell/gateway:dev@sha256:" + "aa" * 32
        dev_supervisor = "ghcr.io/nvidia/openshell/supervisor:dev@sha256:" + "bb" * 32
        with self.assertRaises(pins.PinsError) as caught:
            pins.move_ceiling(doc, "dev", dev_gateway, dev_supervisor, "v2")
        self.assertIn("never dev/HEAD", str(caught.exception))

    def test_refuses_an_image_without_a_digest(self):
        doc = support.fixture("pins.json")
        with self.assertRaises(pins.PinsError):
            pins.move_ceiling(doc, "0.1.3", "ghcr.io/nvidia/openshell/gateway:0.1.3", NEW_SUPERVISOR, "v2")

    def test_refuses_an_image_tagged_for_another_release(self):
        doc = support.fixture("pins.json")
        with self.assertRaises(pins.PinsError):
            pins.move_ceiling(doc, "0.1.4", NEW_GATEWAY, NEW_SUPERVISOR, "v2")

    def test_refuses_to_move_down_or_sideways(self):
        doc = support.fixture("pins.json")
        for version in ("0.1.2", "0.1.1"):
            gateway = "ghcr.io/nvidia/openshell/gateway:%s@sha256:%s" % (version, "13" * 32)
            supervisor = "ghcr.io/nvidia/openshell/supervisor:%s@sha256:%s" % (version, "31" * 32)
            with self.assertRaises(pins.PinsError):
                pins.move_ceiling(doc, version, gateway, supervisor, "v2")

    def test_refuses_without_a_config_schema(self):
        doc = support.fixture("pins.json")
        with self.assertRaises(pins.PinsError):
            pins.move_ceiling(doc, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, None)


class SetSdk(unittest.TestCase):
    def test_only_the_sdk_field_changes(self):
        before = support.fixture("pins.json")
        after = pins.set_sdk(before, "v0.0.0-20261012090000-a0130000a013")
        self.assertEqual(after["sdk"], "v0.0.0-20261012090000-a0130000a013")
        self.assertEqual({k: v for k, v in after.items() if k != "sdk"}, {k: v for k, v in before.items() if k != "sdk"})

    def test_latest_is_never_recorded(self):
        for query in ("latest", "main", "6648bd0c290e", ""):
            with self.assertRaises(pins.PinsError):
                pins.set_sdk(support.fixture("pins.json"), query)


class ImageRefs(unittest.TestCase):
    def test_split(self):
        self.assertEqual(
            pins.split_image("ghcr.io/nvidia/openshell/gateway:0.1.2@sha256:" + "ab" * 32),
            ("ghcr.io/nvidia/openshell/gateway", "0.1.2", "sha256:" + "ab" * 32),
        )
        self.assertEqual(pins.split_image("ghcr.io/x/gateway:0.1.2"), ("ghcr.io/x/gateway", "0.1.2", ""))
        # A registry port is not a tag.
        self.assertEqual(pins.split_image("localhost:5000/gateway"), ("localhost:5000/gateway", "", ""))
        self.assertEqual(pins.split_image(None), ("", "", ""))


if __name__ == "__main__":
    unittest.main()
