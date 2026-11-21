import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "eval-compare.py"
FIXTURES = HERE / "fixtures"

# The repo has no .gitignore, so keep scripts/__pycache__ from appearing.
sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("eval_compare", SCRIPT)
ec = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ec)

MAIN_CLASSES = (
    "c1-alpha\tguard,model-default\n"
    "c2-bravo\tguard\n"
    "c3-charlie\tguard\n"
    "c4-delta\tclimb\n"
    "c5-echo\tclimb,held-out\n"
)


def load(name):
    return json.loads((FIXTURES / name).read_text())


def make_result(cases, cost):
    template = load("compare-base.json")
    case0 = template["cases"][0]
    run0 = case0["arms"]["with"][0]
    data = copy.deepcopy(template)
    data["costUsd"] = cost
    data["cases"] = []
    for name, scores in cases.items():
        case = copy.deepcopy(case0)
        case["name"] = name
        case["dir"] = "evals/" + name
        case["runsPerCase"] = len(scores)
        case["arms"] = {"with": [dict(copy.deepcopy(run0), score=s) for s in scores], "without": []}
        data["cases"].append(case)
    return data


class CliTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def write(self, name, content):
        path = self.tmp / name
        path.write_text(content if isinstance(content, str) else json.dumps(content))
        return str(path)

    def fixture(self, name):
        return str(FIXTURES / name)

    def cli(self, *args):
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=60
        )

    def main_line_args(self, head=None, rerun_head=None, exit_codes="0 0 0 0"):
        return [
            "line", "--suite", "core", "--suite-hash", "abc1234", "--model", "opus",
            "--base-ref", "1111111", "--head-ref", "2222222",
            "--classes", self.write("classes.tsv", MAIN_CLASSES),
            "--base", self.fixture("compare-base.json"),
            "--head", head or self.fixture("compare-head.json"),
            "--rerun-base", self.fixture("compare-rerun-base.json"),
            "--rerun-head", rerun_head or self.fixture("compare-rerun-head.json"),
            "--exit-codes", exit_codes,
        ]


class StatsTest(unittest.TestCase):
    def test_fisher_values(self):
        for args, want in [
            ((6, 6, 2, 6), 0.030),
            ((6, 6, 3, 6), 0.091),
            ((6, 6, 5, 6), 0.50),
            ((6, 6, 1, 6), 0.008),
        ]:
            with self.subTest(args=args):
                self.assertAlmostEqual(ec.fisher_one_sided(*args), want, delta=0.001)

    def test_run_passed_needs_score_one(self):
        self.assertFalse(ec.run_passed({"score": 0.67, "passed": True, "error": None}))
        self.assertTrue(ec.run_passed({"score": 1, "passed": True, "error": None}))

    def test_format_p(self):
        for p, want in [(0.0303, "0.03"), (0.00758, "0.008"), (0.5, "0.50"), (1.0, "1.00")]:
            with self.subTest(p=p):
                self.assertEqual(ec.format_p(p), want)

    def test_permutation(self):
        same = {"x": [0.2, 0.6, 1.0], "y": [0.0, 1.0, 1.0]}
        self.assertEqual(ec.permutation_p(same, copy.deepcopy(same)), 1.0)
        base = {"x": [0.0, 0.5, 1.0, 0.5, 0.0], "y": [1.0, 0.0, 0.0, 0.5, 0.5]}
        head = {"x": [1.0, 0.5, 1.0, 1.0, 0.5], "y": [1.0, 0.5, 1.0, 0.0, 1.0]}
        self.assertEqual(ec.permutation_p(base, head), ec.permutation_p(base, head))
        zeros = {"x": [0.0] * 5, "y": [0.0] * 5}
        ones = {"x": [1.0] * 5, "y": [1.0] * 5}
        self.assertLess(ec.permutation_p(zeros, ones), 0.01)

    def test_permutation_is_two_sided(self):
        # Pool of four 1s and four 0s: |head mean - base mean| >= 0.5 unless the 1s split 2:2,
        # so the exact p is (1 + 16 + 16 + 1) / 70. A one-sided test would give 17 / 70.
        p = ec.permutation_p({"x": [0, 0, 1, 0]}, {"x": [1, 1, 1, 0]})
        self.assertAlmostEqual(p, 34 / 70, delta=0.02)


