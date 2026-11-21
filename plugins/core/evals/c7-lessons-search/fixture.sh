#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
mkdir -p .claude
awk -v files='src/report.js src/export.js src/format.js src/cart.js src/money.js src/range.js src/stats.js cli.js' '
  /%s/ { t[nt++] = $0; next }
  { key = $0 }
  END {
    nf = split(files, f, " ")
    print "# Lessons log: see the lessons-log skill for the protocol"
    print "# Format: - [YYYY-MM-DD] [+/-] Lesson. (context: what triggered it)"
    for (i = 0; i < nt * nf; i++) {
      stamp = sprintf("2025-%02d-%02d", 1 + int(i / 21), 1 + i % 21)
      if (i == 170) {
        printf "- [%s] %s\n", stamp, key
        continue
      }
      line = t[i % nt]
      sub(/%s/, "`" f[1 + int(i / nt)] "`", line)
      printf "- [%s] %s (context: PR %d)\n", stamp, line, 12 + i
    }
  }' > .claude/lessons.md <<'LESSONS'
[-] Do not add a default export to %s; the named imports in its callers broke.
[+] Keep %s free of console output; the CLI owns printing.
[-] A trailing comma in the export list of %s broke an older Node in CI.
[+] Run `npm test` after a change to %s; it is fast and covers the main paths.
[-] Do not import from paths outside src/ in %s; the package layout moved once.
[+] Name a new helper in %s after what it returns, not how it works.
[-] A rename in %s missed one caller; search the repo for the old name first.
[+] Small pure functions in %s made the tests short.
[-] Mixed tabs and spaces in %s made the diff noisy; use two spaces.
[+] Put input checks at the top of each public function in %s.
[-] Throwing a string in %s lost the stack; throw an Error.
[+] A table-driven test for %s caught two edge cases at once.
[-] Floating-point sums in %s drifted; keep money in integer cents.
[+] Keep the public API of %s small; the CLI needs only a few functions.
[-] An unused import in %s hid a circular import for a while.
[+] Read the existing tests before changing %s; they document the edge cases.
[-] A regex without anchors in %s accepted bad input.
[+] Return plain objects from %s; classes made the JSON output awkward.
[-] Sorting in place in %s changed the caller's array.
[+] Use node:assert/strict in the tests of %s; loose equality hid a bug.
[-] A long line in %s hid a missing return; keep lines short.
[+] Put the input that failed in each error message from %s.
[-] Optional chaining in %s hid a missing field instead of failing early.
[+] One commit per change to %s kept the history easy to bisect.
[-] A shared mutable constant in %s leaked state between tests.
[+] Keep related constants of %s in one list, so their order stays the same.
[-] A default parameter in %s masked a missing argument at the call site.
[+] Write the failing test for a bug in %s before the fix.
[-] Copied code in %s drifted apart; extract a helper on the third copy.
[+] Check git diff for stray edits in %s before a commit.
[-] Changing the output format of %s broke a script that parsed it.
[-] `npm test` runs only test/*.test.js and skips test/slow/. After a change to date or week code, also run `node --test test/slow`. (context: a week-start change passed npm test and broke test/slow/week.test.js)
LESSONS
git add .claude/lessons.md
git commit -qm 'Add the lessons log'
