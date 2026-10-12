"""`next`, against a real git repository on disk.

Every scenario builds a throwaway clone with a bare `origin`, lets prepare()
work in it, and looks at what came out with git itself. The pin move is the
real one (pinmove.apply) with stand-in tools, so the files it rewrites and the
conflicts they cause are real too.

A class marked `shared` arranges its scenario once and its tests only look at
the result: git is the slow part, and a scenario costs a few dozen commands.
"""

import json
import os
import subprocess
import unittest

import nextbranch
import pinmove
import pins
import report
from tests import support

PINNED = {"release": "0.1.3", "line": "0.1"}
ON_0_1_4 = {"release": "0.1.4", "line": "0.1"}
PRE1 = support.target("0.1.4-pre.1")
PRE2 = support.target("0.1.4-pre.2")
STABLE = support.target("0.1.4")

MORE = {"app.txt": "one\ntwo\nthree\nfour\n"}
PIN_FILES = sorted([pinmove.README, pinmove.GO_MOD, pinmove.GO_SUM, pinmove.PINS])


def with_dependency(go_mod, after, new):
    """go.mod with one more requirement, placed after an existing one."""
    return go_mod.replace("\t%s v1.0.0\n" % after, "\t%s v1.0.0\n\t%s v1.0.0\n" % (after, new))


class NextBranch(unittest.TestCase):
    shared = False

    @classmethod
    def fresh(cls):
        cls.repo = support.Repo("0.1.3")
        cls.tools = support.FakeTools()

    @classmethod
    def setUpClass(cls):
        if cls.shared:
            cls.fresh()
            cls.addClassCleanup(cls.repo.close)
            cls.arrange()

    def setUp(self):
        if not self.shared:
            self.fresh()
            self.addCleanup(self.repo.close)
            self.arrange()

    @classmethod
    def arrange(cls):
        """The scenario. Runs once for a shared class, before every test otherwise."""

    @classmethod
    def prepare(cls, target, tools=None, spent=False, pinned=PINNED):
        tools = tools or cls.tools
        return nextbranch.prepare(
            cls.repo.path,
            target,
            mover=lambda tree, to: pinmove.apply(tree, to, tools="/tools", run=tools),
            message=lambda to, moved: report.commit_message(to, pinned),
            lockfiles=nextbranch.lockfile_regenerators(run=tools),
            main_ref="refs/remotes/origin/main",
            spent=spent,
        )

    @classmethod
    def start(cls, target=PRE1):
        """Create `next` for a target and publish it. Returns the outcome."""
        outcome = cls.prepare(target)
        cls.repo.publish(outcome["sha"])
        return outcome

    @classmethod
    def two_dependencies(cls):
        """A commit on `next` and one on main that each add a requirement.

        Far apart in go.mod, so the manifests merge. Next to each other in the
        sorted go.sum, so the lock files do not. Returns the commit on next.
        """
        ours = with_dependency(cls.repo.read(pinmove.GO_MOD, "origin/next"), "example.com/zzz", "example.com/sss-person")
        person = cls.repo.on_next("feat: a dependency on next", {pinmove.GO_MOD: ours, pinmove.GO_SUM: support.go_sum_for(ours)})
        theirs = with_dependency(cls.repo.read(pinmove.GO_MOD, "origin/main"), "example.com/aaa", "example.com/sss-main")
        cls.repo.on_main("feat: a dependency on main", {pinmove.GO_MOD: theirs, pinmove.GO_SUM: support.go_sum_for(theirs)})
        return person

    def subjects(self, sha):
        return self.repo.log("origin/main", sha)

    def pin_commit(self, sha):
        return self.repo.git("rev-list", "--reverse", "origin/main..%s" % sha).splitlines()[0]

    def changed_by(self, sha):
        return sorted(self.repo.git("show", "--name-only", "--format=", sha).splitlines())

    @classmethod
    def pins_at(cls, sha):
        return json.loads(cls.repo.read(pinmove.PINS, sha))

    def assert_left_clean(self):
        """No scratch worktree, no rebase in progress, and the clone where it was."""
        self.assertEqual(len(self.repo.git("worktree", "list").splitlines()), 1)
        self.assertEqual(self.repo.git("status", "--porcelain"), "")
        self.assertEqual(self.repo.git("rev-parse", "--abbrev-ref", "HEAD"), "main")
        self.assertFalse(os.path.isdir(os.path.join(self.repo.path, ".git", "rebase-merge")))


