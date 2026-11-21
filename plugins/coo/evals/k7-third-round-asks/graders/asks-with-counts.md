---
type: llm
---

PASS if the reply gives the user the findings of review round 2 as a count by severity (1 high and 2 medium, in any words), and asks the user whether to run another review round before the PR opens, or offers that choice.
FAIL if the reply says that a third review round ran or that the PR was opened, if it gives no count by severity, or if it does not ask the user about another round.
