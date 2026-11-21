import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
FAKE = HERE / "fake-claude"
EVALS = "plugins/core/evals"
CASES = {"c1-alpha": ("guard", 3), "c2-bravo": ("guard", 3), "c3-charlie": ("climb", 5)}
BLANKED = (
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
    "CLAUDE_EFFORT",
    "MAX_THINKING_TOKENS",
)


def opt(argv, name):
    return argv[argv.index(name) + 1] if name in argv else None


class EvalCompareShTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name).resolve()
        self.home = self.tmp / "home"
        self.repo = self.home / "repo"
        self.config = self.tmp / "config"
        self.log = self.tmp / "fake.log"
        self.config.mkdir()
        # A first-on-PATH claude that fails, so a script bug can never reach the real CLI.
        guard = self.tmp / "guard-bin"
        guard.mkdir()
        (guard / "claude").write_text("#!/bin/sh\necho 'the real claude was called' >&2\nexit 99\n")
        (guard / "claude").chmod(0o755)
        self.env = {
            "PATH": f"{guard}:{os.environ['PATH']}",
            "HOME": str(self.home),
            "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
            "CLAUDE_CONFIG_DIR": str(self.config),
            "CLAUDE_BIN": str(FAKE),
            "FAKE_CLAUDE_LOG": str(self.log),
        }
        (self.repo / "scripts").mkdir(parents=True)
        for name in ("eval-compare.sh", "eval-compare.py"):
            shutil.copy2(SCRIPTS / name, self.repo / "scripts" / name)
        self.git("init", "-q", "-b", "main")
        self.write_suite("v1")
        self.write("fake-scores.json", "{}\n")
        self.base = self.commit("base")
        self.write("fake-scores.json", json.dumps({"c2-bravo": [1, 0, 1]}) + "\n")
        self.write(f"{EVALS}/c1-alpha/prompt.md", "---\nruns: 3\n---\n\nEdited by the change under test.\n")
        self.write(f"{EVALS}/c9-extra/case.yaml", "name: c9-extra\n")
        self.head = self.commit("head")
        self.git("switch", "-q", "-c", "suite", self.base)
        self.write_suite("v2")
        self.suite = self.commit("suite v2")
        self.git("switch", "-q", "main")
        self.git("update-ref", "refs/remotes/origin/main", self.suite)

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), "-c", "user.name=Test", "-c", "user.email=test@example.com", *args],
            env=self.env, check=True, capture_output=True, text=True,
        ).stdout.strip()

    def write(self, rel, text):
        target = self.repo / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def write_suite(self, version):
        self.write(f"{EVALS}/scaffold.sh", f"#!/bin/sh\necho scaffold {version}\n")
        self.write(f"{EVALS}/classes.tsv", "".join(f"{n}\t{tag}\n" for n, (tag, _) in CASES.items()))
        for name, (_, runs) in CASES.items():
            self.write(f"{EVALS}/{name}/case.yaml", f'schema_version: "1.1"\nname: {name}\n')
            self.write(f"{EVALS}/{name}/prompt.md", f"---\nruns: {runs}\n---\n\nPrompt for {name}, suite {version}.\n")
        self.write("evals/stub-workers/hooks/stub.sh", f"echo stub {version}\n")

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def suite_variant(self, label, rel, text):
        self.git("switch", "-q", "-c", label, "suite")
        self.write(rel, text)
        sha = self.commit(label)
        self.git("switch", "-q", "main")
        return sha

    def env_with(self, extra):
        return dict(self.env, **(extra or {}))

    def run_sh(self, *args, env=None):
        return subprocess.run(
            [str(self.repo / "scripts" / "eval-compare.sh"), *args],
            env=self.env_with(env), cwd=self.tmp, capture_output=True, text=True, timeout=120,
        )

    def calls(self, log=None):
        log = log or self.log
        self.assertTrue(log.exists(), "the fake was never called")
        return [json.loads(line) for line in log.read_text().splitlines()]

    def eval_calls(self, log=None):
        return [c for c in self.calls(log) if "plugin" in c["argv"]]

    def results_dir(self, res):
        found = re.search(r"^eval-compare: results: (.+)$", res.stderr, re.M)
        self.assertIsNotNone(found, res.stderr)
        return Path(found.group(1))

    def assert_line(self, res, prefix="Eval: core-suite "):
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        last = res.stdout.strip().splitlines()[-1]
        self.assertTrue(last.startswith(prefix), last)
        return last

    def assert_clean(self, results=None):
        listed = self.git("worktree", "list", "--porcelain")
        trees = [line for line in listed.splitlines() if line.startswith("worktree ")]
        self.assertEqual(trees, [f"worktree {self.repo}"])
        if results:
            self.assertFalse((results / "trees").exists())

    def files_at(self, ref):
        names = self.git("ls-tree", "-r", "--name-only", ref, "--", EVALS, "evals").splitlines()
        return {n: self.git("show", f"{ref}:{n}") + "\n" for n in names}

    def test_every_call_has_cap_and_no_publish(self):
        res = self.run_sh("core", self.base, self.head)
        last = self.assert_line(res)
        self.assertIn("C2 rerun 6/6 -> 4/6, Fisher p=0.23, not significant", last)
        calls = self.eval_calls()
        self.assertEqual(len(calls), 4)
        for call in calls:
            argv = call["argv"]
            self.assertEqual(argv[0], "--settings")
            self.assertEqual(argv[2:4], ["plugin", "eval"])
            for flag in ("--no-publish", "--scaffold", "--trust-plugin"):
                self.assertIn(flag, argv)
            at = argv.index("--allow-tools")
            self.assertEqual(argv[at + 1:at + 4], ["Bash", "Edit", "Write"])
            self.assertEqual(opt(argv, "--threshold"), "0")
            self.assertEqual(opt(argv, "--model"), "opus")
            self.assertEqual(opt(argv, "--ablation"), "none")
            self.assertEqual(opt(argv, "-j"), "1")
            for flag in ("--json", "--report", "--output-dir"):
                self.assertIsNotNone(opt(argv, flag))
        for call in calls[:2]:
            self.assertEqual(opt(call["argv"], "--max-cost-usd"), "13")
            self.assertNotIn("--runs", call["argv"])
            self.assertNotIn("--case", call["argv"])
        for call in calls[2:]:
            self.assertEqual(opt(call["argv"], "--max-cost-usd"), "4")
            self.assertEqual(opt(call["argv"], "--case"), "c2-bravo")
            self.assertEqual(opt(call["argv"], "--runs"), "6")

    def test_call_targets_tree_root(self):
        res = self.run_sh("core", self.base, self.head)
        self.assert_line(res)
        results = self.results_dir(res)
        calls = self.eval_calls()
        for call, sha in zip(calls, [self.base, self.head, self.base, self.head]):
            target = call["argv"][4]
            self.assertEqual(os.path.realpath(call["toplevel"]), os.path.realpath(target))
            self.assertEqual(call["head"], sha)
            self.assertEqual(opt(call["argv"], "--eval-dir"), EVALS)
            self.assertTrue(Path(target).is_relative_to(results))
        self.assert_clean(results)

    def test_run_settings_blank_user_env(self):
        user_env = {name: "user-value" for name in BLANKED}
        user_env.update(ANTHROPIC_API_KEY="sk-test-value", UNRELATED_SETTING="x", PATH="/usr/bin:/bin")
        (self.config / "settings.json").write_text(json.dumps({"env": user_env}))
        shell = {name: "shell-value" for name in BLANKED}
        shell.update(ANTHROPIC_MODEL="shell-value", ANTHROPIC_AUTH_TOKEN="tok-value")
        res = self.run_sh("core", self.base, self.head, env=shell)
        self.assert_line(res)
        results = self.results_dir(res)
        calls = self.eval_calls()
        self.assertEqual({c["argv"][1] for c in calls}, {str(results / "run-settings.json")})
        text = (results / "run-settings.json").read_text()
        self.assertNotIn("sk-test-value", text)
        env = json.loads(text)["env"]
        for name in BLANKED:
            self.assertEqual(env[name], "", name)
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertNotIn("UNRELATED_SETTING", env)
        if sys.platform == "darwin":
            first, _, rest = env["PATH"].partition(":")
            self.assertEqual(rest, "/usr/bin:/bin")
            self.assertNotEqual(Path(first).name, "bin")
            self.assertTrue(Path(first).is_relative_to(self.home))
            version = subprocess.run([str(Path(first) / "git"), "--version"], capture_output=True, text=True)
            self.assertEqual(version.returncode, 0)
        else:
            self.assertNotIn("PATH", env)
        for call in self.calls():
            for name in (*BLANKED, "ANTHROPIC_MODEL"):
                self.assertNotIn(name, call["env"])
            self.assertIn("ANTHROPIC_AUTH_TOKEN", call["env"])
        meta = (results / "meta.txt").read_text()
        for name in ("CLAUDE_CODE_SUBAGENT_MODEL", "MAX_THINKING_TOKENS", "ANTHROPIC_API_KEY"):
            self.assertIn(name, meta)
        for value in ("user-value", "shell-value", "sk-test-value", "tok-value"):
            self.assertNotIn(value, meta)

    def test_reuse_base_refused_on_hash_change(self):
        aa = self.run_sh("core", "--aa", self.base)
        self.assertIn(", A/A ", self.assert_line(aa))
        aa_dir = str(self.results_dir(aa))
        mismatches = {
            "case": (["--suite-ref", self.suite_variant("v-case", f"{EVALS}/c1-alpha/prompt.md", "changed\n")], {}, "c1-alpha"),
            "scaffold": (["--suite-ref", self.suite_variant("v-scaffold", f"{EVALS}/scaffold.sh", "changed\n")], {}, "shared"),
            "stub": (["--suite-ref", self.suite_variant("v-stub", "evals/stub-workers/hooks/stub.sh", "changed\n")], {}, "shared"),
            "cli": ([], {"FAKE_CLAUDE_VERSION": "9.9.9 (Claude Code)"}, "claude version"),
        }
        for label, (extra, env, needle) in mismatches.items():
            with self.subTest(label):
                before = len(self.eval_calls())
                res = self.run_sh("core", self.base, self.head, "--reuse-base", aa_dir, *extra, env=env)
                self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
                self.assertIn(needle, res.stderr)
                self.assertEqual(len(self.eval_calls()), before)
        with self.subTest("base commit"):
            before = len(self.eval_calls())
            res = self.run_sh("core", self.head, self.head, "--reuse-base", aa_dir)
            self.assertEqual(res.returncode, 2)
            self.assertIn("base commit", res.stderr)
            self.assertEqual(len(self.eval_calls()), before)
        with self.subTest("match"):
            before = len(self.eval_calls())
            res = self.run_sh("core", self.base, self.head, "--reuse-base", aa_dir)
            self.assert_line(res)
            new = self.eval_calls()[before:]
            self.assertEqual([c["head"] for c in new], [self.head, self.base, self.head])
            results = self.results_dir(res)
            self.assertEqual(
                json.loads((results / "base.json").read_text()),
                json.loads((Path(aa_dir) / "a2.json").read_text()),
            )
            self.assert_clean(results)

    def test_results_dir_inside_repo_refused(self):
        for label, cache, needle in (
            ("inside the repo", self.repo / "cache", "inside the repo"),
            ("outside the home", self.tmp / "elsewhere", "HOME"),
        ):
            with self.subTest(label):
                res = self.run_sh("core", self.base, self.head, env={"XDG_CACHE_HOME": str(cache)})
                self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
                self.assertIn(needle, res.stderr)
                self.assertFalse(cache.exists())
                self.assertEqual(self.eval_calls(), [])
                self.assert_clean()

    def test_suite_copied_from_suite_ref(self):
        res = self.run_sh("core", self.base, self.head)
        self.assert_line(res)
        expected = self.files_at(self.suite)
        self.assertIn("suite v2", expected[f"{EVALS}/c1-alpha/prompt.md"])
        for call in self.eval_calls():
            self.assertEqual(call["files"], expected)
            self.assertNotIn("c9-extra", call["cases"])
        before = len(self.eval_calls())
        res = self.run_sh("core", self.base, self.head, "--suite-ref", self.base)
        self.assert_line(res)
        for call in self.eval_calls()[before:]:
            self.assertEqual(call["files"], self.files_at(self.base))

    def test_no_plugin_runs_guards_without_agent(self):
        scores = json.dumps({"without": {"c2-bravo": [1, 0, 1]}})
        res = self.run_sh("core", "--no-plugin", self.base, env={"FAKE_CLAUDE_SCORES": scores})
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertEqual(res.stdout.split(), ["c1-alpha"])
        calls = self.eval_calls()
        self.assertEqual(len(calls), 1)
        argv = calls[0]["argv"]
        self.assertEqual(opt(argv, "--ablation"), "with-without")
        self.assertEqual(opt(argv, "--disallow-tools"), "Agent")
        self.assertEqual(opt(argv, "--max-cost-usd"), "8")
        self.assertIn("--no-publish", argv)
        self.assertEqual(calls[0]["cases"], ["c1-alpha", "c2-bravo"])
        self.assert_clean(self.results_dir(res))
        res = self.run_sh("coo", "--no-plugin", self.base)
        self.assertEqual(res.returncode, 2)
        self.assertEqual(len(self.eval_calls()), 1)

    def test_update_refuses_second_update_and_five_cases(self):
        aa = self.run_sh("core", "--aa", self.base)
        self.assert_line(aa)
        aa_dir = self.results_dir(aa)
        changed = self.suite_variant("v-climb", f"{EVALS}/c3-charlie/prompt.md", "---\nruns: 5\n---\n\nChanged.\n")
        refusals = (
            ("five cases", ["--cases", "c1-alpha c2-bravo c3-charlie c1-alpha c2-bravo"], "at most 4"),
            ("unlisted change", ["--suite-ref", changed, "--cases", "c1-alpha"], "c3-charlie"),
        )
        for label, extra, needle in refusals:
            with self.subTest(label):
                before = len(self.eval_calls())
                res = self.run_sh("core", "--aa", self.base, "--update", str(aa_dir), *extra)
                self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
                self.assertIn(needle, res.stderr)
                self.assertEqual(len(self.eval_calls()), before)
        before = len(self.eval_calls())
        a1_cost = json.loads((aa_dir / "a1.json").read_text())["costUsd"]
        args = ["core", "--aa", self.base, "--suite-ref", changed, "--update", str(aa_dir), "--cases", "c3-charlie"]
        self.assertIn(", A/A ", self.assert_line(self.run_sh(*args)))
        new = self.eval_calls()[before:]
        self.assertEqual(len(new), 2)
        for call in new:
            self.assertEqual(opt(call["argv"], "--case"), "c3-charlie")
            self.assertEqual(opt(call["argv"], "--max-cost-usd"), "4")
            self.assertNotIn("--runs", call["argv"])
        meta = (aa_dir / "meta.txt").read_text()
        self.assertIn("\nupdated=", meta)
        self.assertIn(f"case.c3-charlie={self.git('rev-parse', f'{changed}:{EVALS}/c3-charlie')}\n", meta)
        self.assertGreater(json.loads((aa_dir / "a1.json").read_text())["costUsd"], a1_cost)
        self.assert_clean(aa_dir)
        before = len(self.eval_calls())
        res = self.run_sh(*args)
        self.assertEqual(res.returncode, 2)
        self.assertIn("updated", res.stderr)
        self.assertEqual(len(self.eval_calls()), before)

    def test_failed_update_merges_nothing_and_can_be_retried(self):
        aa = self.run_sh("core", "--aa", self.base)
        self.assert_line(aa)
        aa_dir = self.results_dir(aa)
        changed = self.suite_variant("v-climb", f"{EVALS}/c3-charlie/prompt.md", "---\nruns: 5\n---\n\nChanged.\n")
        kept = {name: (aa_dir / name).read_text() for name in ("a1.json", "a2.json", "classes.tsv", "meta.txt")}
        args = ["core", "--aa", self.base, "--suite-ref", changed, "--update", str(aa_dir), "--cases", "c3-charlie"]
        res = self.run_sh(*args, env={"FAKE_CLAUDE_EXIT": "2"})
        self.assertEqual(res.returncode, 3, res.stdout + res.stderr)
        self.assertNotIn("Eval:", res.stdout)
        for name, text in kept.items():
            self.assertEqual((aa_dir / name).read_text(), text, name)
        self.assert_clean(aa_dir)
        self.assertIn(", A/A ", self.assert_line(self.run_sh(*args)))
        self.assertIn("\nupdated=c3-charlie\n", (aa_dir / "meta.txt").read_text())

    def test_update_stops_when_a_guard_fails(self):
        aa = self.run_sh("core", "--aa", self.base)
        self.assert_line(aa)
        aa_dir = self.results_dir(aa)
        scores = json.dumps({"c1-alpha": [1, 0, 1]})
        res = self.run_sh("core", "--aa", self.base, "--update", str(aa_dir), "--cases", "c1-alpha",
                          env={"FAKE_CLAUDE_SCORES": scores})
        self.assertEqual(res.returncode, 4, res.stdout + res.stderr)
        last = res.stdout.strip().splitlines()[-1]
        self.assertTrue(last.startswith("stop: "), last)
        self.assertIn("C1", last)
        self.assert_clean(aa_dir)

    def test_worktrees_removed_on_failure(self):
        for label, env, count in (
            ("exit 1", {"FAKE_CLAUDE_EXIT": "1"}, 1),
            ("exit 2", {"FAKE_CLAUDE_EXIT": "2"}, 1),
            ("exit 1 on the head arm", {"FAKE_CLAUDE_EXIT": "1", "FAKE_CLAUDE_EXIT_CALL": "2"}, 2),
        ):
            with self.subTest(label):
                log = self.tmp / f"fake-{label.replace(' ', '-')}.log"
                res = self.run_sh("core", self.base, self.head, env=dict(env, FAKE_CLAUDE_LOG=str(log)))
                self.assertNotEqual(res.returncode, 0)
                self.assertNotIn("Eval:", res.stdout)
                self.assertIn("partial:", res.stdout)
                self.assertEqual(len(self.eval_calls(log)), count)
                self.assert_clean(self.results_dir(res))

    def test_interrupt_cleans_up(self):
        for sig, code in ((signal.SIGINT, 130), (signal.SIGTERM, 143)):
            with self.subTest(sig.name):
                log = self.tmp / f"fake-{sig.name}.log"
                proc = subprocess.Popen(
                    [str(self.repo / "scripts" / "eval-compare.sh"), "core", "--aa", self.base],
                    env=self.env_with({"FAKE_CLAUDE_LOG": str(log), "FAKE_CLAUDE_BLOCK": "1"}),
                    cwd=self.tmp, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    start_new_session=True,
                )
                deadline = time.monotonic() + 60
                while not (log.exists() and "plugin" in log.read_text()):
                    self.assertLess(time.monotonic(), deadline, "the eval call never started")
                    time.sleep(0.1)
                if sig == signal.SIGINT:
                    os.killpg(proc.pid, sig)
                else:
                    proc.send_signal(sig)
                out, err = proc.communicate(timeout=60)
                self.assertEqual(proc.returncode, code, out + err)
                self.assertNotIn("Eval:", out)
                self.assert_clean(self.results_dir(subprocess.CompletedProcess([], code, out, err)))
                with self.assertRaises(ProcessLookupError):
                    os.kill(self.eval_calls(log)[0]["pid"], 0)


if __name__ == "__main__":
    unittest.main()