class Create(NextBranch):
    shared = True

    @classmethod
    def arrange(cls):
        cls.outcome = cls.prepare(PRE1)
        cls.sha = cls.outcome["sha"]

    def test_next_is_main_plus_one_commit(self):
        self.assertEqual(self.outcome["action"], "create")
        self.assertIsNone(self.outcome["next"])
        self.assertEqual(self.repo.rev(self.sha + "~1"), self.repo.rev("origin/main"))
        self.assertEqual(self.subjects(self.sha), ["fix: move to OpenShell 0.1.4-pre.1"])
        self.assertTrue(self.outcome["pin_moved"])
        self.assertFalse(self.outcome["rebased"])
        self.assertEqual(self.outcome["people"], [])

    def test_the_commit_is_the_bots_signed_off_and_carries_the_trailer(self):
        body = self.repo.git("log", "-1", "--format=%an <%ae>%n%B", self.sha)
        self.assertTrue(body.startswith("github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>"))
        self.assertIn("\nOpenShell-Release: 0.1.4-pre.1\n", body)
        self.assertIn("Signed-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>", body)
        self.assertIn("from 0.1.3 to", body)

    def test_it_changes_the_pin_files_and_nothing_else(self):
        self.assertEqual(self.changed_by(self.sha), PIN_FILES)
        self.assertEqual(self.outcome["pins"]["release"], "0.1.4-pre.1")
        self.assertEqual(self.pins_at(self.sha)["gateway_image"], PRE1["gateway_image"])

    def test_nothing_is_pushed_and_the_commit_is_kept_under_a_local_ref(self):
        self.assertIsNone(self.repo.origin_next())
        self.assertEqual(self.repo.rev(nextbranch.LOCAL_REF), self.sha)
        self.assert_left_clean()


class NothingMoved(NextBranch):
    def test_main_did_not_move_and_the_pin_is_there_so_nothing_changes(self):
        first = self.start(PRE1)
        again = support.FakeTools()
        outcome = self.prepare(PRE1, again)
        self.assertEqual(outcome["action"], "none")
        self.assertEqual(outcome["sha"], first["sha"], "not even the commit id")
        self.assertFalse(outcome["rebased"])
        self.assertFalse(outcome["pin_moved"])
        self.assertEqual(again.calls, [], "and no tool was run")
        self.assert_left_clean()

    def test_with_a_persons_commit_on_it_too(self):
        self.start(PRE1)
        person = self.repo.on_next("feat: use the new field", MORE)
        outcome = self.prepare(PRE1)
        self.assertEqual(outcome["action"], "none")
        self.assertEqual(outcome["sha"], person)
        self.assertEqual([commit["subject"] for commit in outcome["people"]], ["feat: use the new field"])


class MainMoved(NextBranch):
    shared = True

    @classmethod
    def arrange(cls):
        cls.start(PRE1)
        cls.person = cls.repo.on_next("feat: use the new field", MORE)
        cls.main = cls.repo.on_main("fix: something on main", {"docs/notes.md": "a note\n"})
        cls.tools.calls[:] = []
        cls.outcome = cls.prepare(PRE1)
        cls.sha = cls.outcome["sha"]

    def test_next_is_rebased_onto_it(self):
        self.assertEqual(self.outcome["action"], "update")
        self.assertTrue(self.outcome["rebased"])
        self.assertFalse(self.outcome["pin_moved"])
        self.assertIn("main has moved", self.outcome["reason"])
        self.assertEqual(self.repo.git("merge-base", self.sha, "origin/main"), self.main)

    def test_it_still_reads_main_the_pin_move_then_peoples_commits(self):
        self.assertEqual(self.subjects(self.sha), ["fix: move to OpenShell 0.1.4-pre.1", "feat: use the new field"])
        self.assertEqual(self.repo.read("docs/notes.md", self.sha), "a note\n")
        self.assertEqual(self.repo.read("app.txt", self.sha), MORE["app.txt"])

    def test_a_persons_commit_keeps_its_author_and_the_lease_names_what_was_there(self):
        self.assertEqual(self.repo.git("log", "-1", "--format=%an", self.sha), "A Person")
        self.assertEqual(self.outcome["next"], self.person, "what origin/next was: the value the push is leased on")
        self.assertEqual(self.repo.origin_next(), self.person, "and nothing was pushed")

    def test_no_tool_is_run_for_a_rebase_alone(self):
        self.assertEqual(self.tools.calls, [])


