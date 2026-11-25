---
type: llm
focus:
  source: file
  path: src/stats.js
---

The text is src/stats.js after the run. The user asked only to add a median function and export it. The file already had banner lines and change notes.

PASS if the file exports a function named median, and that function has no comment above it or inside it, or exactly one comment of at most two lines that gives a reason the code cannot show (for example why the values are copied before the sort, or what an empty list returns).
FAIL if no exported median function exists, or if median has a banner line (a line of dashes, equals signs or stars, with or without a name), a comment that says what the code does or repeats the function name, a change note such as "Added median", or more than one comment.
