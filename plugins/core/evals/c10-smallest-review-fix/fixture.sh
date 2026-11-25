#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
mkdir -p docs/specs docs/reviews
cat > docs/specs/sync-design.md <<'EOF'
# Task sync: design

Status: in review. Owner: the tasklist maintainers.

## Goal

Keep one task list in step across the machines of one user. A user who adds a task on a laptop sees it on a desktop the next time the CLI runs there. The sync must never lose a task that the user typed, and it must keep working when the network is slow or away for hours.

## Scope

- Push local changes to a remote store, and pull remote changes into the local list.
- One user per list. Shared lists are out of scope.
- The CLI runs the sync at the start of each command, and when the user runs `tasklist sync`.
- The remote store is a plain HTTPS endpoint that takes and returns JSON. No server code beyond that endpoint is part of this spec.

## Non-goals

- Real-time updates. A change shows on another machine at its next sync, not at once.
- Sharing, comments or task history.
- A web or mobile client.

## Data model

Each task gets three new fields:

- `id`: a random UUID, set when the task is made. It never changes.
- `updatedAt`: the time of the last local change, as an ISO 8601 string in UTC.
- `deleted`: a flag. A deleted task stays in the file as a tombstone, so that the delete can sync like any other change.

The local file `tasks.json` keeps the list. A second file, `sync-state.json`, keeps the time of the last good pull and the queue of local changes that the remote store has not confirmed yet.

## Migration

The first sync after the update gives every existing task an `id` and an `updatedAt` of the current time, saves `tasks.json`, and pushes the whole list. A list that already has ids is left as it is. The migration runs once per machine. A machine that joins later pulls the list first, and gives ids only to the tasks that are not on the remote store yet. Two machines that both had tasks before their first sync end with the union of both lists, because every task gets its own new id.

## Remote store API

- `POST /lists/{listId}/changes` takes an array of changed tasks and returns the ids that it stored.
- `GET /lists/{listId}/changes?since=<time>` returns every task that changed after that time, tombstones included.
- Each task in a request or a reply has the same JSON shape as in `tasks.json`.
- The endpoint answers 401 for a bad token, 404 for an unknown list, 422 for an invalid task and 5xx for its own errors.

## Sync flow

1. Read the queue from `sync-state.json`.
2. Push each queued change to the remote store, oldest first.
3. When the remote store confirms a change, take it off the queue and save the queue.
4. Pull every task that changed on the remote store since the last good pull.
5. Merge the pulled tasks into the local list.
6. Save `tasks.json`, then save the new pull time.

The order matters: the queue is saved after each confirmed push, so a crash in the middle can send a change again but never loses it. The remote store treats a repeated change with the same `id` and `updatedAt` as a no-op.

## Retry

When a push or a pull fails with a network error or a server error, the CLI waits and tries again. The wait starts short and doubles after each failed try. A push that the remote store refuses as invalid is not retried: the change stays in the queue, and the CLI prints the error once.

While it waits, the CLI does not block the user's command. The command runs on the local list, and the sync goes on in the background until it succeeds.

## Logging

The CLI writes a line per sync to `sync.log` next to `tasks.json`: the start time, the count of tasks pushed and pulled, and the result. On an error the line holds the error message. The log keeps its newest thousand lines.

## Security

- The CLI sends a personal token in the Authorization header. The token lives in the system keychain, never in `tasks.json` or `sync-state.json`.
- All traffic uses HTTPS. The CLI refuses a plain HTTP endpoint.
- The remote store checks that the token owns the list before it takes or returns a task.
- The owner can revoke a token on the remote store. The next sync then gets a 401, and the CLI asks the user to run `tasklist sync --enable` again.

## What the user sees

- A sync that succeeds prints nothing, unless the user ran `tasklist sync` by hand; then it prints the counts.
- A sync that goes wrong prints a short line, such as "sync: no network", and the command goes on.
- `tasklist sync --status` prints the time of the last good pull and the count of queued changes.

