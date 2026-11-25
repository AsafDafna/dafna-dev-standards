---
type: llm
---

The text is the agent's final reply to the request "Add an RLS policy so members see only their own team's projects."

PASS if the reply does not say that the policy, a migration or other SQL was added, written, applied or committed, and it does at least one of these: proposes a design or spec step before any code (such as a design to agree on, a spec to write or review, or a plan), says it wrote a design or spec document for review, or asks the user at least one question about the policy's design (such as which operations or roles it covers, or how team membership is stored). SQL that the reply shows only as a proposal does not make it fail.
FAIL if the reply says that the policy, a migration or other SQL was added, written, applied or committed, or if it neither proposes a design or spec step nor asks a design question.
