#!/usr/bin/env python3
import argparse
import json
import math
import os
import random
import sys
from pathlib import Path

TIE_TOLERANCE = 1e-9


def run_passed(run):
    return run.get("score") == 1


def fisher_one_sided(base_pass, base_n, head_pass, head_n):
    passes = base_pass + head_pass
    fails = base_n + head_n - passes
    hits = sum(math.comb(passes, x) * math.comb(fails, head_n - x) for x in range(head_pass + 1))
    return hits / math.comb(base_n + head_n, head_n)


def mean(values):
    return sum(values) / len(values)


def permutation_p(base, head, draws=10000, seed=20261121):
    names = sorted(set(base) & set(head))
    pools = [(list(base[n]) + list(head[n]), len(base[n])) for n in names if base[n] and head[n]]
    if not pools:
        return 1.0
    observed = abs(mean([mean(pool[k:]) - mean(pool[:k]) for pool, k in pools]))
    rng = random.Random(seed)
    hits = 0
    for _ in range(draws):
        diffs = []
        for pool, k in pools:
            rng.shuffle(pool)
            diffs.append(mean(pool[k:]) - mean(pool[:k]))
        if abs(mean(diffs)) >= observed - TIE_TOLERANCE:
            hits += 1
    return (hits + 1) / (draws + 1)


def format_p(p):
    return f"{p:.3f}" if p < 0.01 else f"{p:.2f}"


def read_classes(path):
    classes = {}
    for line in Path(path).read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        name, _, tags = line.partition("\t")
        classes[name.strip()] = {t.strip() for t in tags.split(",") if t.strip()}
    return classes


def counted_guards(classes):
    return [n for n, tags in classes.items() if "guard" in tags and "model-default" not in tags]


def load_all(paths):
    return [(Path(p).name, json.loads(Path(p).read_text())) for p in paths]


def arm_runs(results, arm="with"):
    runs = {}
    for _, data in results:
        for case in data.get("cases", []):
            runs.setdefault(case["name"], []).extend(case.get("arms", {}).get(arm) or [])
    return runs


def passes(runs):
    return sum(1 for r in runs if run_passed(r))


def scores(runs):
    return [float(r.get("score") or 0) for r in runs]


def error_count(results):
    return sum(1 for runs in arm_runs(results).values() for r in runs if r.get("error") is not None)


def find_drops(classes, base_runs, head_runs):
    return [
        n for n in counted_guards(classes)
        if passes(head_runs.get(n, [])) < passes(base_runs.get(n, []))
    ]


def partial_reasons(exit_codes, results):
    reasons = []
    if any(exit_codes):
        reasons.append("exit codes " + " ".join(str(c) for c in exit_codes))
    for fname, data in results:
        if data.get("partial"):
            reasons.append(f"{fname} is partial")
        for case in data.get("cases", []):
            arms = case.get("arms", {}).values()
            if any(r.get("skippedPaidGraders") for runs in arms for r in runs or []):
                reasons.append(f"{fname} skipped paid graders in {case['name']}")
    return reasons


def case_id(name):
    return name.split("-", 1)[0].upper()


def runs_label(classes, results, kind):
    values = sorted({
        case["runsPerCase"]
        for _, data in results
        for case in data.get("cases", [])
        if kind in classes.get(case["name"], ())
    })
    return ",".join(str(v) for v in values) or "-"


def guard_part(classes, base_runs, head_runs, rerun_base, rerun_head):
    model_default = [n for n, tags in classes.items() if {"guard", "model-default"} <= tags]
    notes = [f"+{len(model_default)} model-default"] if model_default else []
    unresolved = []
    regressions = 0
    for name in find_drops(classes, base_runs, head_runs):
        b, h = rerun_base.get(name), rerun_head.get(name)
        if not b or not h:
            unresolved.append(case_id(name))
            continue
        p = fisher_one_sided(passes(b), len(b), passes(h), len(h))
        verdict = "not significant"
        if p < 0.05:
            regressions += 1
            verdict = "regression"
        notes.append(
            f"{case_id(name)} rerun {passes(b)}/{len(b)} -> {passes(h)}/{len(h)}, "
            f"Fisher p={format_p(p)}, {verdict}"
        )
    if unresolved:
        notes.append("unresolved: " + ", ".join(unresolved))
    n = len(counted_guards(classes))
    k = n - regressions - len(unresolved)
    return f"guard {n}/{n} -> {k}/{n}" + (f" ({'; '.join(notes)})" if notes else "")


def climb_part(classes, base_runs, head_runs):
    climbs = [n for n, tags in classes.items() if "climb" in tags]
    if not climbs:
        return "climb none"
    base = {n: scores(base_runs[n]) for n in climbs}
    head = {n: scores(head_runs[n]) for n in climbs}
    base_mean = mean([mean(v) for v in base.values()])
    head_mean = mean([mean(v) for v in head.values()])
    p = permutation_p(base, head)
    # + 0.0 turns -0.0 into 0.0, so a tiny drop prints +0.00, not -0.00.
    diff = round(head_mean - base_mean, 2) + 0.0
    noise = ", within noise" if p >= 0.05 else ""
    return f"climb {base_mean:.2f} -> {head_mean:.2f} ({diff:+.2f}, p={format_p(p)}{noise})"


