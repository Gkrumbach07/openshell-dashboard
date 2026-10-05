"""The one-axis guard: an automated PR changes exactly one axis."""

import copy
import unittest

import guard
import pins
from tests import support

NEW_GATEWAY = "ghcr.io/nvidia/openshell/gateway:0.1.3@sha256:" + "13" * 32
NEW_SUPERVISOR = "ghcr.io/nvidia/openshell/supervisor:0.1.3@sha256:" + "31" * 32
NEW_SDK = "v0.0.0-20261012090000-a0130000a013"
SDK_FILES = [guard.GO_MOD, guard.GO_SUM, guard.PINS_FILE]


def problems_mention(problems, text):
    return any(text in problem for problem in problems)


class GatewayAxis(unittest.TestCase):
    def setUp(self):
        self.before = support.fixture("pins.json")
        self.after = pins.move_ceiling(self.before, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, "v2")

    def check(self, changed=None, after=None):
        return guard.check_changes("gateway", changed or [guard.PINS_FILE], self.before, after or self.after)

    def test_a_ceiling_move_is_allowed(self):
        self.assertEqual(self.check(), [])

    def test_go_mod_may_not_change(self):
        problems = self.check(changed=[guard.PINS_FILE, guard.GO_MOD, guard.GO_SUM])
        self.assertTrue(problems_mention(problems, "backend/go.mod, backend/go.sum"))

    def test_no_other_file_may_change(self):
        for stray in ("README.md", ".github/workflows/ci.yml", "bin/server", "backend/pkg/handlers/x.go"):
            self.assertTrue(problems_mention(self.check(changed=[guard.PINS_FILE, stray]), stray))

    def test_the_sdk_pin_may_not_move(self):
        after = pins.set_sdk(self.after, NEW_SDK)
        self.assertTrue(problems_mention(self.check(after=after), "The SDK pin and the workload image do not move"))

    def test_the_workload_image_may_not_move(self):
        after = copy.deepcopy(self.after)
        after["sandbox_image"] = "ghcr.io/nvidia/openshell-community/sandboxes/base:latest@sha256:" + "ee" * 32
        self.assertTrue(problems_mention(self.check(after=after), "something other than a lane changed"))

    def test_the_floor_lane_may_not_move(self):
        after = copy.deepcopy(self.after)
        after["lanes"][1]["version"] = "0.1.1"
        after["lanes"][1]["label"] = "0.1.1, oldest supported"
        after["lanes"][1]["gateway_image"] = "ghcr.io/nvidia/openshell/gateway:0.1.1@sha256:" + "11" * 32
        after["lanes"][1]["supervisor_image"] = "ghcr.io/nvidia/openshell/supervisor:0.1.1@sha256:" + "12" * 32
        self.assertTrue(problems_mention(self.check(after=after), "the floor moved from 0.1.0 to 0.1.1"))

    def test_the_floor_lane_may_not_be_edited_in_place(self):
        after = copy.deepcopy(self.after)
        after["lanes"][1]["gateway_image"] = "ghcr.io/nvidia/openshell/gateway:0.1.0@sha256:" + "00" * 32
        self.assertTrue(problems_mention(self.check(after=after), "lane 0.1.0 was edited"))

    def test_the_ceiling_must_actually_rise(self):
        self.assertTrue(problems_mention(self.check(after=copy.deepcopy(self.before)), "the ceiling did not move up"))

    def test_a_lane_may_not_be_slipped_in(self):
        after = copy.deepcopy(self.after)
        extra = copy.deepcopy(self.before["lanes"][0])
        extra.update(
            version="0.1.1",
            label="0.1.1 extra",
            gateway_image="ghcr.io/nvidia/openshell/gateway:0.1.1@sha256:" + "11" * 32,
            supervisor_image="ghcr.io/nvidia/openshell/supervisor:0.1.1@sha256:" + "12" * 32,
        )
        after["lanes"].append(extra)
        self.assertTrue(problems_mention(self.check(after=after), "lanes after the change should be"))

    def test_a_result_that_is_not_a_valid_pins_file_is_refused(self):
        after = copy.deepcopy(self.after)
        after["lanes"][0]["gateway_image"] = "ghcr.io/nvidia/openshell/gateway:0.1.3"
        self.assertTrue(problems_mention(self.check(after=after), "not pinned by digest"))

    def test_a_single_lane_gains_a_ceiling_and_keeps_its_floor(self):
        before = support.fixture("pins-single-lane.json")
        after = pins.move_ceiling(before, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, "v2")
        self.assertEqual(guard.check_changes("gateway", [guard.PINS_FILE], before, after), [])

    def test_a_single_lane_may_not_simply_be_replaced(self):
        # Replacing the only lane would raise the floor without anyone deciding to.
        before = support.fixture("pins-single-lane.json")
        after = copy.deepcopy(before)
        after["lanes"][0].update(
            version="0.1.3", label="0.1.3, newest tested", gateway_image=NEW_GATEWAY, supervisor_image=NEW_SUPERVISOR
        )
        problems = guard.check_changes("gateway", [guard.PINS_FILE], before, after)
        self.assertTrue(problems_mention(problems, "the floor moved from 0.1.2 to 0.1.3"))