class LineTest(CliTest):
    def test_line_grammar(self):
        res = self.cli(*self.main_line_args(), "--covers", "C9 C10")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(
            res.stdout,
            "Eval: core-suite abc1234, merge-base 1111111 -> head 2222222, opus, "
            "3/5 runs per guard/climb case: "
            "guard 2/2 -> 1/2 (+1 model-default; C3 rerun 6/6 -> 1/6, Fisher p=0.008, regression); "
            "climb 0.25 -> 0.35 (+0.10, p=1.00, within noise); "
            "run errors 0/1; $3.60; cases for this change: C9 C10\n",
        )

    def test_line_rules_fallback(self):
        res = self.cli(*self.main_line_args(), "--rules-fallback")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn(", opus, rules via system prompt, 3/5 runs", res.stdout)
        self.assertTrue(res.stdout.rstrip().endswith("run errors 0/1; $3.60"))

    def test_line_clean_guards_and_climb_gain(self):
        classes = self.write("k.tsv", "k1-alpha\tclimb\nk2-bravo\tclimb\nk3-charlie\tguard\n")
        def arm(score):
            return make_result({"k1-alpha": [score] * 5, "k2-bravo": [score] * 5,
                                "k3-charlie": [1, 1, 1]}, 1.0)

        base = self.write("b.json", arm(0))
        head = self.write("h.json", arm(1))
        res = self.cli(
            "line", "--suite", "coo", "--suite-hash", "def5678", "--model", "opus",
            "--aa", "3333333", "--classes", classes, "--base", base, "--head", head,
            "--exit-codes", "0 0",
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(
            res.stdout,
            "Eval: coo-suite def5678, A/A 3333333, opus, 3/5 runs per guard/climb case: "
            "guard 1/1 -> 1/1; climb 0.00 -> 1.00 (+1.00, p=0.000); run errors 0/0; $2.00\n",
        )

    def test_partial_no_line(self):
        head = load("compare-head.json")
        partial = dict(head, partial=True)
        skipped = load("compare-rerun-head.json")
        skipped["cases"][0]["arms"]["with"][2]["skippedPaidGraders"] = True
        missing = dict(head, cases=head["cases"][:-1])
        for label, kwargs in [
            ("exit 1", {"exit_codes": "0 1 0 0"}),
            ("exit 2", {"exit_codes": "0 0 2 0"}),
            ("partial", {"head": self.write("p.json", partial)}),
            ("skipped", {"rerun_head": self.write("s.json", skipped)}),
            ("missing case", {"head": self.write("m.json", missing)}),
        ]:
            with self.subTest(label):
                res = self.cli(*self.main_line_args(**kwargs))
                self.assertEqual(res.returncode, 3)
                self.assertTrue(res.stdout.startswith("partial: "), res.stdout)
                self.assertNotIn("Eval:", res.stdout + res.stderr)

    def test_unresolved(self):
        guards = ["k1-alpha", "k2-bravo", "k3-charlie", "k4-delta"]
        classes = self.write(
            "k.tsv", "".join(g + "\tguard\n" for g in guards) + "k5-echo\tclimb,held-out\n"
        )
        base = {g: [1, 1, 1] for g in guards}
        head = {g: [1, 1, 0] for g in guards}
        base["k5-echo"] = head["k5-echo"] = [0] * 5
        args = [
            "line", "--suite", "coo", "--suite-hash", "def5678", "--model", "opus",
            "--aa", "3333333", "--classes", classes,
            "--base", self.write("a1.json", make_result(base, 2.0)),
            "--head", self.write("a2.json", make_result(head, 2.0)),
            "--rerun-base",
        ]
        args += [self.write(g + "-b.json", make_result({g: [1] * 6}, 0.25)) for g in guards[:3]]
        args.append("--rerun-head")
        for g in guards[:3]:
            result = make_result({g: [1, 1, 1, 1, 1, 0]}, 0.25)
            if g == "k1-alpha":
                result["cases"][0]["arms"]["with"][5]["error"] = "Reached the turn limit (30)"
            args.append(self.write(g + "-h.json", result))
        res = self.cli(*args, "--exit-codes", "0 0 0 0 0 0 0 0")
        self.assertEqual(res.returncode, 0, res.stderr)
        rerun = "rerun 6/6 -> 5/6, Fisher p=0.50, not significant"
        self.assertEqual(
            res.stdout,
            "Eval: coo-suite def5678, A/A 3333333, opus, 3/5 runs per guard/climb case: "
            f"guard 4/4 -> 3/4 (K1 {rerun}; K2 {rerun}; K3 {rerun}; unresolved: K4); "
            "climb 0.00 -> 0.00 (+0.00, p=1.00, within noise); run errors 0/1; $5.50\n",
        )


class DropsTest(CliTest):
    def test_drops_main_fixtures(self):
        res = self.cli(
            "drops", "--classes", self.write("classes.tsv", MAIN_CLASSES),
            "--base", self.fixture("compare-base.json"), "--head", self.fixture("compare-head.json"),
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout, "c3-charlie\n")

    def test_drops_counted_guards_in_case_order(self):
        classes = self.write(
            "k.tsv",
            "k1-alpha\tguard\nk2-bravo\tguard,model-default\nk3-charlie\tclimb\n"
            "k4-delta\tguard\nk5-echo\tguard\n",
        )
        names = ["k5-echo", "k4-delta", "k3-charlie", "k2-bravo", "k1-alpha"]
        base = make_result({n: [1, 1, 1] for n in names}, 1.0)
        head = make_result({n: [1, 1, 1] if n == "k4-delta" else [1, 0, 1] for n in names}, 1.0)
        res = self.cli(
            "drops", "--classes", classes,
            "--base", self.write("b.json", base), "--head", self.write("h.json", head),
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout, "k1-alpha\nk5-echo\n")


class NoPluginTest(CliTest):
    def run_no_plugin(self, path):
        return self.cli(
            "no-plugin", "--classes", self.write("classes.tsv", MAIN_CLASSES), "--json", path
        )

    def test_no_plugin_lists_guards_that_passed_every_without_run(self):
        res = self.run_no_plugin(self.fixture("compare-no-plugin.json"))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout, "c1-alpha\nc3-charlie\n")

    def test_no_plugin_needs_a_without_run(self):
        data = load("compare-no-plugin.json")
        data["cases"][0]["arms"]["without"] = []
        res = self.run_no_plugin(self.write("np.json", data))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(res.stdout, "c3-charlie\n")

    def test_no_plugin_partial(self):
        data = dict(load("compare-no-plugin.json"), partial=True)
        res = self.run_no_plugin(self.write("np.json", data))
        self.assertEqual(res.returncode, 3)
        self.assertTrue(res.stdout.startswith("partial: "), res.stdout)


