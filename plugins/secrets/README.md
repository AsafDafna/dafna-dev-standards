# secrets

One command, `secrets`, for secrets from 1Password. People and agents use the same command. The repo holds names and `op://` addresses in `.secrets-refs`, never values. Each project has its own 1Password vault and its own service account, and an agent reads only that vault.

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
| `secrets setup PROJECT [--import FILE[:STAGE]]... [--guard NAME,...] [--renew]` | Opens a Terminal window. The owner checks the screen and presses Enter, then approves one Touch ID prompt. It creates what is missing: the vaults, the service account, the token in `agent-tokens` and in the Keychain. With `--import` it copies each value into an item and writes the refs files. Names in `--guard` go to the vault `PROJECT-guarded`. `--renew` creates a new service account after the owner revoked the old token. |
| `secrets run [--stage NAME] [--guarded] -- CMD` | Reads the refs file, takes the token from the Keychain, and starts CMD through `op run`. |
| `secrets import [--names-only] FILE[:STAGE]...` | Copies the values of env files into the project vault and writes the refs lines. |
| `secrets add NAME [--stage NAME]` | Reads one value from stdin or a hidden prompt, stores it, and adds the refs line. |
| `secrets status` | Prints names only: the refs of this repo, which items the token can read, which items carry the `high-value` tag, and the machine setup. |

### `setup`

`setup` waits up to 15 minutes for the owner. Start it with `run_in_background`. The window shows each import file's full path and every name with its target vault. It is safe to run again: it creates only what is missing, and on a second Mac it installs the existing token into that Mac's Keychain.

A guard name whose item is already in the project vault is skipped with a notice. Agents can write that vault, so an item there proves nothing about who put it there. Setup does not read or change it. If the owner did not move it there, the owner deletes it, or moves it to `PROJECT-guarded`, and runs setup again. A name that is not guarded whose item is in the guarded vault stops the setup.

### `run`

The exit code of the command passes through. Ctrl-C gives 130. A program that stops `secrets run` must signal the process group, as a terminal does for Ctrl-C. A signal to the `secrets` process alone waits until the command ends. The command never gets the service-account token. If a ref cannot be read, `run` stops before it starts the command and names each item. For a guarded item it adds: ask the owner to move it.

`op run` hides every match of a secret value in the output of the command. A short value, such as `info`, also matches ordinary words, so it hides them too.

### `import` and the env parser

The stage is `<x>` for `.env.<x>`, the default for `.env` and `.env.local`, and `FILE:STAGE` wins. `import` takes at most 50 names per file. Larger files go through `secrets setup --import`. `import` and `add` refuse a guarded name, and a title that a guarded ref uses.

`--names-only` marks a value shorter than 8 characters. The marked value is masked in all output of `secrets run`.

The parser stops and names the line for any form that env loaders read differently: `$` or `\` in a value, backtick quotes, `#` without quotes in an unquoted value, a stray CR, and a multi-line value. The owner stores such a value with `secrets add NAME`, or creates the item in the 1Password app, and removes the line from the env file. The same name twice for one stage also stops the import.

## Vaults and files

| Part | Name |
|---|---|
| Project vault | `PROJECT` (read and write for the project's service account) |
| Guarded vault | `PROJECT-guarded` (the owner only) |
| Shared vault | `agent-shared` (read only for every service account) |
| Token source | item `PROJECT` in the vault `agent-tokens` |
| Token copy | Keychain item `op-sa-PROJECT` |
| Refs files | `.secrets-refs`, `.secrets-refs.STAGE`, and the same with `.guarded` at the end |

Approval is a move. The owner moves an item from `PROJECT-guarded` to `PROJECT` in the 1Password app, and the agent reads it within seconds.
