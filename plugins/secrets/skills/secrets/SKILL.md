---
name: secrets
description: Use when a repo has a .secrets-refs file, a command needs an API key or token, a new secret must be stored, or a project or Mac needs secrets set up. Load this skill BEFORE you run any command or script that prints, creates or needs a token, key or password: such output must go straight into `secrets add` and must never reach the screen or the chat. Covers secrets run, import, add, setup and status, and what to do when one fails.
---

# secrets: 1Password secrets for agents

The repo holds names and `op://` addresses (`.secrets-refs`), never values. The values live in 1Password. Run `secrets` from anywhere inside the repo or its worktree.

For another repo, put `-C DIR` before the subcommand, as with `git -C`: `secrets -C /path/to/other-repo run -- CMD`. DIR picks the repo, its vault and its token. CMD and a relative FILE start in DIR.

## Rules

1. Run every command that needs a secret through `secrets run`.
2. Never print, echo, log or copy a secret value. Never read a plaintext env file.
3. Store a new secret with `secrets add`. Never paste it into the chat.
   When a command or script creates or prints a secret, never run it by itself first, not even to see what it prints. Run it once, piped into add: `./make-token.sh | secrets add NAME`. The piped command must print only the value.
   A high-value secret is never created through `secrets add`. Do not run the script; ask the owner.
4. A guarded secret loads only with `secrets run --guarded -- CMD`. Claude Code asks the owner before each such command. Use `--guarded` only for a command that needs a guarded name.
   After a denial, stop and report it. Try no other route.
   Never write `--guarded` into a file (a script, `package.json`, a Makefile). Type it only in the Bash command itself.
5. Before a setup with `--import`, list the names (never the values), propose the high-value ones, and wait for the owner's list.
6. Start `secrets setup` only when the owner asked for it: a new project, a repo move, a second Mac, or a renewed token.
7. Never call `op` or `security` directly, and never run `secrets` with shell tracing (`sh -x`, `set -x`).

The owner's rule: a 1Password prompt appears only during a setup the owner asked for, and the owner denies every other prompt. If a prompt appears at any other time, stop and tell the owner. Do not retry.

High-value means the secret can change production data, spend money, or control an account. The owner decides per secret. A high-value secret is a guarded name: its refs line is in `.secrets-refs.guarded` (for a stage, `.secrets-refs.<stage>.guarded`). Its item sits in the project vault with the tag `high-value`. Never store one with `add` or `import`.

To guard an open secret later, the owner runs `secrets setup` with `--guard NAME`.

## Commands

| Command | Use |
|---|---|
| `secrets run [--stage NAME] [--guarded] -- CMD` | `secrets run -- npm run dev` |
| `secrets import [--names-only] FILE[:STAGE]...` | `secrets import --names-only .env.local` |
| `secrets add NAME [--stage NAME]` | `./make-token.sh \| secrets add API_KEY` |
| `secrets setup PROJECT [--import FILE[:STAGE]]... [--guard NAME,...] [--renew]` | `secrets setup myapp --import .env --guard STRIPE_KEY` |
| `secrets status` | `secrets status` |
| `secrets -C DIR SUBCOMMAND ...` | `secrets -C ../api run -- npm test` |

- `run` passes the exit code of the command through. The command never gets the service-account token. `--stage` reads `.secrets-refs.<stage>`. Without `--guarded`, `run` reads only the open refs file. `--guarded` also reads the guarded refs file of that stage.
- `import` stores each value of an env file in the project vault and writes the refs lines. The stage is `<x>` for `.env.<x>`, the default for `.env` and `.env.local`, and `:STAGE` wins. It takes at most 50 names per file. Larger files go through `setup --import`. `import` and `add` refuse a guarded name.
- `import --names-only` prints names and stages, never values. It marks a value shorter than 8 characters: `op run` hides such a value everywhere in the output of a command.
- `add` reads one value from stdin and replaces an older value of the same name. Pipe in the output of the command that creates the value (`./make-token.sh | secrets add NAME`), or the owner runs `secrets add NAME` in a terminal and types the value at the hidden prompt.
- `setup` opens a Terminal window and waits up to 15 minutes for the owner. Run it with `run_in_background`, then end the turn. Its screen shows each import file's full path and every name with its target vault. A guard name is marked `[guarded: Claude Code asks before use]`.
- `status` reads names only. Inside a sandboxed tool call it cannot prove that the host app lacks the 1Password folder permission.

Before `setup --import` or `import`, run `secrets import --names-only` on every env file, propose the high-value names, and wait for the owner's list.

## Failure lines

| Line | What to do |
|---|---|
| `no token for P on this Mac. Run: secrets setup P` | Ask the owner. Setup needs the owner at the Mac. |
| `the token for P does not work. Run: secrets setup P, with --renew ...` | Ask the owner to run setup with `--renew`. |
| `cannot read NAME (item T in vault V)` | Store the value with `secrets add NAME` (with `--stage` for a stage ref), or fix the refs line. For a guarded name, ask the owner: never store a high-value secret this way. |
| `NAME is a guarded secret. Ask the owner to change it in 1Password.` | Do not work around it. Ask the owner. |
| `NAME is a guarded secret. Add NAME to --guard.` (setup) | The import file holds a guarded name. Tell the owner to add it to `--guard`. Never remove the guard. |
| `more than one item is titled T in vault V. Keep one.` | Ask the owner to delete the extra item. |
| `setup failed: REASON`, or `skipped (empty value): ...` in the setup result | Relay the reason to the owner. Tell the owner which names were skipped, and never delete or change the env file that holds them. |
| `no .secrets-refs in DIR` | The repo has no refs yet. Ask the owner whether to run setup. |
| `FILE line N: ... Fix the line, then try again.` | The line reads differently in env loaders (a `$` or `\`, backticks, `#` without quotes, a CR, a multi-line value). The owner stores it with `secrets add NAME` or in the 1Password app, and removes the line. |
| `1Password is not reachable` or `the 1Password request limit is reached` | Wait, then try again once. |
| `op failed: ...` | Report the line to the owner. Do not retry in a loop. |
| A `FAIL: ...` line of `status`, `cannot read the Keychain item op-sa-P (security exit N)`, or `FILE has N names. import takes at most 50; ...` | You cannot fix these. Report the line to the owner. |

More detail: the plugin README.