class MergeTest(CliTest):
    def test_merge_replaces_cases(self):
        into = self.write("a2.json", load("compare-base.json"))
        extra = make_result({"c6-foxtrot": [1, 1, 1]}, 0.30)
        res = self.cli(
            "merge", "--into", into,
            "--from", self.fixture("compare-rerun-head.json"), self.write("x.json", extra),
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        merged = json.loads(Path(into).read_text())
        self.assertEqual(
            [c["name"] for c in merged["cases"]],
            ["c1-alpha", "c2-bravo", "c3-charlie", "c4-delta", "c5-echo", "c6-foxtrot"],
        )
        scores = {c["name"]: [r["score"] for r in c["arms"]["with"]] for c in merged["cases"]}
        self.assertEqual(scores["c3-charlie"], [1, 0.67, 0, 0.67, 0, 0])
        self.assertEqual(scores["c4-delta"], [0, 0, 0, 0, 0])
        self.assertAlmostEqual(merged["costUsd"], 1.25 + 0.45 + 0.30)
        self.assertFalse(merged["partial"])

    def test_merge_keeps_partial(self):
        into = self.write("a1.json", load("compare-base.json"))
        source = dict(load("compare-rerun-head.json"), partial=True)
        res = self.cli("merge", "--into", into, "--from", self.write("r.json", source))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(json.loads(Path(into).read_text())["partial"])


if __name__ == "__main__":
    unittest.main()
