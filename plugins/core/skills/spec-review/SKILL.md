---
name: spec-review
description: Use when the user says "/spec-review", "review this spec", "review my spec", "critique my spec", "find holes in this spec", "tough questions on this spec", "audit this design", "what's wrong with this spec", or asks for an independent read on a design doc before committing to it. Also fits right after a brainstorming session produces a spec. Works on any design doc.
---

# /spec-review — Tough Review of a Design Spec

Reviews a spec for holes, bugs, improvements, and asks tough questions. Two-phase: report-only first, then optional brainstorm-and-lock that applies decisions to the doc.

**Shared rules (tone, contract, output format, severity scale, question format):** read the file shared/review-fundamentals.md located two directories above this SKILL.md (../../shared/review-fundamentals.md relative to this file) before doing anything else.

## Input

1. **Arg present** → use it as the file path.
2. **No arg** → look for the most recent file matching `*-design.md` under `docs/superpowers/specs/` (relative to the current working directory). If found, confirm with the user: *"Reviewing `<path>` — proceed?"*
3. **Neither** → error: "Pass a spec path, or write the spec to `docs/superpowers/specs/<date>-<topic>-design.md` first."

## Phase 1 — Report

Read the spec end-to-end before flagging anything. Then walk the five check families below and emit findings in the format defined in `review-fundamentals.md`.

### Check Families (for the `category` tag)

**completeness** — what's missing

- Success criteria — how do we know this is done?
- Edge cases & failure modes — network failure, empty/null inputs, auth expiry, concurrency, large inputs
- Stakeholder / user perspective — whose workflow is this? missing personas?
- Non-functional requirements — perf, security, accessibility, i18n (only where relevant to the spec's domain)
- External dependencies the spec assumes but doesn't name

**clarity** — what's unclear or wrong

- Ambiguity — wording with multiple valid interpretations
- Contradictions — sections that conflict with each other
- Placeholders — TBDs, TODOs, vague hedges like "should probably"
- Undefined terms or unexplained jargon

**risk** — what's load-bearing but unexamined

- Unstated assumptions — load-bearing assumptions not called out
- Feasibility / scope — is this one spec or three?
- Known technical hazards — third-party limits, RLS interactions, environment-specific behavior

**improvement** — what could be tighter

- Simplification opportunities (YAGNI)
- Decomposition (should this split?)
- Existing patterns, skills, or code the spec ignores or reinvents

**tough-question** — the "what aren't we asking" probe

- What did we explicitly decide *not* to do? Is that recorded?
- What's the worst-case failure mode? Is it acceptable?
- If this ships and works, what does it unblock next? Should the spec call that out?
- Who owns this post-launch?

### Phase 1 Output

Findings flat, severity-first per `review-fundamentals.md`. One line of content per finding, **separated by a single blank line** (required — see review-fundamentals.md). Close with a blank line and a one-line tally.

After the tally, prompt: *"Proceed to lock decisions? (y/n)"*

## Phase 2 — Brainstorm-and-Lock

Per `review-fundamentals.md`: walk findings highest-severity-first; tough-questions last. For each, ask one question (no forced multiple-choice — see review-fundamentals.md), apply the user's locked decision to the spec via `Edit` immediately, then move on.

When all findings are walked, summarize what changed in one line, then proceed to Phase 3.

## Phase 3 — Final Consistency Pass

Per `review-fundamentals.md`: re-read the whole spec end-to-end to catch contradictions, broken cross-references, or dangling content the Phase 2 edits introduced. Fix mechanical inconsistencies via `Edit` directly; surface anything needing a genuine new decision. Close with the one-line consistency report and stop.
