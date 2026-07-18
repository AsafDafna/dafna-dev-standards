# Windows Dev Environment Setup — Ubuntu WSL + herdr + Ghostty

This describes a complete, reproducible terminal dev environment on
**Windows 11** using **WSL2 (WSLg)**, the **Ghostty** terminal emulator, and
the **herdr** workspace manager for AI coding agents. It launches from a
single Windows shortcut (or the `devenv` command).

Everything below was built and verified on:
- **Windows 11** with WSL2 + WSLg (GUI app support)
- **Ubuntu 26.04 LTS** (`resolute`)
- **Ghostty 1.3.0** (from the Ubuntu `universe` repo)
- **herdr 0.7.4** (`~/.local/bin/herdr`)

---

## 0. Prerequisites

1. **Windows 11** (Windows 10 21H2+ also has WSLg, but this was built on 11).
2. **WSL2 with a distro installed.** Confirm WSLg (GUI) works:
   ```bash
   echo "$DISPLAY $WAYLAND_DISPLAY"   # expect ":0 wayland-0"
   ls /mnt/wslg                       # should exist
   ```
   If empty, update WSL from Windows: `wsl --update`, then `wsl --shutdown`.
3. **Ubuntu 26.04+** recommended (Ghostty is packaged in its repos). On older
   Ubuntu, install Ghostty from the community `.deb`
   (https://github.com/mkasberg/ghostty-ubuntu) or Snap instead — see step 3.

---

## 1. Put `~/.local/bin` on PATH

herdr and the `devenv` launcher live in `~/.local/bin`, which isn't on PATH by
default. Append to `~/.bashrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Apply with `source ~/.bashrc` (or a new terminal).

---

## 2. Install & configure herdr

herdr (https://herdr.dev) is a terminal workspace manager for AI coding agents.
Install per its own instructions so the binary lands at `~/.local/bin/herdr`.

Generate a config from its documented defaults, then enable the UI tweaks:

```bash
mkdir -p ~/.config/herdr
herdr --default-config > ~/.config/herdr/config.toml
```

Non-default settings we applied (in `~/.config/herdr/config.toml`):

```toml
onboarding = false

[theme]
name = "terminal"        # inherit the terminal's own palette
auto_switch = false

[ui]
pane_borders = true      # draw borders around split panes
pane_gaps = true         # keep split panes visually separated
accent = "cyan"          # accent for highlights, borders, nav UI
```

Validate + hot-reload without restarting:

```bash
herdr config check
herdr server reload-config
```

**Note:** `pane_borders` only draws dividers when a tab actually contains a
**split** (`Ctrl+B` then `split_vertical`, or Ghostty's `Ctrl+Shift+Enter`).
A single pane shows no borders — expected.

---

## 3. Install & configure Ghostty

On Ubuntu 26.04+ it's in the repos:

```bash
sudo apt-get update
sudo apt-get install -y ghostty
```

(Older Ubuntu: community `.deb` from `mkasberg/ghostty-ubuntu`, or
`sudo snap install ghostty --classic`.)

Write `~/.config/ghostty/config` — see **Appendix A** for the full file. Key
WSLg-relevant choices:
- `background-opacity = 1.0` — under WSLg even slight transparency composites as
  fully see-through; keep it opaque.
- `split-divider-color`, `unfocused-split-opacity`, `unfocused-split-fill` — make
  Ghostty's own split dividers visible.
- Font stack (see step 4).

Reload live in-window with **`Ctrl+Shift+,`**.

---

## 4. Install Nerd Fonts (icon glyphs)

Gives prompts/tools (Starship, `eza`, `lazygit`, git glyphs) real icons instead
of `□` boxes. `unzip` may be absent — extract with Python.

```bash
mkdir -p ~/.local/share/fonts

# Complete JetBrainsMono Nerd Font family (~124MB download, all weights/italics)
curl -fsSL -o /tmp/jbm.zip \
  https://github.com/ryanoasis/nerd-fonts/releases/latest/download/JetBrainsMono.zip
python3 - <<'PY'
import zipfile, os
z = zipfile.ZipFile("/tmp/jbm.zip")
dest = os.path.expanduser("~/.local/share/fonts")
for n in z.namelist():
    if n.lower().endswith((".ttf", ".otf")):
        open(os.path.join(dest, os.path.basename(n)), "wb").write(z.read(n))
PY

# (Optional) Symbols-only Nerd Font — icons only, good as a lightweight fallback
curl -fsSL -o /tmp/sym.zip \
  https://github.com/ryanoasis/nerd-fonts/releases/latest/download/NerdFontsSymbolsOnly.zip
python3 - <<'PY'
import zipfile, os
z = zipfile.ZipFile("/tmp/sym.zip")
dest = os.path.expanduser("~/.local/share/fonts")
for n in z.namelist():
    if n.lower().endswith(".ttf"):
        open(os.path.join(dest, os.path.basename(n)), "wb").write(z.read(n))
PY

fc-cache -f ~/.local/share/fonts
fc-list | grep -i 'nerd font' | head   # verify
```

Ghostty font stack (in the config, in priority order):
```
font-family = "JetBrainsMono Nerd Font"   # primary text + icons
font-family = "Ubuntu Sans Mono"          # text fallback
font-family = "Symbols Nerd Font Mono"    # symbol fallback
```

**Zero-downside alternative:** if you want to keep a different primary text font,
install *only* the Symbols-Only Nerd Font (~2.8MB) and list it as a secondary
`font-family`. Text is unchanged; icons resolve via fallback.

---

## 5. The `devenv` launcher

`~/.local/bin/devenv` opens Ghostty running herdr as one environment. Full file
in **Appendix B**. Two non-obvious things it does — **both required** (see
Gotchas):
1. Forces Mesa **software rendering** (`LIBGL_ALWAYS_SOFTWARE=1`,
   `GALLIUM_DRIVER=llvmpipe`) — WSLg's GPU path can't create Ghostty's GL surface.
2. Runs herdr through a **login shell** (`bash -lc`) so it inherits `$TERM`,
   `$SHELL`, PATH.

```bash
chmod +x ~/.local/bin/devenv
```

The launcher (Appendix B) already uses `$HOME/.local/bin/herdr` rather than a
hardcoded user path, so it works for any account. `/usr/bin/ghostty` is left
as a literal path because that's where the apt package puts the binary
(**this guide's install method**, step 3); it is not user-specific, so no
substitution is needed there either. If you instead installed via
`snap install ghostty --classic`, the binary lands at `/snap/bin/ghostty` —
update the launcher's `exec` line accordingly, or replace the literal path
with `command -v ghostty` so it resolves correctly regardless of install
method.

---

## 6. Windows shortcut (clickable launch, no console window)

**Use `wslg.exe`, not a VBS/`wscript` launcher, and not `wsl.exe -e`.**

- `wslg.exe` (`C:\Program Files\WSL\wslg.exe`) is the GUI-app launcher: **no
  console window**, no Windows Script Host.
- It uses **`--`** to pass the command through — it has **no `-e` flag** (that's
  `wsl.exe`). Passing `-e` just pops a usage dialog.

Shortcut target/args:
```
Target    : C:\Program Files\WSL\wslg.exe
Arguments : -d Ubuntu --cd ~ -- /home/<user>/.local/bin/devenv
WorkDir   : %USERPROFILE%
Icon      : C:\Apps\ghostty.ico,0
```
`-d Ubuntu` is the distro name (list yours with `wsl -l`); `/home/<user>/...`
is the Linux-side path to `devenv` — substitute your actual Linux username.

Create the shortcuts from WSL via PowerShell (resolves Desktop/Start Menu even if
OneDrive-redirected). See **Appendix C** for the full script. It writes shortcuts
to Desktop, Start Menu, and a local `C:\Apps\`.

### Icon
Ghostty's Linux icon is a PNG; a `.lnk` needs an `.ico`. Build a multi-size `.ico`
from Ghostty's shipped PNGs with no ImageMagick needed — see **Appendix D**.
Output: `C:\Apps\ghostty.ico`.

### Taskbar pin
Windows 11 blocks programmatic taskbar pinning. The user must **right-click the
shortcut → Pin to taskbar** once (it inherits the icon). Not scriptable.

---

## 7. Verification

```bash
# From a PLAIN Ubuntu terminal (NOT inside a herdr pane — see Gotchas):
devenv
# → a Ghostty window opens running herdr. Launch log: ~/.local/share/devenv/launch.log
```
Then double-click the Windows shortcut ("Dev Environment"). Same result, no
console window.

---

## Gotchas / hard-won lessons (put these in the plugin's troubleshooting section)

| Symptom | Cause | Fix |
|---|---|---|
| Ghostty window never opens; log shows `MESA: error: ZINK: failed to choose pdev` / `egl: failed to create dri2 screen` | WSLg's d3d12/zink GPU path can't create Ghostty's GL surface | `export LIBGL_ALWAYS_SOFTWARE=1` (+ `GALLIUM_DRIVER=llvmpipe`) — baked into `devenv` |
| Window is see-through / text behind it shows | `background-opacity < 1.0` composites as fully transparent under WSLg | Set `background-opacity = 1.0` |
| `error: nested herdr is disabled by default` | herdr launched from **inside** an existing herdr pane (env has `HERDR_ENV=1`) | Launch from a clean shell / the Windows shortcut, not from within herdr |
| Shortcut shows "Windows Script Host failed (not enough memory)" or "Windows cannot find `\\`" | VBS/`wscript` launcher is unreliable on the host | Ditch VBS — point `.lnk` directly at `wslg.exe` |
| `wslg.exe` pops a usage dialog | Passed `-e` (a `wsl.exe` flag); `wslg.exe` has none | Use `--` to pass the command: `wslg.exe -d Ubuntu -- <cmd>` |
| No split dividers visible in herdr | `pane_borders` only draws between **split** panes; a single pane has none | Split a pane (`Ctrl+B` `split_vertical`) |
| Testing Windows launchers *from inside WSL* fails with `\\wsl.localhost\...` UNC errors | Windows processes spawned from a WSL cwd inherit an unsupported UNC working dir | Not a real-world issue — Explorer clicks provide a valid cwd. Only bites when testing via `cmd.exe` from WSL |

---

## Appendix A — `~/.config/ghostty/config`

```
# ---- Font ----
font-family = "JetBrainsMono Nerd Font"
font-family = "Ubuntu Sans Mono"
font-family = "Symbols Nerd Font Mono"
font-size = 13
adjust-cell-height = 8%

# ---- Theme / colors ----
theme = "Catppuccin Mocha"
background-opacity = 1.0

# ---- Window ----
window-padding-x = 10
window-padding-y = 8
window-decoration = true
window-save-state = always

# ---- Splits / pane separators ----
split-divider-color = #6c7086
unfocused-split-opacity = 0.85
unfocused-split-fill = #181825

# ---- Scrollback & behavior ----
scrollback-limit = 100000
copy-on-select = clipboard
confirm-close-surface = false
mouse-hide-while-typing = true

# ---- Cursor ----
cursor-style = bar
cursor-style-blink = true
shell-integration-features = cursor,sudo,title

# ---- Keybindings ----
keybind = ctrl+shift+enter=new_split:right
keybind = ctrl+shift+o=new_split:down
keybind = ctrl+shift+left=goto_split:left
keybind = ctrl+shift+right=goto_split:right
keybind = ctrl+shift+up=goto_split:up
keybind = ctrl+shift+down=goto_split:down
keybind = ctrl+shift+t=new_tab
keybind = ctrl+tab=next_tab
keybind = ctrl+shift+tab=previous_tab
keybind = ctrl+equal=increase_font_size:1
keybind = ctrl+minus=decrease_font_size:1
keybind = ctrl+zero=reset_font_size
```

## Appendix B — `~/.local/bin/devenv`

```bash
#!/usr/bin/env bash
# Launch the Ghostty + herdr dev environment together.

# WSLg's GPU driver (d3d12/zink) fails to create an OpenGL surface for Ghostty,
# which kills the window on launch. Force Mesa software rendering (llvmpipe).
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe

# Capture Ghostty's own launch output for diagnosis of failed clicks.
LOG="$HOME/.local/share/devenv/launch.log"
mkdir -p "$(dirname "$LOG")"
printf '\n===== launch %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG"

# Run herdr through a login shell so it inherits a proper environment
# ($TERM, $SHELL, PATH). Launching it bare via `-e` starves it of that env.
exec /usr/bin/ghostty -e bash -lc 'exec "$HOME/.local/bin/herdr"' "$@" >>"$LOG" 2>&1
```

## Appendix C — Create Windows shortcuts (PowerShell, run from WSL)

```powershell
$ErrorActionPreference = 'Stop'
$wslg  = 'C:\Program Files\WSL\wslg.exe'
$distro = 'Ubuntu'                                  # <-- your distro (wsl -l)
$linuxCmd = '/home/<user>/.local/bin/devenv'        # <-- generalize to your user
$args = "-d $distro --cd ~ -- $linuxCmd"
$icon = 'C:\Apps\ghostty.ico'

New-Item -ItemType Directory -Force -Path 'C:\Apps' | Out-Null
$ws = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop'))  'Dev Environment.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Dev Environment.lnk'),
  'C:\Apps\Dev Environment.lnk'
)
foreach ($p in $targets) {
  $lnk = $ws.CreateShortcut($p)
  $lnk.TargetPath       = $wslg
  $lnk.Arguments        = $args
  $lnk.WorkingDirectory = $env:USERPROFILE
  $lnk.IconLocation     = "$icon,0"
  $lnk.Description       = 'Ghostty + herdr dev environment'
  $lnk.Save()
}
```

Invoke from WSL (run from a Windows cwd to avoid the UNC issue):
```bash
cmd.exe /c 'cd /d C:\ && powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\path\to\make-shortcut.ps1'
```

## Appendix D — Build `ghostty.ico` from shipped PNGs (no ImageMagick)

```bash
python3 - <<'PY'
import struct, os
srcs = {
  16:  "/usr/share/icons/hicolor/16x16/apps/com.mitchellh.ghostty.png",
  32:  "/usr/share/icons/hicolor/32x32/apps/com.mitchellh.ghostty.png",
  128: "/usr/share/icons/hicolor/128x128/apps/com.mitchellh.ghostty.png",
  256: "/usr/share/icons/hicolor/256x256/apps/com.mitchellh.ghostty.png",
}
imgs = [(s, open(p, "rb").read()) for s, p in sorted(srcs.items())]
out = "/mnt/c/Apps/ghostty.ico"; os.makedirs("/mnt/c/Apps", exist_ok=True)
n = len(imgs); data = struct.pack("<HHH", 0, 1, n)
offset = 6 + 16 * n; entries = b""; blobs = b""
for size, blob in imgs:
    w = h = (0 if size >= 256 else size)
    entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
    blobs += blob; offset += len(blob)
open(out, "wb").write(data + entries + blobs)
print("wrote", out)
PY
```

---

## Summary of artifacts created

| Path | Purpose |
|---|---|
| `~/.bashrc` (PATH line) | puts `~/.local/bin` on PATH |
| `~/.local/bin/herdr` | herdr binary (user-installed) |
| `~/.config/herdr/config.toml` | herdr UI config (pane borders, cyan accent) |
| `~/.config/ghostty/config` | Ghostty config (opaque, fonts, splits, keybinds) |
| `~/.local/share/fonts/` | JetBrainsMono + Symbols Nerd Fonts |
| `~/.local/bin/devenv` | one-shot launcher (Ghostty → herdr) |
| `~/.local/share/devenv/launch.log` | per-launch diagnostic log |
| `C:\Apps\ghostty.ico` | Windows icon for shortcuts |
| `Dev Environment.lnk` ×3 | Desktop / Start Menu / `C:\Apps` shortcuts → `wslg.exe` |