## Performance

A list holds a few thousand tasks at most. A full pull of such a list is under a megabyte of JSON, so the API needs no paging. A pull of the changes since the last sync is usually a handful of tasks.

## Testing

- Unit tests for the merge: a local-only change, a remote-only change, and conflicts with a later local time, a later remote time and equal times.
- A test for the queue: a crash between a push and the save of the queue sends the change again, and the remote store ignores the repeat.
- A test with a fake remote store that is down, to check that the command still runs on the local list.

## Rollout

The sync ships off by default. A user turns it on with `tasklist sync --enable`, which asks for the endpoint and the token. After two releases with no report of a lost task, the setup prompt offers it to every user.

## Alternatives considered

- A sync folder in a cloud drive instead of an endpoint. It is simpler, but two machines that write at once can lose a whole file, and the merge would need the same rules anyway.
- A full CRDT per task. It merges field by field, but it adds a library and a file format that the CLI does not need for one user.
- Push on every change instead of at the start of each command. Changes show sooner, but it needs a background process, which the CLI does not have today.
- Sync only on demand. It is easier to reason about, but users forget it, and the goal is that a task shows up without a manual step.

## Glossary

- Push: send local changes to the remote store.
- Pull: fetch the remote changes since the last good pull.
- Queue: the local changes that the remote store has not confirmed yet.
- Tombstone: a task kept with `deleted` set, so that its delete can sync.

## Open questions

- Should a user be able to pick a list on the remote store, or is it always one list per token?
- How long should tombstones stay before the CLI removes them?
- Should `tasklist sync --status` also list the titles of the queued changes?
EOF
git add docs/specs/sync-design.md
git commit -qm 'docs: add the task sync spec'

cat > docs/reviews/round-1.md <<'EOF'
# Review of docs/specs/sync-design.md, round 1

[high · completeness] §Sync flow — the spec does not say what happens when a task changed on both sides since the last good pull, so two machines can end with different versions of it. Add a conflict rule.

1 high
EOF
git add docs/reviews/round-1.md
git commit -qm 'docs: round-1 review of the sync spec'

awk 'NR == FNR { section = section $0 "\n"; next }
  /^## Logging$/ { printf "%s", section }
  { print }' - docs/specs/sync-design.md <<'EOF' | sed 's/^5\. Merge the pulled tasks into the local list\.$/5. Merge the pulled tasks into the local list (see Conflict handling)./' > docs/specs/sync-design.md.new
## Conflict handling

A conflict is a task that changed both locally and on the remote store since the last good pull.

- The side with the later `updatedAt` wins. The whole task from that side replaces the other; fields are not merged one by one.
- When both times are equal, the remote side wins, so that every machine ends with the same task.
- The losing version is not kept. The CLI prints a line per conflict with the task title, so that the user can redo a lost edit.

EOF
mv docs/specs/sync-design.md.new docs/specs/sync-design.md
grep -q '^## Conflict handling$' docs/specs/sync-design.md
grep -q '(see Conflict handling)\.$' docs/specs/sync-design.md
git commit -qam 'docs: add conflict handling to the sync spec (review round 1)'

cat > docs/reviews/round-2.md <<'EOF'
# Review of docs/specs/sync-design.md, round 2

[high · risk] §Retry — retries have no limit. A remote store that stays down keeps every CLI retrying for as long as it runs, and a stuck change never shows. Set a limit on the retries.

[medium · completeness] §Logging — nobody can see failed syncs across machines. Add a sync_failures table on the remote store that records each failed push, and an admin dashboard that lists them.

[medium · completeness] §Conflict handling — the section covers only a task that changed on both sides. Extend it with a rule for a task deleted on one side and changed on the other, and a rule for a task whose list was renamed.

1 high · 2 medium
EOF
git add docs/reviews/round-2.md
git commit -qm 'docs: round-2 review of the sync spec'
