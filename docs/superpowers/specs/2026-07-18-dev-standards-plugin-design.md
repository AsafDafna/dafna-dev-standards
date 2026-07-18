# dafna-dev-standards — shared Claude Code plugin marketplace

**Date:** 2026-07-18 · **Status:** draft for review
**Users:** Asaf and Nir Dafna, collaborating across independent repos (edut-app onboarding now; other shared and solo projects later).

## Goal

Extract the reusable dev-workflow layer proven in edut-app into a versioned, installable set of Claude Code plugins that both developers share, without copy-drift and without leaking edut-specific or personal-level content.

## Non-goals

- A shared UI design system. Design language is per-product brand. The standards recommend installing the **impeccable** plugin plus a small per-repo brand-tokens skill; edut's design skill stays in edut-app.
- Sharing personal-level tooling (Asaf's pkg-security hook, response-style rules, usage-limit guard). These remain in each developer's own `~/.claude`; setup instructions for Nir are delivered separately.
- Make.com / Monday tooling. `make-*` and `monday-backfill` skills are generalization candidates for a later `make-com` plugin — out of scope for v1.

## Decisions (locked during brainstorming, 2026-07-17/18)

1. **Scope:** dev workflow only; UI design delegated to impeccable (see Non-goals).
2. **Delivery:** one public GitHub repo (`dafna-dev-standards`, Asaf's account) acting as a plugin **marketplace with four plugins** — `core`, `supabase`, `nextjs`, `coo`. Each repo/user installs only what it needs.
3. **Stack:** core is stack-agnostic (process rules only). Stack conventions live in the opt-in `supabase` and `nextjs` plugins.
4. **Rules delivery:** `core` ships a **SessionStart hook** that injects `RULES.md` into context every session. No copying into repo CLAUDE.md files; a plugin update changes behavior everywhere.
5. **Governance:** protected `main` (1 approving review, CODEOWNERS = Asaf, "include administrators" off), Nir as collaborator — he PRs, Asaf merges. Public repo (avoids the GitHub Pro requirement for branch protection on private repos; content is process rules, nothing sensitive). Revisit peer-merge after onboarding.
6. **Decision log is a rule, not a skill:** "significant decision → append one line to `docs/DECISIONS.md`" lives in RULES.md; `/bootstrap-repo` seeds the template whose header documents the format.
7. **coo is its own plugin:** user-level orchestration mode, opted into personally, not bundled with repo standards.

## Marketplace structure

```
dafna-dev-standards/
  .claude-plugin/marketplace.json          # lists: core, supabase, nextjs, coo
  plugins/
    core/
      .claude-plugin/plugin.json           # semver
      hooks/hooks.json, session-rules.sh   # SessionStart → cat RULES.md
      rules/RULES.md
      skills/
        lessons-log/
        spec-review/          # references shared REFERENCE.md via ${CLAUDE_PLUGIN_ROOT}
        plan-review/          #   (fixes the ~/.claude absolute-path coupling)
        _review-fundamentals/ # shared REFERENCE.md for the two review skills
        dev-env-setup/
        checklists/           # plan / review / test / security / handoff
      commands/bootstrap-repo.md
      templates/              # PR template, CODEOWNERS skeleton, DECISIONS.md,
                              # empty lessons.md
    supabase/
      skills/: migration blast-radius rigor (sweep RPCs/views/triggers before
      rename/drop, `-- Reviewed:` lint gate, full integration suite), RLS/security
      baseline (WITH CHECK, SECURITY DEFINER search_path), extensions-schema rules.
    nextjs/
      skills/: Next/TS-strict/Tailwind/shadcn conventions, Zod-at-boundaries,
      server-state-first, file naming. Sourced from edut-app + dev-projects CLAUDE.md.
    coo/
      skills/coo/ (SKILL.md + orchestration.md)
```

### RULES.md contents (core, injected each session)

- Workflow orchestration gates: plan mode for non-trivial tasks; execution-mode gate (3+ files or DB migration → subagent implementers, stated out loud); root-cause bug discipline; parallel sessions → git worktrees.
- Feature workflow: **brainstorm → spec** for feature design (plan mode is for execution planning, not design); spec committed to git before planning; spec-review / plan-review as gates.
- Git conventions: feature branches, conventional commits, never commit to main.
- CI-minute economy: **quality gates run pre-PR on the worktree** (simplify → code review → then open PR, so CI runs once); batch fixes; rerun-failed-only; **docs-only PRs skip CI** via `paths-ignore`.
- Pre-merge gates: simplify pass, code review, security review for auth/PII diffs, no leftover debug code.
- Lessons-log protocol pointer (the skill carries the detail) + decision-log rule (Decision 6).

### dev-env-setup skill (core)

Guides a new machine to the recommended terminal stack: **Ghostty + herdr**.

- **macOS path:** Homebrew-based install (ghostty cask, herdr per its docs), shell setup.
- **Windows path:** WSL2/WSLg on Ubuntu 26.04+, sourced from Nir's verified handoff
  doc (`docs/sources/windows-dev-environment-setup.md`): PATH setup, herdr + Ghostty
  config, Nerd Fonts, the `devenv` launcher (software-rendering + login-shell
  requirements), `wslg.exe` shortcut creation, icon build, and the full
  gotchas/troubleshooting table. All `⚠️`-flagged hardcoded paths (`/home/nird`,
  `C:\Users\nirda`) generalized to `$HOME` / runtime resolution per the doc's
  portability notes.

### /bootstrap-repo command (core)

One-time scaffolding for a repo adopting the standards:
1. Drop templates: PR template, CODEOWNERS skeleton, `docs/DECISIONS.md`, empty `.claude/lessons.md`.
2. **Skill-collision dedup check:** scan `~/.claude/skills/` for names shadowing plugin skills (lessons-log, spec-review, plan-review, coo, …); offer to delete the local copies.
3. Suggest the CI `paths-ignore` block for docs-only changes.

## Generalization requirements (extraction-time edits)

- `spec-review` / `plan-review`: shared-reference path becomes plugin-relative (`${CLAUDE_PLUGIN_ROOT}`). Descriptions already rewritten to triggers-only (done 2026-07-18 on personal copies; carry over).
- `coo`: "Asaf" → "the user"; drop `~/dev-projects/CLAUDE.md` pointers; provenance already stripped from orchestration.md (2026-07-18). Keep graceful herdr degradation.
- `lessons-log`: drop the named project list and "Asaf" references; format-detection rule already generic.
- Checklists / PR template / CODEOWNERS: strip edut paths, validator/sync-engine/help-docs rows, `@AsafDafna` handles.
- Nothing from edut-app's lessons.md entries, track-update skill, RTL/Hebrew/testimony/Monday content, or tracker integration ships.

## Migration plan (after v1 installs)

1. **Dedup CLAUDE.md files:** remove plugin-covered rules from edut-app CLAUDE.md and `~/dev-projects/CLAUDE.md` (which rhizon and all sibling repos inherit); scan rhizon's local CLAUDE.md for re-duplication.
2. **Personal skills sweep:** classify all ~23 skills in Asaf's `~/.claude/skills` — generalize-into-plugin / stays personal / obsolete. Known: donna-* stay personal; make-*/monday-backfill → later `make-com` plugin.
3. **Nir onboarding:** install marketplace + core (+ coo if wanted), run dev-env-setup Windows path, separate `~/.claude` starter (pkg-security hook et al.).
4. **Asaf's second account:** the Edut710 org `CLAUDE_CONFIG_DIR` needs its own one-time install.

## Versioning & update flow

Semver in each `plugin.json`; every change lands via PR (Nir PRs, Asaf merges per Decision 5); consumers pull with `/plugin update`. Breaking rule changes bump major and get a CHANGELOG line.

## Verification

- **Spec smoke test:** run `/spec-review` on this document (doubles as the live test of the 2026-07-18 skill-description edits).
- **Install test:** fresh session in a scratch repo on each platform — confirm SessionStart injection appears, skills trigger by description, `/bootstrap-repo` scaffolds and detects a planted skill collision.
- **Dedup safety:** before removing rules from any CLAUDE.md, a verification agent diffs "rules removed" vs "rules injected" to prove nothing is lost (per the verify-before-trim working rule).
- **Windows path:** Nir reruns dev-env-setup on his machine from the skill alone (not the source doc); gaps become PRs.
