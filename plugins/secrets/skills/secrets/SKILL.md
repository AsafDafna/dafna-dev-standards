---
name: secrets
description: Use when a repo has a .secrets-refs file, a command needs an API key or token, a new secret must be stored, or a project or Mac needs secrets set up. Covers secrets run, import, add, setup and status, and what to do when one of them fails.
---

# secrets: 1Password secrets for agents

The repo holds names and `op://` addresses (`.secrets-refs`), never values. The values live in 1Password. Run `secrets` from anywhere inside the repo or its worktree.

## Rules

1. Run every command that needs a secret through `secrets run`.
2. Never print, echo, log or copy a secret value. Never read a plaintext env file.
3. Store a new secret with `secrets add`. Never paste it into the chat.
4. When `secrets run` names a missing high-value item, ask the owner to move it. Go on with work that does not need it.
5. Before a setup with `--import`, list the names (never the values), propose the high-value ones, and wait for the owner's list.
6. Start `secrets setup` only when the owner asked for it: a new project, a repo move, a second Mac, or a renewed token.

The owner's rule: a 1Password prompt appears only during a setup the owner asked for, and the owner denies every other prompt. If a prompt appears at any other time, stop and tell the owner. Do not retry.

High-value means the secret can change production data, spend money, or control an account. The owner decides per secret. A high-value secret goes to the guarded vault, which no agent can read. Never store one with `add` or `import`.

## Commands

| Command | Use |
|---|---|
| `secrets run [--stage NAME] [--guarded] -- CMD` | `secrets run -- npm run dev` |
| `secrets import [--names-only] FILE[:STAGE]...` | `secrets import --names-only .env.local` |
| `secrets add NAME [--stage NAME]` | `printf '%s' "$VALUE" \| secrets add API_KEY` |
| `secrets setup PROJECT [--import FILE[:STAGE]]... [--guard NAME,...] [--renew]` | `secrets setup myapp --import .env --guard STRIPE_KEY` |
| `secrets status` | `secrets status` |

- `run` passes the exit code of the command through. The command never gets the service-account token. `--stage` reads `.secrets-refs.<stage>`. `--guarded` also reads the guarded refs file of that stage.
- `import` stores each value of an env file in the project vault and writes the refs lines. The stage is `<x>` for `.env.<x>`, the default for `.env` and `.env.local`, and `:STAGE` wins. It takes at most 50 names per file. Larger files go through `setup --import`. `import` and `add` refuse a guarded name.
- `import --names-only` prints names and stages, never values. It marks a value shorter than 8 characters: `op run` hides such a value everywhere in the output of a command.
- `add` reads one value from stdin and replaces an older value of the same name.
- `setup` opens a Terminal window and waits up to 15 minutes for the owner. Run it with `run_in_background`, then end the turn. Its screen shows each import file's full path and every name with its target vault.
- `status` reads names only. Inside a sandboxed tool call it cannot prove that the host app lacks the 1Password folder permission.

Before `setup --import` or `import`, run `secrets import --names-only` on every env file, propose the high-value names, and wait for the owner's list.

## Failure lines

| Line | What to do |
|---|---|
| `no token for P on this Mac. Run: secrets setup P` | Ask the owner. Setup needs the owner at the Mac. |
| `the token for P does not work. Run: secrets setup P, with --renew ...` | Ask the owner to run setup with `--renew`. |
| `cannot read NAME (item T in vault V)` | The item is missing. Store it with `secrets add`, or fix the refs line. |
| `ask the owner to move T from P-guarded to P` | Ask the owner to approve the item in the 1Password app. Go on with other work. |
| `NAME is a guarded secret. Ask the owner to change it in 1Password.` | Do not work around it. Ask the owner. |
| `more than one item is titled T in vault V. Keep one.` | Ask the owner to delete the extra item. |
| `no .secrets-refs in DIR` | The repo has no refs yet. Ask the owner whether to run setup. |
| `FILE line N: ... Fix the line, then try again.` | The line reads differently in env loaders (a `$` or `\`, backticks, `#` without quotes, a CR, a multi-line value). The owner stores it with `secrets add NAME` or in the 1Password app, and removes the line. |
| `1Password is not reachable` or `the 1Password request limit is reached` | Wait, then try again once. |
| `op failed: ...` | Report the line to the owner. Do not retry in a loop. |

More detail: the plugin README.
