# Changelog

## coo 1.0.2 — never-name dispatch rule made explicit

- `coo`: SKILL.md + orchestration.md now state the dispatch rule as a hard negative:
  never pass `name:` on a bounded dispatch — background ≠ named (un-named background
  subagents still notify on completion); `name:` adds only SendMessage addressability
  plus idle-notification noise. Motivated by a 2026-07-22 recurrence in edut-app
  where the rule was in context and still rationalized around.

## core 1.0.0 / coo 1.0.0 — initial release

- `core`: SessionStart-injected RULES.md (workflow gates, git conventions,
  CI-minute economy, pre-merge gates, lessons/decision-log pointers).
- `core`: `lessons-log`, `spec-review`, `plan-review`, `checklists`,
  `dev-env-setup` skills.
- `core`: `/bootstrap-repo` and `/dedup-local-skills` commands.
- `coo`: Chief-of-Staff orchestrator mode (user-level opt-in).
