---
name: plan-review
description: Use when the user says "/plan-review", "review this plan", "review my plan", "critique my plan", "find holes in this plan", "tough questions on this plan", "audit this plan", "what's wrong with this plan", or asks for an independent read on an implementation plan before executing it. Also fits right after the writing-plans skill produces a plan. Works on any implementation plan.
---

# /plan-review — Tough Review of an Implementation Plan

Reviews a plan for sequencing, decomposition, verification, risk, spec alignment, and asks tough questions. Two-phase: report-only first, then optional brainstorm-and-lock that applies decisions to the doc.

**Assumes sub-agent-driven implementation** (per `superpowers:subagent-driven-development`). Each plan step is treated as a candidate sub-agent dispatch, which shapes what counts as a defect — see the `decomposition`, `verification`, and `spec-alignment` families below.

**Shared rules (tone, contract, output format, severity scale, question format):** read the file shared/review-fundamentals.md located two directories above this SKILL.md (../../shared/review-fundamentals.md relative to this file) before doing anything else.

## Input

1. **Arg present** → use it as the file path.
2. **No arg** → look for the most recent file matching `*-plan.md` (or `YYYY-MM-DD-*.md`) under `docs/superpowers/plans/` (relative to the current working directory). If found, confirm with the user: *"Reviewing `<path>` — proceed?"*
3. **Neither** → error: "Pass a plan path, or write the plan to `docs/superpowers/plans/<date>-<feature>.md` first."

If a corresponding spec file exists (same base name with `-design.md` instead of `-plan.md`, or otherwise discoverable in `docs/superpowers/specs/`), read it too — `spec-alignment` checks require it.

## Phase 1 — Report

Read the plan end-to-end (and the spec if found) before flagging anything. Then walk the six check families below.

### Check Families (for the `category` tag)

**sequencing** — is the order coherent?

- Steps depending on later steps
- Missing prerequisite steps
- Steps marked sequential that could be parallel (no shared writes between them)
- Steps marked parallel that actually share writes — violates the rule in `superpowers:dispatching-parallel-agents`

**decomposition** — are steps the right size?

- Hand-waved steps bundling multiple sub-tasks ("implement the dashboard")
- Steps too small to matter on their own
- **Steps lacking self-contained context** — sub-agents start cold; references like "as discussed above" or "similar to Task N" fail because the sub-agent doesn't have the prior steps in context
- Implied intermediate work that isn't a step but should be

**verification** — how do we know each step worked?

- No stated verification (manual or automated)
- "Tests pass" with no test named or written
- Missing test plan entirely
- **Verification not observable from a sub-agent's return summary** — the parent shouldn't have to inspect hidden state

**risk** — blast radius and recovery

- Steps touching load-bearing systems without flagging it (migrations, RLS changes, prod data, auth flows)
- No rollback path for irreversible ops
- Order-of-operations hazards (e.g., `NOT NULL` before backfill)
- Unstated environmental prerequisites (feature flags, env vars, prior state)

**spec-alignment**

- Spec requirements not covered by any step
- Plan steps that don't trace to any spec requirement (scope creep)
- Implicit design decisions in the plan that belong in the spec
- **Step briefs that don't reference the spec section they implement** — cold sub-agents need to ground their work in the spec

**tough-question** — plan-flavored

- If step N fails halfway, what state is the system in? Recoverable?
- Which steps could run as parallel sub-agents vs. must be sequential?
- Is there a natural demo / checkpoint step worth elevating?
- What's the longest do-not-interrupt run inside this plan?

### Phase 1 Output

Findings flat, severity-first per `review-fundamentals.md`. One line of content per finding, **separated by a single blank line** (required — see review-fundamentals.md). Close with a blank line and a one-line tally.

After the tally, prompt: *"Proceed to lock decisions? (y/n)"*

## Phase 2 — Brainstorm-and-Lock

Per `review-fundamentals.md`: walk findings highest-severity-first; tough-questions last. For each, ask one question (no forced multiple-choice — see review-fundamentals.md), apply the user's locked decision to the plan via `Edit` immediately, then move on.

When all findings are walked, summarize what changed in one line, then proceed to Phase 3.

## Phase 3 — Final Consistency Pass

Per `review-fundamentals.md`: re-read the whole plan end-to-end to catch contradictions, broken cross-references (e.g. "see step 3" after steps were inserted/removed), step-numbering drift, or dangling content the Phase 2 edits introduced. Fix mechanical inconsistencies via `Edit` directly; surface anything needing a genuine new decision. Close with the one-line consistency report and stop.
