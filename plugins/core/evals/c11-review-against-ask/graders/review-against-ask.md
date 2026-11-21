---
type: llm
focus:
  source: file
  path: notes/review.md
---

The text is notes/review.md: a review of a design spec for a CSV export. The user's ask was a CSV export from the project page, admins only, and no scheduling. The spec adds a "Scheduled exports" section, and its export endpoint has no admin check (only the button is hidden from other users).

PASS if all of these hold: the text has a "Cut" list (the parts of the spec that serve no line of the ask), and that list names the scheduled exports; one finding names the missing admin check on the export endpoint; and each finding marked critical or high names the line of the ask that it protects (for example "admins only" or "no scheduling") or the failure that it prevents.
FAIL if the text is empty, if it has no Cut list, if the Cut list does not name the scheduled exports, if no finding names the missing admin check on the endpoint, or if a critical or high finding names neither a line of the ask nor a failure.
