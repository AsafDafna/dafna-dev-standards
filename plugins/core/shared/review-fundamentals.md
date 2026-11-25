# Review Fundamentals — Shared Reference

Shared rules for the spec-review and plan-review skills in this plugin. Holds the parts that would drift if duplicated across the two skills.

## Tone

Tough but in service of quality. Push hard on weaknesses. Don't soften. Don't be adversarial-for-its-own-sake — the goal is a stronger doc, not a roasted user. Honest senior-reviewer voice.

## Two-Phase Contract

### Phase 1 — Report

Read the doc. Write the findings. No edits. The user decides whether to proceed to Phase 2.

Write the full findings, in the format below, to a file outside the repo (for example the session scratchpad), and do not commit it. In the chat, give the critical and high findings in that format, a count of the rest by severity, and the file path.

### Phase 2 — Brainstorm-and-Lock

Walk findings highest-severity-first; tough-questions last. For each finding:

1. If the fix is clear and needs no choice from the user (a low or nit finding, a placeholder, a broken reference), apply it via the `Edit` tool and name it in one line.
2. Otherwise ask one question and recommend an answer. Do not enumerate multiple-choice options unless the alternatives have real merit; if the answer is obvious, ask and propose.
3. On the user's answer, apply the resulting edit to the doc via the `Edit` tool immediately.
4. Move to the next finding.

Incremental application means nothing is lost if the session is interrupted.

### Phase 3 — Final Consistency Pass

After all Phase 2 edits are applied, re-read the **entire** doc end-to-end one more time. Incremental edits made in isolation can introduce new problems even when each was correct on its own. Hunt specifically for damage the edits caused:

- **Contradictions** — an edit to one section now conflicts with a statement left unchanged elsewhere.
- **Broken cross-references** — a section, step, or term renamed/removed by an edit is still referenced by its old name elsewhere ("see step 3", "as defined above").
- **Dangling content** — text that only made sense because of something an edit deleted or changed.
- **Numbering / ordering drift** — inserted or removed steps that throw off sequence labels or dependency references.
- **Duplication** — a decision recorded in two places where one now disagrees with the other.

Fix anything found via `Edit` directly (these are mechanical consistency repairs, not new design decisions — no need to re-ask). If a fix would require a genuine new decision, surface it to the user instead of guessing.

Close with a one-line report: either *"Consistency pass clean — N findings applied, no new issues."* or *"Consistency pass fixed M follow-on issues from the edits."* Then stop.

## Rounds

A round is one Phase 1 report and the Phase 2 and 3 edits that follow it.

- After two rounds, do not start a third on your own. Give the open findings as a count by severity, and ask the user whether to run another round.
- If the doc has grown by more than 25% since the first round, stop and ask the user before the next round.

## Review against the ask
- Input: the artifact and the ask (the user's own words for the job). If you did not get the ask, say so at the top of the findings and review against the artifact's stated goal.
- Review the whole artifact against the ask, also in a later round. Do not review only the last change.
- Each finding names the line of the ask it protects, or the failure it prevents and where that failure shows.
- Propose the smallest change, or a removal. Propose a new mechanism only when nothing smaller closes the failure, and say why.
- End with a "Cut" list: parts that serve no line of the ask, each with its size. An empty list is fine.
- Review notes stay in the findings file. The artifact gets no revision log, no findings table and no per-round appendix.

## Output Format (Phase 1)

Each finding is exactly one line of content, separated from the next finding by a single blank line:

```
[severity · category] §location — issue. Action.

[severity · category] §location — issue. Action.

[severity · category] §location — issue. Action.
```

- `severity` ∈ {`critical`, `high`, `medium`, `low`, `nit`} — see scale below
- `category` is family-specific (defined in each SKILL.md)
- `§location` is a section, heading, or step reference into the doc
- `issue` is one sentence stating what's wrong
- `Action` is one sentence stating what to do about it

Keep the blank line between findings. Substantive findings often wrap across several lines in the terminal; without a delimiter, wrapped lines merge with the next finding.

Findings are listed flat, severity-first. Close with a blank line and a one-line tally:

```
3 high · 5 medium · 2 tough-questions
```

Not in Phase 1 output:

- Prose paragraphs explaining findings (a finding is one line of content, not a paragraph)
- Headers grouping findings by category
- Restating context from the doc
- Multiple blank lines between findings (one blank line is the delimiter, not two)

## Severity Scale

- **critical** — the doc ships in a state that will break things or guarantee rework (missing core requirement, contradictory architecture, unbuildable plan step)
- **high** — load-bearing ambiguity, missing failure mode, or risk that will likely cause delay or rework
- **medium** — real gap or weakness worth fixing; non-blocking
- **low** — minor improvement; could ship without fixing
- **nit** — typo, formatting, polish

## What These Skills Do NOT Do

- Do not write new specs or plans (use `superpowers:brainstorming` and `superpowers:writing-plans`).
- Do not apply Phase 1 findings as edits before Phase 2.
- Do not commit the findings file. Phase 2 edits go directly to the spec or plan markdown, and git history captures the before and after.
