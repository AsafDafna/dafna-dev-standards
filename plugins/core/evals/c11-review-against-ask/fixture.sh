#!/bin/sh
sh "$(dirname "$0")/../scaffold.sh" || exit 1
set -eu
mkdir -p docs/specs
cat > docs/ask.md <<'EOF'
# The ask

The project owner's request, word for word:

"Add a CSV export to the project page. Only admins can export. No scheduling: people export by hand when they need a file."
EOF
cat > docs/specs/export-design.md <<'EOF'
# Project CSV export: design

## Goal

Admins can download the tasks of one project as a CSV file from the project page of the tasklist web app.

## Endpoint

GET /api/projects/:id/export returns the tasks of the project as CSV.
The handler loads the project by id, reads its tasks and streams the rows as it reads them.
The response sets Content-Type to text/csv and names the file after the project.

## CSV format

One row per task, after a header row: id, title, status, owner, due date, cost in cents.
Dates use ISO 8601. Text fields are quoted, and a quote inside a field is doubled.
An empty project gives a file with only the header row.

## Project page

An Export button sits next to the project title. The button shows only for admins.
A click calls the endpoint, and the browser saves the file.

## Scheduled exports

Admins can also set a weekly or monthly schedule for a project.
A nightly job builds the CSV for each schedule that is due and emails a download link to the admin who set it.
Schedules live in a new export_schedules store with project_id, frequency, next_run_at and recipient.
A settings panel on the project page lists the schedules and lets an admin pause or delete one.

## Testing

Unit tests cover the CSV format: quoting, an empty project and dates.
An integration test calls the endpoint for a project with three tasks and checks the rows.

## Rollout

Ship behind a flag for one release, then turn it on for every workspace.
EOF
git add docs
git commit -qm 'docs: add the ask and the export design'
