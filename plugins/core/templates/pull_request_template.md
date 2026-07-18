## What & why

<!-- One or two sentences. Link the design/plan doc if there is one. -->

## Checklist

- [ ] Pre-merge gates run where they apply (`/simplify` + `/code-review`; `/security-review`
      for auth/RLS/PII/endpoint changes).
- [ ] Migrations (if DB changes): blast-radius swept (RPCs/views/triggers) for any rename/drop;
      `-- Reviewed:` line added to destructive files.
- [ ] No leftover `console.log` / `debugger` / stray `TODO`.