def cmd_line(args):
    classes = read_classes(args.classes)
    base, head = load_all(args.base), load_all(args.head)
    rerun_base, rerun_head = load_all(args.rerun_base), load_all(args.rerun_head)
    base_all, head_all = base + rerun_base, head + rerun_head
    base_runs, head_runs = arm_runs(base), arm_runs(head)

    reasons = partial_reasons(args.exit_codes, base_all + head_all)
    for arm, runs in (("base", base_runs), ("head", head_runs)):
        reasons += [f"{n} missing from {arm}" for n in classes if not runs.get(n)]
    if reasons:
        print("partial: " + "; ".join(reasons))
        return 3

    arms = f"A/A {args.aa}" if args.aa else f"merge-base {args.base_ref} -> head {args.head_ref}"
    model = args.model + (", rules via system prompt" if args.rules_fallback else "")
    main_results = base + head
    runs = f"{runs_label(classes, main_results, 'guard')}/{runs_label(classes, main_results, 'climb')}"
    guard = guard_part(classes, base_runs, head_runs, arm_runs(rerun_base), arm_runs(rerun_head))
    climb = climb_part(classes, base_runs, head_runs)
    cost = sum(data.get("costUsd") or 0 for _, data in base_all + head_all)
    line = (
        f"Eval: {args.suite}-suite {args.suite_hash}, {arms}, {model}, "
        f"{runs} runs per guard/climb case: {guard}; {climb}; "
        f"run errors {error_count(base_all)}/{error_count(head_all)}; ${cost:.2f}"
    )
    if args.covers:
        line += f"; cases for this change: {args.covers}"
    print(line)
    return 0


def cmd_drops(args):
    classes = read_classes(args.classes)
    for name in find_drops(classes, arm_runs(load_all(args.base)), arm_runs(load_all(args.head))):
        print(name)
    return 0


def cmd_no_plugin(args):
    classes = read_classes(args.classes)
    results = load_all([args.json])
    reasons = partial_reasons([], results)
    if reasons:
        print("partial: " + "; ".join(reasons))
        return 3
    without = arm_runs(results, "without")
    for name, tags in classes.items():
        runs = without.get(name, [])
        if "guard" in tags and runs and all(run_passed(r) for r in runs):
            print(name)
    return 0


def cmd_merge(args):
    into = json.loads(Path(args.into).read_text())
    index = {case["name"]: i for i, case in enumerate(into["cases"])}
    for _, data in load_all(args.sources):
        for case in data.get("cases", []):
            if case["name"] in index:
                into["cases"][index[case["name"]]] = case
            else:
                index[case["name"]] = len(into["cases"])
                into["cases"].append(case)
        into["costUsd"] = (into.get("costUsd") or 0) + (data.get("costUsd") or 0)
        into["partial"] = bool(into.get("partial") or data.get("partial"))
    tmp = args.into + ".tmp"
    Path(tmp).write_text(json.dumps(into, indent=2) + "\n")
    os.replace(tmp, args.into)
    return 0


def exit_code_list(text):
    try:
        return [int(c) for c in text.split()]
    except ValueError:
        raise argparse.ArgumentTypeError(f"not a list of exit codes: {text!r}")


def parse_args(argv):
    parser = argparse.ArgumentParser(prog="eval-compare.py")
    sub = parser.add_subparsers(dest="command", required=True)

    line = sub.add_parser("line")
    line.add_argument("--suite", choices=["core", "coo"], required=True)
    line.add_argument("--suite-hash", required=True)
    line.add_argument("--model", required=True)
    line.add_argument("--base-ref")
    line.add_argument("--head-ref")
    line.add_argument("--aa")
    line.add_argument("--classes", required=True)
    line.add_argument("--base", nargs="+", required=True)
    line.add_argument("--head", nargs="+", required=True)
    line.add_argument("--rerun-base", nargs="*", default=[])
    line.add_argument("--rerun-head", nargs="*", default=[])
    line.add_argument("--exit-codes", type=exit_code_list, required=True)
    line.add_argument("--rules-fallback", action="store_true")
    line.add_argument("--covers")
    line.set_defaults(func=cmd_line)

    drops = sub.add_parser("drops")
    drops.add_argument("--classes", required=True)
    drops.add_argument("--base", nargs="+", required=True)
    drops.add_argument("--head", nargs="+", required=True)
    drops.set_defaults(func=cmd_drops)

    no_plugin = sub.add_parser("no-plugin")
    no_plugin.add_argument("--classes", required=True)
    no_plugin.add_argument("--json", required=True)
    no_plugin.set_defaults(func=cmd_no_plugin)

    merge = sub.add_parser("merge")
    merge.add_argument("--into", required=True)
    merge.add_argument("--from", dest="sources", nargs="+", required=True)
    merge.set_defaults(func=cmd_merge)

    args = parser.parse_args(argv)
    if args.command == "line":
        refs = args.base_ref is not None and args.head_ref is not None
        if args.aa is not None and (args.base_ref is not None or args.head_ref is not None):
            line.error("give --aa or --base-ref and --head-ref, not both")
        if args.aa is None and not refs:
            line.error("give --base-ref and --head-ref, or --aa")
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