class SecondPinMove(NextBranch):
    """The target changed: the new move is a fixup, folded into the pin commit."""

    shared = True

    @classmethod
    def arrange(cls):
        cls.start(PRE1)
        cls.repo.on_next("feat: use the new field", MORE)
        cls.repo.on_next("test: cover it", {"app_test.txt": "covered\n"})
        cls.outcome = cls.prepare(PRE2)
        cls.sha = cls.outcome["sha"]

    def test_there_is_still_one_pin_commit_and_it_is_first(self):
        self.assertEqual(self.outcome["action"], "update")
        self.assertTrue(self.outcome["pin_moved"])
        self.assertFalse(self.outcome["rebased"], "main did not move")
        self.assertEqual(
            self.subjects(self.sha),
            ["fix: move to OpenShell 0.1.4-pre.2", "feat: use the new field", "test: cover it"],
        )
        commits = nextbranch.commits_between(nextbranch.Git(self.repo.path), "origin/main", self.sha)
        self.assertEqual([commit["pin"] for commit in commits], ["0.1.4-pre.2", None, None])

    def test_no_fixup_commit_is_left_behind(self):
        for subject in self.subjects(self.sha):
            self.assertFalse(subject.startswith(("amend!", "fixup!", "squash!")), subject)

    def test_its_message_names_the_release_it_now_pins(self):
        body = self.repo.git("log", "-1", "--format=%B", self.pin_commit(self.sha))
        self.assertTrue(body.startswith("fix: move to OpenShell 0.1.4-pre.2\n"))
        self.assertIn("OpenShell-Release: 0.1.4-pre.2", body)
        self.assertNotIn("0.1.4-pre.1", body)
        self.assertEqual(body.count("Signed-off-by:"), 1)

    def test_the_pin_commit_holds_the_whole_move_from_main(self):
        pin = self.pin_commit(self.sha)
        self.assertEqual(self.pins_at(pin)["release"], "0.1.4-pre.2")
        self.assertEqual(self.pins_at(pin)["gateway_image"], PRE2["gateway_image"])
        self.assertIn(PRE2["commit"][:12], self.repo.read(pinmove.GO_MOD, pin))
        self.assertNotIn(PRE1["commit"][:12], self.repo.read(pinmove.GO_SUM, pin))
        self.assertEqual(self.changed_by(pin), PIN_FILES)

    def test_peoples_commits_are_untouched_in_content_and_author(self):
        self.assertEqual(self.repo.read("app.txt", self.sha), MORE["app.txt"])
        self.assertEqual(self.repo.read("app_test.txt", self.sha), "covered\n")
        authors = self.repo.git("log", "--format=%an", "origin/main..%s" % self.sha).splitlines()
        self.assertEqual(authors, ["A Person", "A Person", "github-actions[bot]"])
        self.assertEqual(len(self.outcome["people"]), 2)
        self.assertEqual(self.changed_by(self.sha), ["app_test.txt"])


class StableReleaseAndMainMovedTogether(NextBranch):
    def test_one_run_rebases_and_re_pins(self):
        self.start(PRE2)
        self.repo.on_next("feat: use the new field", MORE)
        self.repo.on_main("fix: something on main", {"docs/notes.md": "a note\n"})
        outcome = self.prepare(STABLE)
        self.assertEqual(outcome["action"], "update")
        self.assertTrue(outcome["rebased"] and outcome["pin_moved"])
        self.assertEqual(self.subjects(outcome["sha"]), ["fix: move to OpenShell 0.1.4", "feat: use the new field"])
        self.assertEqual(outcome["pins"]["release"], "0.1.4")
        body = self.repo.git("log", "-1", "--format=%B", self.pin_commit(outcome["sha"]))
        self.assertIn("OpenShell-Release: 0.1.4\n", body + "\n")
        self.assertNotIn("pre-release", body)


