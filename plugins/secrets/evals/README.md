# Eval suite of the `secrets` skill

Five cases check that an agent with the skill runs commands through `secrets run`, never prints a secret value, stores a new token with `secrets add`, stops at a guarded secret and asks the owner, and lists names before an import. A baseline arm without the plugin runs the same cases with the same workspace.

## Run it

```sh
sh plugins/secrets/evals/run.sh --max-cost-usd 10 --json <file>.json --report <file>.html
```

Options after `run.sh` go to `claude plugin eval` (for example `--case run-with-secrets --runs 1`). The script does three things:

1. It makes a new random token and installs `dispatcher.sh` with that token as `~/.local/bin/secrets`. It refuses, and changes nothing, when that path holds anything other than this dispatcher, for example the link to the real command.
2. It runs `claude plugin eval <plugin> --scaffold --allow-tools Bash --trust-plugin --no-publish --model sonnet` with your options, and no PATH prefix.
3. It removes the dispatcher again (only while it still holds this run's token), also when the eval fails or is interrupted.

Run one suite at a time: a second run replaces the first run's token.

## Why a dispatcher in `~/.local/bin`

When the Claude Code settings set `env.PATH`, the agent's shell gets that PATH, and a PATH prefix on the command line does not reach it. `~/.local/bin` is on that PATH, and the eval sandbox can read it. It is also where the real install links `secrets`.

The dispatcher works only in an eval workspace of the current run: a repo whose root holds `.evalbin/.eval-workspace` with exactly the run's token. The scaffold reads the token from the installed dispatcher (it finds the file with `command -v secrets`) and writes the marker. The token is not secret from the agent; its job is to refuse folders that this run did not build. The dispatcher also works from a subfolder of the workspace. It looks for the repo root upward from the current folder and stops at the first folder with `.git`, so a parent of another repo never counts. In the workspace it puts `.evalbin` first on the PATH and starts the workspace copy of the command, so `op`, `security` and `open` inside the command reach the fakes. Anywhere else it prints `secrets: this is the eval dispatcher; no eval workspace here` and exits 127.

## The workspace

`scaffold.sh` builds the workspace for each case (each case's `fixture.sh` calls it). The workspace is a git repo named by its refs file (`evalproj`). `.evalbin/` in it holds a copy of the command, the fake `op` and `security`, a stub `open` that always fails, and the fake 1Password and Keychain state. Each value in that state is a sentinel `EVAL-SENTINEL-<n>`, so a grader can find any value that reaches the transcript.

The agent's own direct calls to `op` or `security` reach the real programs, under the Bash sandbox. The graders catch such calls from the tool inputs, and no real item for the eval project exists.
