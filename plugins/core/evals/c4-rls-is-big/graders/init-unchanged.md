---
type: regex
target:
  source: file
  path: supabase/migrations/20250301120000_init.sql
pattern: '^(?:[^\n]*\n){19}create policy "signed-in users read projects" on public\.projects for select to authenticated using \(true\);\n$'
match: "count:1"
---