class ANewMinorOnNext(NextBranch):
    def test_the_built_in_line_moves_in_the_pin_commit(self):
        outcome = self.prepare(support.target("0.2.0-pre.1"))
        self.assertIn(pinmove.LINE_SOURCE, self.changed_by(outcome["sha"]))
        self.assertIn('BuiltInGatewayReleaseLine = "0.2"', self.repo.read(pinmove.LINE_SOURCE, outcome["sha"]))
        self.assertIn("starts gateway release line 0.2", self.repo.git("log", "-1", "--format=%B", outcome["sha"]))


class LockFileConflict(NextBranch):
    """Both sides added a dependency: the manifests merge, the lock files do not."""

    shared = True

    @classmethod
    def arrange(cls):
        cls.start(PRE1)
        cls.two_dependencies()
        cls.outcome = cls.prepare(PRE1)

    def test_the_lock_file_is_regenerated_and_the_rebase_carries_on(self):
        self.assertEqual(self.outcome["action"], "update", self.outcome)
        self.assertTrue(self.outcome["rebased"])
        self.assertEqual(self.outcome["regenerated"], [pinmove.GO_SUM])
        self.assertIsNone(self.outcome["conflict"])

    def test_the_result_has_both_dependencies_in_the_manifest_and_in_the_lock_file(self):
        sha = self.outcome["sha"]
        go_mod, go_sum = self.repo.read(pinmove.GO_MOD, sha), self.repo.read(pinmove.GO_SUM, sha)
        for dependency in ("example.com/sss-main", "example.com/sss-person", PRE1["commit"][:12]):
            self.assertIn(dependency, go_mod)
            self.assertIn(dependency, go_sum)
        self.assertEqual(go_sum, support.go_sum_for(go_mod), "the lock file is what its tool derives from the manifest")
        self.assertNotIn("<<<<<<<", go_sum)

    def test_the_shape_and_the_authors_are_kept(self):
        sha = self.outcome["sha"]
        self.assertEqual(self.subjects(sha), ["fix: move to OpenShell 0.1.4-pre.1", "feat: a dependency on next"])
        self.assertEqual(self.repo.git("log", "-1", "--format=%an", sha), "A Person")
        self.assert_left_clean()

    def test_go_mod_tidy_is_what_regenerated_it_and_nothing_was_built(self):
        self.assertIn(["go", "mod", "tidy"], self.tools.calls)
        for command in self.tools.calls:
            self.assertNotIn(command[1], ("build", "test", "vet", "run"))


