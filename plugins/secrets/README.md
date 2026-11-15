# secrets

One command, `secrets`, for secrets from 1Password. People and agents use the same command. The repo holds names and `op://` addresses in `.secrets-refs`, never values. Each project has one 1Password vault and its own service account, and an agent reads only that vault.

macOS only. It needs `jq`.

## Install

Add the marketplace once, with the `/plugin marketplace add` command in the [repository README](../../README.md#install). Then install the plugin and link the command once per Mac:

```
/plugin install secrets@dafna-dev-standards
ln -sfn ~/.claude/plugins/marketplaces/dafna-dev-standards/plugins/secrets/bin/secrets ~/.local/bin/secrets
```

The link points into the plugin, so a plugin update also updates the command. `~/.local/bin` must be on the `PATH`.

## Machine setup, once per Mac

1. Install 1Password CLI 2.42.0 or later from Homebrew (`brew install 1password-cli`). Keep no second copy of `op` on the `PATH`.
2. In the 1Password app, turn on Settings > Developer > "Integrate with 1Password CLI".
3. In System Settings > Privacy & Security > Files & Folders > Terminal, turn on "Data shared by 1Password and affiliated apps".
4. The app that hosts agents must not have that permission.

`secrets status` checks points 1 and 4. Agents cannot see points 2 and 3, so the setup window checks them at its first `op` call and names the setting to turn on.

A `secrets status` run inside a sandboxed tool call cannot prove point 4. Run `secrets status` in a normal terminal of the host app to prove it.

Set `SECRETS_OP_ACCOUNT` to the 1Password account for secrets in the owner's shell profile. The setup window does not get the agent's environment, so a variable that only the agent has is not seen there.

## Subcommands

| Command | What it does |
|---|---|
| `secrets setup PROJECT [--import FILE[:STAGE]]... [--guard NAME,...] [--renew]` | Opens a Terminal window. The owner checks the screen and presses Enter, then approves one Touch ID prompt. It creates what is missing: the vaults, the service account, the token in `agent-tokens` and in the Keychain. With `--import` it copies each value into an item and writes the refs files. Names in `--guard` are guarded: the item goes into the project vault with the tag `high-value`, and the refs line goes into the guarded refs file. `--renew` creates a new service account after the owner revoked the old token. |
| `secrets run [--stage NAME] [--guarded] -- CMD` | Reads the refs file, takes the token from the Keychain, and starts CMD through `op run`. |
| `secrets import [--names-only] FILE[:STAGE]...` | Copies the values of env files into the project vault and writes the refs lines. |
| `secrets add NAME [--stage NAME]` | Reads one value from stdin or a hidden prompt, stores it, and adds the refs line. |
| `secrets status` | Prints names only: the refs of this repo (open and guarded), which items the token can read, and the machine setup. |

### `setup`

`setup` waits up to 15 minutes for the owner. Start it with `run_in_background`. The window shows each import file's full path and every name with its target vault. It is safe to run again: it creates only what is missing, and on a second Mac it installs the existing token into that Mac's Keychain.

A guard name is created or replaced like any other name. The window marks its line with `[guarded: Claude Code asks before use]`. The owner's Enter confirms the guard list.

Setup never removes a guard. When an import name is in a guarded refs file of the repo and is not in `--guard` of this run, setup stops before any write with `NAME is a guarded secret. Add NAME to --guard.` Only the owner removes a guard: the owner removes the line from the guarded refs file and the tag `high-value` from the item.

### `run`

The exit code of the command passes through. Ctrl-C gives 130. A program that stops `secrets run` must signal the process group, as a terminal does for Ctrl-C. A signal to the `secrets` process alone waits until the command ends. The command never gets the service-account token. If a ref cannot be read, `run` stops before it starts the command and names each item. A guarded item that is missing gets the same line as any other item.

`op run` hides every match of a secret value in the output of the command. A short value, such as `info`, also matches ordinary words, so it hides them too.

### `import` and the env parser

The stage is `<x>` for `.env.<x>`, the default for `.env` and `.env.local`, and `FILE:STAGE` wins. `import` takes at most 50 names per file. Larger files go through `secrets setup --import`. `import` and `add` refuse a guarded name, a title that a guarded ref uses, and an item that has the tag `high-value`.

`--names-only` marks a value shorter than 8 characters. The marked value is masked in all output of `secrets run`.

The parser stops and names the line for any form that env loaders read differently: `$` or `\` in a value, backtick quotes, `#` without quotes in an unquoted value, a stray CR, and a multi-line value. The owner stores such a value with `secrets add NAME`, or creates the item in the 1Password app, and removes the line from the env file. The same name twice for one stage also stops the import.

A command under `secrets run` sees no terminal on stdout and stderr. A program that checks for a terminal acts as if its output goes to a pipe.

`secrets run` cannot read the Keychain from a plain SSH shell. Run it in a terminal on the Mac. Plain SSH is not supported yet.

## Guarded secrets

A guarded secret is a name in a guarded refs file (`.secrets-refs.guarded`, or `.secrets-refs.STAGE.guarded`). Its item is in the project vault, with the tag `high-value`. To open a guarded name for good, the owner removes its line from the guarded refs file and removes the tag `high-value` from the item in 1Password.

`secrets run` loads the open refs file only. `secrets run --guarded` also loads the guarded refs file of the stage.

The plugin ships a `PreToolUse` hook for the Bash tool and the Monitor tool (`hooks/hooks.json`, `hooks/guard-ask.sh`). When a command runs `secrets run` with `--guarded`, the hook returns the decision `ask`. Claude Code then asks the owner, also in auto mode and in a subagent. The prompt shows the reason and the choices Yes and No. The hook never allows or denies a command. If the hook cannot start (for example right after a plugin update, until the session restarts), Claude Code runs the command with no prompt.

A headless session (`claude -p`) has no person to ask, so Claude Code denies a `--guarded` command there.

The hook reads the text of the Bash command. It matches the bare name, a path to `secrets`, an environment prefix, `--stage NAME` before or after the flag, `sh -c '...'`, and one part of a compound command. It can match more than it must: a `git commit -m` message or a heredoc that holds the text `secrets run --guarded` also asks, and is denied in a headless session.

### What this does not protect

The guard is a Claude Code rule. It is not a 1Password lock. The service account of the project can read a guarded item at any time. An agent that calls `op` directly with the Keychain token, or that writes the command in a form the hook does not match (a variable that holds the flag, a script file), reads the secret with no prompt. A `--guarded` call inside a script file or an npm script gets no prompt either, because the hook sees only the text of the Bash command. The skill forbids that form.

The guard stops a mistake and an unnoticed use by an agent that follows the skill. It does not stop a hostile agent.

### Allow rules for auto mode

Auto mode needs two allow rules, one for `secrets import --names-only` and one for `secrets setup`. Add them to the Claude Code permissions (`allow`):

```
Bash(secrets import --names-only *)
Bash(secrets setup *)
```

Add no rule for `secrets run --guarded`. The owner should see that prompt.

## Vaults and files

| Part | Name |
|---|---|
| Project vault | `PROJECT` (read and write for the project's service account) |
| Shared vault | `agent-shared` (read only for every service account) |
| Token source | item `PROJECT` in the vault `agent-tokens` |
| Token copy | Keychain item `op-sa-PROJECT` |
| Refs files | `.secrets-refs`, `.secrets-refs.STAGE`, and the same with `.guarded` at the end |

Approval is a Claude Code prompt, as described in "Guarded secrets". The owner changes the value of a guarded item in the 1Password app or through `secrets setup`.