class SdkAxis(unittest.TestCase):
    def setUp(self):
        self.before = support.fixture("pins.json")
        self.after = pins.set_sdk(self.before, NEW_SDK)

    def check(self, changed=None, after=None, go_mod_version=NEW_SDK):
        return guard.check_changes("sdk", changed or SDK_FILES, self.before, after or self.after, go_mod_version)

    def test_an_sdk_move_is_allowed(self):
        self.assertEqual(self.check(), [])

    def test_go_sum_is_optional_but_go_mod_is_not(self):
        self.assertEqual(self.check(changed=[guard.GO_MOD, guard.PINS_FILE]), [])
        self.assertTrue(problems_mention(self.check(changed=[guard.GO_SUM, guard.PINS_FILE]), "must change backend/go.mod"))

    def test_bff_source_may_not_change(self):
        # A source migration is a person's PR; the automated one moves the pin only.
        problems = self.check(changed=SDK_FILES + ["backend/pkg/handlers/sandboxes_handler.go"])
        self.assertTrue(problems_mention(problems, "backend/pkg/handlers/sandboxes_handler.go"))

    def test_no_gateway_lane_may_change(self):
        after = pins.move_ceiling(self.after, "0.1.3", "ghcr.io/nvidia/openshell/gateway:0.1.3@sha256:" + "13" * 32,
                                  "ghcr.io/nvidia/openshell/supervisor:0.1.3@sha256:" + "31" * 32, "v2")
        self.assertTrue(problems_mention(self.check(after=after), "No gateway lane moves on the sdk axis"))

    def test_the_recorded_pin_must_be_updated(self):
        problems = self.check(changed=[guard.GO_MOD, guard.GO_SUM], after=copy.deepcopy(self.before), go_mod_version=None)
        self.assertTrue(problems_mention(problems, "the sdk field of deploy/ci/gateway-pins.json was not updated"))
        self.assertTrue(problems_mention(problems, "the sdk field did not change"))

    def test_the_recorded_pin_must_match_go_mod(self):
        problems = self.check(go_mod_version="v0.0.0-20261019090000-a0140000a014")
        self.assertTrue(problems_mention(problems, "backend/go.mod requires v0.0.0-20261019090000-a0140000a014"))


class Axes(unittest.TestCase):
    def test_unknown_axis(self):
        self.assertEqual(guard.check_changes("both", [], {}, {}), ["unknown axis 'both'"])

    def test_no_single_change_satisfies_both_axes(self):
        before = support.fixture("pins.json")
        both = pins.set_sdk(pins.move_ceiling(before, "0.1.3", NEW_GATEWAY, NEW_SUPERVISOR, "v2"), NEW_SDK)
        self.assertTrue(guard.check_changes("gateway", SDK_FILES, before, both))
        self.assertTrue(guard.check_changes("sdk", SDK_FILES, before, both, NEW_SDK))


if __name__ == "__main__":
    unittest.main()