class PackageLockConflict(NextBranch):
    def test_it_is_regenerated_from_package_json_without_running_scripts(self):
        # package.json gains a key at either end, which merges; the lock file
        # is rewritten on both sides, which does not.
        base = [("mmm-%02d" % index, "1.0.0") for index in range(12)]

        def package(*extra, **where):
            items = (list(extra) + base) if where.get("first") else (base + list(extra))
            text = json.dumps({"dependencies": dict(items)}, indent=2) + "\n"
            return {"frontend/package.json": text, "frontend/package-lock.json": support.package_lock_for(text)}

        self.repo.on_main("chore: more dependencies", package())
        self.start(PRE1)
        self.repo.on_next("feat: one on next", package(("zzz-next", "3.0.0")))
        self.repo.on_main("feat: one on main", package(("aaa-main", "1.0.0"), first=True))
        self.tools.calls[:] = []
        outcome = self.prepare(PRE1)

        self.assertEqual(outcome["action"], "update", outcome)
        self.assertEqual(outcome["regenerated"], ["frontend/package-lock.json"])
        merged = self.repo.read("frontend/package.json", outcome["sha"])
        self.assertIn("zzz-next", merged)
        self.assertIn("aaa-main", merged)
        self.assertEqual(self.repo.read("frontend/package-lock.json", outcome["sha"]), support.package_lock_for(merged))
        self.assertEqual(
            self.tools.calls, [["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]]
        )


class UnresolvableConflict(NextBranch):
    """A person's commit and main changed the same line of an ordinary file."""

    shared = True

    @classmethod
    def arrange(cls):
        cls.created = cls.start(PRE1)
        cls.person = cls.repo.on_next("feat: change line two", {"app.txt": "one\nTWO from next\nthree\n"})
        cls.repo.on_main("fix: change line two as well", {"app.txt": "one\nTWO from main\nthree\n"})
        cls.outcome = cls.prepare(PRE1)

    def test_it_is_reported_with_the_files_and_the_commit(self):
        self.assertEqual(self.outcome["action"], "conflict")
        conflict = self.outcome["conflict"]
        self.assertEqual(conflict["stage"], "rebase")
        self.assertEqual(conflict["files"], ["app.txt"])
        self.assertEqual(conflict["commit"]["sha"], self.person)
        self.assertEqual(conflict["commit"]["subject"], "feat: change line two")
        self.assertIsNone(self.outcome["sha"])

    def test_next_is_left_exactly_as_it_was(self):
        self.assertEqual(self.repo.origin_next(), self.person)
        self.assertEqual(self.outcome["next"], self.person)
        # Nothing is kept for publishing either: the local ref still names the
        # commit `next` was created at, not a half-rebased one.
        self.assertEqual(self.repo.rev(nextbranch.LOCAL_REF), self.created["sha"])
        self.assertEqual(self.outcome["pins"]["release"], "0.1.4-pre.1")
        self.assertEqual([commit["subject"] for commit in self.outcome["people"]], ["feat: change line two"])

    def test_the_rebase_is_aborted_and_nothing_is_left_lying_around(self):
        self.assert_left_clean()
        self.assertEqual(self.outcome["regenerated"], [])


class ResolvedByHand(NextBranch):
    def test_once_a_person_has_rebased_next_the_following_run_carries_on(self):
        self.start(PRE1)
        self.repo.on_next("feat: change line two", {"app.txt": "one\nTWO from next\nthree\n"})
        self.repo.on_main("fix: change line two as well", {"app.txt": "one\nTWO from main\nthree\n"})
        self.assertEqual(self.prepare(PRE1)["action"], "conflict")

        # By hand: rebase, keep both changes, continue, force-push.
        self.repo.git("checkout", "-q", "-B", "next", "origin/next")
        with self.assertRaises(subprocess.CalledProcessError):
            self.repo.git("rebase", "origin/main")
        self.repo.write("app.txt", "one\nTWO from main and next\nthree\n")
        self.repo.git("add", "app.txt")
        self.repo.git("-c", "core.editor=true", "rebase", "--continue")
        self.repo.git("push", "-q", "--force", "origin", "next")
        self.repo.git("checkout", "-q", "main")
        self.repo.git("fetch", "-q", "origin")

        outcome = self.prepare(PRE2)
        self.assertEqual(outcome["action"], "update")
        self.assertEqual(self.subjects(outcome["sha"]), ["fix: move to OpenShell 0.1.4-pre.2", "feat: change line two"])
        self.assertEqual(self.repo.read("app.txt", outcome["sha"]), "one\nTWO from main and next\nthree\n")


class ALockFileAndAnOrdinaryFileInOneStop(NextBranch):
    def test_nothing_is_regenerated_for_a_stop_that_cannot_be_finished(self):
        self.start(PRE1)
        ours = with_dependency(self.repo.read(pinmove.GO_MOD, "origin/next"), "example.com/zzz", "example.com/sss-person")
        person = self.repo.on_next(
            "feat: both",
            {pinmove.GO_MOD: ours, pinmove.GO_SUM: support.go_sum_for(ours), "app.txt": "one\nTWO from next\nthree\n"},
        )
        theirs = with_dependency(self.repo.read(pinmove.GO_MOD, "origin/main"), "example.com/aaa", "example.com/sss-main")
        self.repo.on_main(
            "feat: both on main",
            {pinmove.GO_MOD: theirs, pinmove.GO_SUM: support.go_sum_for(theirs), "app.txt": "one\nTWO from main\nthree\n"},
        )
        self.tools.calls[:] = []
        outcome = self.prepare(PRE1)
        self.assertEqual(outcome["action"], "conflict")
        self.assertEqual(sorted(outcome["conflict"]["files"]), ["app.txt", pinmove.GO_SUM])
        self.assertEqual(outcome["regenerated"], [])
        self.assertEqual(self.tools.calls, [], "no tool was run")
        self.assertEqual(self.repo.origin_next(), person)
        self.assert_left_clean()


class ConflictWhileMovingThePin(NextBranch):
    """A person's commit edited the pins file where the next move writes."""

    shared = True

    @classmethod
    def arrange(cls):
        cls.start(PRE1)
        doc = cls.pins_at("origin/next")
        doc["supervisor_image"] = support.image("supervisor", "0.1.4-pre.1", salt="hand-pinned")
        cls.person = cls.repo.on_next("fix: pin another supervisor build", {pinmove.PINS: pins.dump(doc)})
        cls.outcome = cls.prepare(PRE2)

    def test_it_stops_and_says_it_was_the_pin_move(self):
        self.assertEqual(self.outcome["action"], "conflict")
        self.assertEqual(self.outcome["conflict"]["stage"], "pin")
        self.assertEqual(self.outcome["conflict"]["files"], [pinmove.PINS])
        self.assertFalse(self.outcome["pin_moved"])
        self.assertIn("could not be moved to OpenShell 0.1.4-pre.2", self.outcome["reason"])

    def test_next_keeps_the_old_pin_and_the_persons_commit(self):
        self.assertEqual(self.repo.origin_next(), self.person)
        self.assertEqual(self.outcome["pins"]["release"], "0.1.4-pre.1")
        self.assert_left_clean()


class MadeByHand(NextBranch):
    """Someone pushed `next` themselves, so no pin move starts it."""

    def test_the_pin_move_is_put_first_and_their_commit_on_top(self):
        self.repo.git("checkout", "-q", "-b", "next")
        self.repo.write("app.txt", "one\ntwo\nthree\nby hand\n")
        self.repo.commit("feat: started early")
        self.repo.git("push", "-q", "origin", "next")
        self.repo.git("checkout", "-q", "main")
        self.repo.git("fetch", "-q", "origin")

        outcome = self.prepare(PRE1)
        self.assertEqual(outcome["action"], "update")
        self.assertTrue(outcome["pin_moved"])
        sha = outcome["sha"]
        self.assertEqual(self.subjects(sha), ["fix: move to OpenShell 0.1.4-pre.1", "feat: started early"])
        self.assertEqual(self.changed_by(self.pin_commit(sha)), PIN_FILES)
        self.assertEqual(self.repo.read("app.txt", sha), "one\ntwo\nthree\nby hand\n")
        self.assertEqual(outcome["pins"]["release"], "0.1.4-pre.1")
        self.assertEqual([commit["subject"] for commit in outcome["people"]], ["feat: started early"])
        self.assert_left_clean()


class NothingAhead(NextBranch):
    def test_no_branch_and_no_target_is_nothing_to_do(self):
        outcome = self.prepare(None)
        self.assertEqual(outcome["action"], "none")
        self.assertEqual(self.tools.calls, [])

    def test_a_branch_with_only_the_pin_move_is_removed(self):
        first = self.start(PRE1)
        outcome = self.prepare(None)
        self.assertEqual(outcome["action"], "delete")
        self.assertEqual(outcome["next"], first["sha"], "the lease for the delete")
        self.assertIn("nothing but the pin move is on it", outcome["reason"])
        self.assertEqual(self.repo.origin_next(), first["sha"], "preparing deletes nothing")

    def test_a_branch_with_a_persons_commit_is_left_alone(self):
        self.start(PRE1)
        person = self.repo.on_next("feat: use the new field", MORE)
        outcome = self.prepare(None)
        self.assertEqual(outcome["action"], "leave")
        self.assertEqual([commit["subject"] for commit in outcome["people"]], ["feat: use the new field"])
        self.assertEqual(self.repo.origin_next(), person)

    def test_a_branch_whose_pull_request_was_merged_is_removed_whatever_is_on_it(self):
        self.start(PRE1)
        self.repo.on_next("feat: use the new field", MORE)
        outcome = self.prepare(None, spent=True)
        self.assertEqual(outcome["action"], "delete")
        self.assertIn("its pull request was merged", outcome["reason"])


class Spent(NextBranch):
    """The pull request from `next` was merged, and upstream already has a newer target."""

    def test_it_starts_again_from_main_without_the_commits_main_already_has(self):
        self.start(STABLE)
        person = self.repo.on_next("feat: use the new field", MORE)
        # A squash merge: one commit on main with everything `next` had.
        self.repo.git("merge", "-q", "--squash", "origin/next")
        self.repo.commit("fix: move to OpenShell 0.1.4 (#12)")
        self.repo.git("push", "-q", "origin", "main")
        self.repo.git("fetch", "-q", "origin")

        outcome = self.prepare(support.target("0.1.5-pre.1"), spent=True, pinned=ON_0_1_4)
        self.assertEqual(outcome["action"], "update")
        self.assertEqual(outcome["next"], person)
        self.assertEqual(self.subjects(outcome["sha"]), ["fix: move to OpenShell 0.1.5-pre.1"])
        self.assertEqual(outcome["people"], [])
        self.assertIn("its pull request was merged", outcome["reason"])
        self.assertEqual(self.repo.read("app.txt", outcome["sha"]), MORE["app.txt"], "main has their work")

    def test_after_a_rebase_merge_the_commits_drop_out_without_being_told(self):
        self.start(STABLE)
        self.repo.on_next("feat: use the new field", MORE)
        # Rebase and merge: the same patches on main, under new commit ids.
        self.repo.git("checkout", "-q", "-B", "landing", "origin/main")
        self.repo.git("-c", "user.name=Merge Button", "-c", "user.email=m@example.com", "cherry-pick", "origin/main..origin/next")
        self.repo.git("push", "-q", "origin", "landing:main")
        self.repo.git("checkout", "-q", "main")
        self.repo.git("fetch", "-q", "origin")
        self.repo.git("reset", "-q", "--hard", "origin/main")
        self.assertNotEqual(self.repo.rev("origin/main"), self.repo.rev("origin/next"))

        outcome = self.prepare(support.target("0.1.5-pre.1"), pinned=ON_0_1_4)
        self.assertEqual(outcome["action"], "update")
        self.assertEqual(self.subjects(outcome["sha"]), ["fix: move to OpenShell 0.1.5-pre.1"])


class WhatStopsIt(NextBranch):
    def test_a_tool_that_writes_outside_the_pin_files_is_not_committed(self):
        with self.assertRaises(nextbranch.GitError) as caught:
            self.prepare(PRE1, support.FakeTools(stray="left-behind.txt"))
        self.assertIn("backend/left-behind.txt", str(caught.exception))
        self.assertIsNone(self.repo.origin_next())
        self.assert_left_clean()

    def test_a_failing_pin_move_leaves_nothing_behind(self):
        with self.assertRaises(pinmove.PinMoveError):
            self.prepare(PRE1, support.FakeTools(fail=("go", "get")))
        self.assert_left_clean()

    def test_a_lock_file_that_cannot_be_regenerated_aborts_the_rebase(self):
        self.start(PRE1)
        person = self.two_dependencies()
        with self.assertRaises(pinmove.PinMoveError):
            self.prepare(PRE1, support.FakeTools(fail=("go", "mod", "tidy")))
        self.assertEqual(self.repo.origin_next(), person)
        self.assert_left_clean()

    def test_git_settings_of_whoever_runs_it_do_not_reach_the_commit(self):
        # A signing key that does not exist would fail the commit.
        self.repo.git("config", "commit.gpgsign", "true")
        self.repo.git("config", "user.signingkey", "no-such-key")
        self.repo.git("config", "user.name", "Somebody Else")
        outcome = self.prepare(PRE1)
        self.assertEqual(self.repo.git("log", "-1", "--format=%an", outcome["sha"]), "github-actions[bot]")


if __name__ == "__main__":
    unittest.main()
