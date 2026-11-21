import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHECKER = HERE.parent / "check-graders.mjs"
CASES = HERE / "fixtures" / "cases"


def run_checker(*dirs, env=None):
    return subprocess.run(
        ["node", str(CHECKER), *map(str, dirs)],
        capture_output=True,
        text=True,
        timeout=300,
        env=env,
    )


class CheckGradersTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)

    def good_copy(self):
        case = self.tmp / "good-case"
        shutil.copytree(CASES / "good-case", case)
        return case

    def failure_lines(self, result):
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        lines = result.stdout.splitlines()
        self.assertNotIn("OK", lines)
        self.assertTrue(lines, result.stderr)
        return lines

    def test_good_case_prints_ok(self):
        result = run_checker(CASES / "good-case")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "OK")

    def test_max0_pattern_its_match_sample_misses_fails_naming_the_grader(self):
        lines = self.failure_lines(run_checker(CASES))
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("never-matches", lines[0])
        self.assertIn("no-amend", lines[0])

    def test_pattern_without_miss_sample_fails(self):
        case = self.good_copy()
        checks = json.loads((case / "checks.json").read_text())
        del checks["no-cat"]["miss"]
        (case / "checks.json").write_text(json.dumps(checks))
        lines = self.failure_lines(run_checker(case))
        self.assertEqual(len(lines), 1, lines)
        self.assertIn("no-cat", lines[0])
        self.assertIn("miss", lines[0])

    def test_case_with_patterns_and_no_checks_json_fails(self):
        case = self.good_copy()
        (case / "checks.json").unlink()
        lines = self.failure_lines(run_checker(case))
        self.assertTrue(any("checks.json" in line for line in lines), lines)

    def test_bad_checks_json_fails_naming_the_file(self):
        case = self.good_copy()
        (case / "checks.json").write_text('{"no-cat": ')
        lines = self.failure_lines(run_checker(case))
        self.assertTrue(any("checks.json" in line for line in lines), lines)

    def test_fixture_that_exits_1_fails(self):
        case = self.good_copy()
        (case / "fixture.sh").write_text("#!/bin/sh\nexit 1\n")
        lines = self.failure_lines(run_checker(case))
        self.assertTrue(
            any("good-case" in line and "fixture.sh" in line and "exit" in line for line in lines),
            lines,
        )

    def test_fixture_runs_in_bare_environment(self):
        case = self.good_copy()
        with (case / "fixture.sh").open("a") as script:
            script.write('[ -z "${EVAL_LEAK-}" ] || exit 7\n[ "$TERM" = dumb ] || exit 8\n')
            script.write('[ "$HOME" != "$PWD" ] || exit 9\n')
        env = dict(os.environ, EVAL_LEAK="1", TERM="xterm")
        result = run_checker(case, env=env)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_fixture_commit_needs_a_repo_local_git_identity(self):
        case = self.good_copy()
        with (case / "fixture.sh").open("a") as script:
            script.write("git init -q -b main\ngit add -A\ngit commit -q -m 'Initial commit'\n")
        lines = self.failure_lines(run_checker(case))
        self.assertTrue(any("fixture.sh" in line for line in lines), lines)

        text = (case / "fixture.sh").read_text().replace(
            "git add -A\n",
            "git config user.name evalproj\ngit config user.email evalproj@example.invalid\ngit add -A\n",
        )
        (case / "fixture.sh").write_text(text)
        result = run_checker(case)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_flags_with_g_do_not_throw(self):
        case = self.good_copy()
        grader = case / "graders" / "marker-kept.md"
        grader.write_text(grader.read_text().replace("flags: m\n", "flags: gm\n"))
        result = run_checker(case)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "OK")

    def test_folder_with_no_cases_fails(self):
        (self.tmp / "empty").mkdir()
        self.failure_lines(run_checker(self.tmp / "empty"))

    def test_no_arguments_fails(self):
        result = run_checker()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("OK", result.stdout.splitlines())
        self.assertIn("usage", result.stderr.lower())

    def test_unknown_grader_key_fails(self):
        case = self.good_copy()
        grader = case / "graders" / "no-cat.md"
        grader.write_text(grader.read_text().replace("input_match:", "input-match:"))
        lines = self.failure_lines(run_checker(case))
        self.assertTrue(any("no-cat" in line and "input-match" in line for line in lines), lines)

    def test_yaml_it_would_read_differently_is_refused(self):
        variants = {
            "flow mapping": ("target:\n  source: file\n  path: src/app.js\n",
                             "target: { source: file, path: src/app.js }\n"),
            "unknown double-quote escape": ("pattern: '^export const LIMIT = 3;$'\n",
                                            'pattern: "^export const LIMIT = \\d;$"\n'),
            "trailing comment": ("flags: m\n", "flags: m #multiline\n"),
            "plain scalar with a colon": ("flags: m\n", "flags: m: g\n"),
            "block scalar": ("flags: m\n", "flags: |\n  m\n"),
            "nested mapping": ("  path: src/app.js\n", "  path:\n    name: src/app.js\n"),
        }
        for label, (old, new) in variants.items():
            with self.subTest(label):
                case = self.tmp / label.replace(" ", "-") / "good-case"
                shutil.copytree(CASES / "good-case", case)
                grader = case / "graders" / "marker-kept.md"
                text = grader.read_text()
                self.assertIn(old, text)
                grader.write_text(text.replace(old, new))
                result = run_checker(case)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertTrue(
                    any("marker-kept" in line for line in result.stdout.splitlines()),
                    result.stdout + result.stderr,
                )


if __name__ == "__main__":
    unittest.main()
