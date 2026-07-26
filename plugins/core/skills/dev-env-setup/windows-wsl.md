# Windows Dev Environment Setup — Ubuntu WSL + herdr + Ghostty

This describes a complete, reproducible terminal dev environment on
**Windows 11** using **WSL2 (WSLg)**, the **Ghostty** terminal emulator, and
the **herdr** workspace manager for AI coding agents. It launches from a
single Windows shortcut (or the `devenv` command).

Everything below was built and verified on a single reference machine. Where
this guide gives a value rather than a formula, it is the value running there:

| | |
|---|---|
| Host | Windows 11, 64 GB RAM, 20 logical CPUs, NVIDIA RTX 4070 Laptop (Optimus) |
| WSL | 2.7.11.0 · kernel 6.18.33.2-2 · WSLg 1.0.73.2 · MSRDC 1.2.7214 |
| Distro | Ubuntu 26.04 LTS (`resolute`), systemd enabled |
| VM | `memory=24GB`, `processors=12`, `swap=4GB` (see §9) |
| Terminal | Ghostty 1.3.0 (Ubuntu `universe`) + herdr 0.7.4 (`~/.local/bin/herdr`) |

Scale the VM numbers to your host; keep the *shape* the §9 rationale describes.

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
in **Appendix B**. Two non-obvious things it does:

1. **Picks a renderer at launch, then falls back.** It probes whether a d3d12
   GPU device is usable and exports the GPU path if so, dropping to Mesa
   software rendering (`LIBGL_ALWAYS_SOFTWARE=1`, `GALLIUM_DRIVER=llvmpipe`) only
   when no GPU answers. Both halves matter — see below.
2. Runs herdr through a **login shell** (`bash -lc`) so it inherits `$TERM`,
   `$SHELL`, PATH.

```bash
sudo apt-get install -y mesa-utils-extra   # provides eglinfo, used by the probe
chmod +x ~/.local/bin/devenv
```

**`eglinfo` is a real dependency, not a nicety.** Without it the probe cannot
verify a GPU and deliberately falls back to software rendering — so a missing
`mesa-utils-extra` silently costs you the 4.5× the next section describes. The
chosen path is recorded on the `renderer:` line of `launch.log` at every launch;
check there if Ghostty feels slow.

### Why probe instead of pinning either one

Software rendering is not free: measured on the reference machine over identical
output (~3,200 lines in 15 s), `llvmpipe` burned **156% of a CPU core** against
d3d12's **32%** — about 4.5× the cost, continuously, just to draw a terminal.

But pinning d3d12 unconditionally is not safe either. Windows powers the discrete
GPU down when nothing appears to need it (Optimus, §8), and starting Ghostty on
d3d12 while no adapter answers reproduces the blank-unfocusable-window failure,
which costs a `wsl --shutdown` to clear. So the launcher checks, and software
rendering remains the guaranteed fallback rather than the default.

The probe deliberately asks *"is any d3d12 device usable"*, not *"is the NVIDIA
one awake"*. If the discrete GPU is asleep, Mesa answers with the Intel iGPU over
d3d12 — still hardware rendering, still far cheaper than `llvmpipe`. It uses
`eglinfo -p wayland` (~0.7 s): EGL is the path Ghostty actually uses, and it is
3× faster than probing every platform.

> **The launcher's exports apply to Ghostty itself, and nothing in `~/.bashrc`
> does.** `devenv` is started by `wslg.exe` (its parent is `/init`), which is not
> a login shell — so `~/.bashrc` is never sourced for the Ghostty process. Only
> the shells *inside* the terminal read `.bashrc`. This is why the GPU exports in
> §8 do not, on their own, move Ghostty onto the GPU: the launcher has to do it.

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

## 8. Optional: force the NVIDIA GPU on an Optimus laptop

On dual-GPU (Intel + NVIDIA Optimus) laptops, WSLg defaults to the integrated
GPU to save power, so `glxinfo -B` reports an Intel device or `llvmpipe`
(software) instead of the discrete GPU.

**What this section does and does not reach.** These are `.bashrc` exports, so
they apply to GUI apps you start *from inside* the terminal. They do **not**
reach Ghostty itself — `devenv` is not a login shell (§5). Ghostty gets onto the
GPU through the launcher's own probe, not through anything here.

Where this section *does* matter for Ghostty is the Windows-side step at the end:
keeping the discrete GPU from powering down is what makes the launcher's probe
succeed rather than fall back to software rendering.

### WSL-side environment variables

```bash
echo 'export MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA' >> ~/.bashrc
echo 'export GALLIUM_DRIVER=d3d12' >> ~/.bashrc
source ~/.bashrc
```

Both are required. `MESA_D3D12_DEFAULT_ADAPTER_NAME` alone is not always
enough; without `GALLIUM_DRIVER=d3d12`, Mesa can silently fall back to
`llvmpipe` rather than erroring.

### Verify

```bash
sudo apt install -y mesa-utils   # if glxinfo isn't installed
glxinfo -B | grep Device
```

Expect `Device: D3D12 (NVIDIA GeForce RTX ... Laptop GPU)`.

**`glxinfo` run inside the terminal does not tell you what Ghostty is doing.**
For Ghostty, read the `renderer:` line `devenv` writes to `launch.log`, or check
the process environment directly.
Under `devenv` the honest check is Ghostty's own process environment:

```bash
tr '\0' '\n' < /proc/$(pgrep -x ghostty | head -1)/environ | grep -E 'GALLIUM|LIBGL|MESA'
```

If that shows `llvmpipe`, Ghostty is on software rendering no matter what
`glxinfo` says. (Observed 2026-07-26: `glxinfo` reported the RTX 4070 while
Ghostty burned ~1 full core on llvmpipe.)

If `glxinfo` still shows `llvmpipe`, confirm the GPU is reachable at all with
`GALLIUM_DRIVER=d3d12 glxinfo -B | grep Device`. If that works but the
`.bashrc` export doesn't, the WSLg session started before the variable was set:
`wsl --shutdown` from PowerShell, then reopen.

### Diagnostics when it won't take

- `ls -la /dev/dxg` — the GPU passthrough device must exist.
- `echo $DISPLAY` — `:0` under WSLg.
- `env | grep -iE 'mesa|libgl'` — check for conflicting overrides, especially
  `LIBGL_ALWAYS_SOFTWARE=1` inherited from `devenv`.
- `ls /usr/lib/x86_64-linux-gnu/dri/ | grep d3d12` — the `d3d12_dri.so` driver
  must be installed.
- `wsl --version` (PowerShell) — WSL/WSLg/DXCore reasonably current.

CUDA/compute (PyTorch, `nvidia-smi`) is unaffected by all of this — it uses the
NVIDIA driver on the Windows host directly. This section is only about the Mesa
OpenGL path used by WSLg GUI apps.

### Why it reverts every so often

Windows powers down the discrete GPU when nothing appears to need it (Optimus
power management). While it's down, WSL's passthrough may not see the NVIDIA
adapter, so the env vars bind to nothing and rendering silently falls back to
software.

Recent Windows/NVIDIA drivers moved GPU preference out of the NVIDIA Control
Panel into Windows Settings:

1. **Settings → System → Display → Graphics**
2. **Browse**, add `C:\Windows\System32\wsl.exe`
3. Set it to **High performance**
4. `wsl --shutdown`, then reopen

**Do NOT disable the Intel GPU in Device Manager.** On most Optimus laptops the
built-in panel is physically wired through the iGPU — disabling it can black out
the laptop screen. Only safe with an external monitor wired to the dGPU.

---

## 9. Size the VM before you trust it

**WSL2's default is 50% of host RAM. If a `.wslconfig` exists, whatever it says
wins — including a value someone pasted from a blog years ago.** Check yours
before debugging any freeze:

```bash
cat /mnt/c/Users/<you>/.wslconfig     # may not exist; that's fine
nproc && free -h                      # what the VM actually got
```

### The freeze class this prevents

Symptom: Ghostty and everything else lock up hard, Windows Task Manager shows
the disk pinned at 85–95%, and only killing WSL recovers it.

Root cause (diagnosed 2026-07-26): **memory exhaustion with no OOM kill.** A
single `node` process reached 2.87 GB inside a 6 GB VM that was already running
Docker, a Postgres stack, three dev servers and two agent sessions.
MemAvailable fell to 84 MB, swap filled completely, load hit 35 on 4 vCPUs.

The pathology is the part worth internalising: **nothing was ever killed.**
Because swap was available, the kernel preferred endless reclaim to invoking the
OOM killer, so there was no exit path and no `dmesg` OOM line. The 85–95% disk
was swap thrash — a *symptom* of the reclaim loop, not its cause.

The same exhaustion also produces the blank-window failure in the gotchas table:
a VM this deep in reclaim cannot complete a GTK surface allocation.

### Sizing

This is the reference machine's `.wslconfig` verbatim (`C:\Users\<you>\.wslconfig`):

```ini
[wsl2]
memory=24GB          # ~38% of a 64GB host; WSL's own default is 50%
processors=12        # of 20 logical; leaves 8 for Windows
swap=4GB             # deliberately SMALL — see below

[experimental]
autoMemoryReclaim=gradual
```

Scale to your host, but keep the *shape*:

- **Swap small, not large.** Swap is the thrash runway. Having 2 GB to grind
  through is exactly why the kernel never OOM-killed anything. A fast kill of one
  process beats a frozen VM — a failed build is recoverable, a dead VM is not.
- **Bound the runaway too.** Raising the cap removes today's constraint but adds
  no guardrail; a real leak will fill 24 GB just as happily. Add to `~/.bashrc`:
  ```bash
  export NODE_OPTIONS="--max-old-space-size=4096"
  ```
  Note Ubuntu's `.bashrc` returns early for non-interactive shells, so this
  covers terminal-launched builds (and their children) but not systemd units;
  use `~/.config/environment.d/` if you need those too.
- **Know what `autoMemoryReclaim` costs.** It returns idle pages to Windows so
  `memory=` stays a ceiling rather than a standing reservation — but it does that
  by swapping them out. On the reference machine, swap climbed steadily from 0 to
  ~1.3 GB over an hour while 22 GB stayed free and memory pressure sat at 0.00.
  That is expected behaviour, not a fault: if you see swap in use with plenty of
  RAM free, this is why, and it is not the freeze above (check `mem_full`, which
  stays at 0.00). It is enabled here and stable; drop the `[experimental]` block
  if you would rather trade host RAM for zero swap churn.

Changes need `wsl --shutdown` to take effect, which kills every session in the
distro. Verify after with `free -h` and `nproc`.

---

## Gotchas / hard-won lessons (put these in the plugin's troubleshooting section)

| Symptom | Cause | Fix |
|---|---|---|
| Ghostty window never opens; log shows `MESA: error: ZINK: failed to choose pdev` / `egl: failed to create dri2 screen` | No GPU adapter answered, so zink had no physical device to choose. On an Optimus laptop this is usually the discrete GPU being powered down (§8), not a broken driver | `devenv`'s probe handles it: it falls back to `LIBGL_ALWAYS_SOFTWARE=1` + `GALLIUM_DRIVER=llvmpipe` automatically (§5). Fix the *cause* via the Windows High-performance setting in §8 so the probe succeeds and you keep the GPU path |
| Window is see-through / text behind it shows | `background-opacity < 1.0` composites as fully transparent under WSLg | Set `background-opacity = 1.0` |
| `error: nested herdr is disabled by default` | herdr launched from **inside** an existing herdr pane (env has `HERDR_ENV=1`) | Launch from a clean shell / the Windows shortcut, not from within herdr |
| Shortcut shows "Windows Script Host failed (not enough memory)" or "Windows cannot find `\\`" | VBS/`wscript` launcher is unreliable on the host | Ditch VBS — point `.lnk` directly at `wslg.exe` |
| `wslg.exe` pops a usage dialog | Passed `-e` (a `wsl.exe` flag); `wslg.exe` has none | Use `--` to pass the command: `wslg.exe -d Ubuntu -- <cmd>` |
| No split dividers visible in herdr | `pane_borders` only draws between **split** panes; a single pane has none | Split a pane (`Ctrl+B` `split_vertical`) |
| Testing Windows launchers *from inside WSL* fails with `\\wsl.localhost\...` UNC errors | Windows processes spawned from a WSL cwd inherit an unsupported UNC working dir | Not a real-world issue — Explorer clicks provide a valid cwd. Only bites when testing via `cmd.exe` from WSL |
| Everything freezes hard; Windows Task Manager shows disk at 85–95%; only killing WSL recovers | VM memory exhausted, and with swap available the kernel reclaims forever instead of OOM-killing — no exit path, no `dmesg` OOM line. Disk load is swap thrash, a symptom | Size the VM (§9): raise `memory=`, keep `swap=` **small**, bound Node with `--max-old-space-size` |
| Ghostty window appears in the taskbar but is blank and cannot take focus | Same exhaustion as above — a VM deep in reclaim never completes the GTK surface allocation, so the Wayland surface never commits a buffer | `wsl --shutdown` recovers it; §9 prevents it. **Not** a GPU fault — see the next two rows |
| `launch.log` shows `Gtk: Trying to snapshot GtkRevealer … without a current allocation` | Nothing. This warning appears in perfectly healthy launches too | Ignore it. The real signal is whether repeated `gtk-xft-dpi` lines follow (frames rendering) or the log stops dead there |
| `glxinfo` reports the NVIDIA GPU, but Ghostty is visibly slow / burns a full CPU core | `glxinfo` inherits your shell's env and probes GLX; Ghostty inherits `devenv`'s and renders through EGL. The two can disagree — they are different processes on different paths | Check `/proc/$(pgrep -x ghostty)/environ` for the truth, and grep `launch.log` for the `renderer:` line `devenv` records. Probe with `eglinfo -p wayland`, not `glxinfo` (§5) |
| `/proc/pressure/io` shows 50–95% sustained stall on an idle VM | **PSI I/O accounting is unreliable on WSL2.** Measured 2026-07-26: 15.7% claimed vs 64ms of real disk busy time in a 10s window (~25× over), pinned at 95% for an hour at load 0.06 | Ignore `io_*`. Use `/proc/diskstats` io_ticks for real disk load, and `mem_full` + swap + MemAvailable to diagnose freezes |

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
# Opens a Ghostty window that runs herdr as its startup program.

# Capture Ghostty's own launch output for diagnosis of failed clicks.
LOG="$HOME/.local/share/devenv/launch.log"
mkdir -p "$(dirname "$LOG")"
printf '\n===== launch %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG"

# --- renderer selection -------------------------------------------------------
# Ghostty on Wayland renders through EGL. The GPU path (d3d12 → NVIDIA) costs
# roughly a quarter of the CPU that software rasterisation does: measured
# 2026-07-26 over identical output (~3,200 lines in 15s), llvmpipe burned 156% of
# a core against d3d12's 32%. So prefer the GPU.
#
# But do NOT pin d3d12 blindly. Windows powers the discrete GPU down when nothing
# appears to need it (Optimus), and starting Ghostty on d3d12 while the adapter is
# asleep reproduces the blank-unfocusable-window failure — which costs a
# `wsl --shutdown` to clear. So probe first and fall back to software rendering,
# which always works. Keeping the adapter awake is a Windows-side setting:
# Settings → System → Display → Graphics → add C:\Windows\System32\wsl.exe →
# High performance. With that set, the fallback should be a rare safety net.
#
# eglinfo (not glxinfo) is the right probe: Ghostty uses EGL, and the two paths
# can disagree — a GLX probe reported the NVIDIA GPU while Ghostty itself was on
# llvmpipe.
select_renderer() {
  [ -e /dev/dxg ] || { printf 'llvmpipe (no /dev/dxg — no GPU passthrough)'; return; }
  command -v eglinfo >/dev/null 2>&1 || {
    printf 'llvmpipe (eglinfo absent, cannot verify — install mesa-utils-extra)'; return; }
  # `-p wayland` restricts the probe to the platform Ghostty actually uses and is
  # ~3x faster than probing every platform (0.8s vs 2.5s of launch latency).
  #
  # This asks "is ANY d3d12 device usable", not "is the NVIDIA one awake" — by
  # design. If the discrete GPU is asleep, Mesa answers with the Intel iGPU over
  # d3d12, which is still hardware rendering and still far cheaper than llvmpipe.
  # Software rendering is reserved for the case where no GPU answers at all.
  if timeout 10 env GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA \
       eglinfo -p wayland -B 2>/dev/null | grep -qi 'd3d12'; then
    printf 'd3d12 (GPU adapter reachable)'
  else
    printf 'llvmpipe (no d3d12 device answered — GPU unavailable)'
  fi
}

RENDERER="$(select_renderer)"
case "$RENDERER" in
  d3d12*)
    unset LIBGL_ALWAYS_SOFTWARE MESA_LOADER_DRIVER_OVERRIDE __GLX_VENDOR_LIBRARY_NAME
    export GALLIUM_DRIVER=d3d12
    export MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA
    ;;
  *)
    # MESA_LOADER_DRIVER_OVERRIDE is the key one: it forces the *EGL* path to
    # llvmpipe, not just GLX.
    export LIBGL_ALWAYS_SOFTWARE=1
    export GALLIUM_DRIVER=llvmpipe
    export MESA_LOADER_DRIVER_OVERRIDE=llvmpipe
    export __GLX_VENDOR_LIBRARY_NAME=mesa
    ;;
esac
printf 'renderer: %s\n' "$RENDERER" >>"$LOG"

# --- pre-launch state snapshot (diagnostic only) ------------------------------
# The blank-unfocusable-window failure mode leaves no error in Ghostty's own
# output: the log is byte-identical to a good launch up to the GtkRevealer
# warning, then simply stops. So the discriminating evidence is the state of the
# VM *around* the launch, not Ghostty's stderr. Captured here because
# /mnt/wslg/stderr.log is per-VM and dies with a `wsl --shutdown`.
snapshot() {
  local when="$1"
  {
    printf -- '--- state @%s (%s) ---\n' "$when" "$(date '+%H:%M:%S')"
    printf 'vm_uptime_s: %s\n' "$(awk '{print int($1)}' /proc/uptime)"
    printf 'pressure_io: %s\n' "$(tr '\n' ' ' < /proc/pressure/io)"
    printf 'pressure_cpu: %s\n' "$(tr '\n' ' ' < /proc/pressure/cpu)"
    printf 'pressure_mem: %s\n' "$(tr '\n' ' ' < /proc/pressure/memory)"
    printf 'mem: %s\n' "$(free -m | awk '/^Mem:/{printf "total=%s used=%s avail=%s", $2, $3, $7}')"
    printf 'swap: %s\n' "$(free -m | awk '/^Swap:/{printf "total=%s used=%s", $2, $3}')"
    printf 'loadavg: %s\n' "$(cat /proc/loadavg)"
    printf 'gpu_env: GALLIUM_DRIVER=%s LIBGL_ALWAYS_SOFTWARE=%s MESA_LOADER_DRIVER_OVERRIDE=%s MESA_D3D12_DEFAULT_ADAPTER_NAME=%s\n' \
      "${GALLIUM_DRIVER:-unset}" "${LIBGL_ALWAYS_SOFTWARE:-unset}" \
      "${MESA_LOADER_DRIVER_OVERRIDE:-unset}" "${MESA_D3D12_DEFAULT_ADAPTER_NAME:-unset}"
    printf 'wayland: DISPLAY=%s WAYLAND_DISPLAY=%s dxg=%s\n' \
      "${DISPLAY:-unset}" "${WAYLAND_DISPLAY:-unset}" \
      "$([ -e /dev/dxg ] && echo present || echo MISSING)"
    # `pgrep -c` prints 0 AND exits non-zero on no-match, so a `|| echo 0`
    # fallback would double-print. Take the first line instead.
    printf 'already_running: ghostty=%s herdr=%s\n' \
      "$(pgrep -c -x ghostty 2>/dev/null | head -1)" \
      "$(pgrep -c -x herdr 2>/dev/null | head -1)"
    printf 'wslg_stderr (mtime %s):\n' \
      "$(stat -c %y /mnt/wslg/stderr.log 2>/dev/null || echo unreadable)"
    tail -5 /mnt/wslg/stderr.log 2>/dev/null | sed 's/^/  /' || printf '  (unreadable)\n'
    printf -- '--- end state @%s ---\n' "$when"
  } >>"$LOG" 2>&1
}

snapshot pre-launch

# A window that paints has emitted its first frames by now; one that came up
# blank has not. Sampling again at +20s separates "never started" from
# "started, then wedged" without any interaction.
( sleep 20; snapshot post-launch+20s ) &

# Run herdr through a login shell so it inherits a proper environment
# ($TERM, $SHELL, PATH from profile). Launching it bare via `-e` starves it of
# that env and herdr exits immediately when started cold (e.g. from a shortcut).
exec /usr/bin/ghostty -e bash -lc 'exec "$HOME/.local/bin/herdr"' "$@" >>"$LOG" 2>&1
```

**Reading the snapshots.** A healthy launch shows the `pre-launch` block, then
Ghostty's warnings, then a `post-launch+20s` block — and `launch.log` keeps
accumulating `gtk-xft-dpi` lines afterwards (one per render). A blank window
shows the same two blocks with *no* renders between them. Compare `pressure_mem`
and `swap` across the pair: if memory was already exhausted at `pre-launch`, the
window was never going to paint (§9).

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

## Appendix E — `~/.local/bin/wsl-health-sampler` (freeze forensics)

A hard freeze cannot be diagnosed interactively — by the time you notice, you
can't type, and `/mnt/wslg/stderr.log` dies with the VM on `wsl --shutdown`.
Sample the state continuously so the readings from just before the wall survive.
This is what identified the runaway process by name in the incident above.

```bash
#!/usr/bin/env bash
# Diagnostic only. Reads /proc (RAM, no disk I/O) and appends one line per tick.
set -uo pipefail
INTERVAL=5
LOG="$HOME/.local/share/wsl-health/health.log"
mkdir -p "$(dirname "$LOG")"

psi() { # psi <file> <some|full> <avg10>
  awk -v k="$2" -v f="$3" '$1==k{for(i=2;i<=NF;i++){split($i,a,"=");if(a[1]==f){print a[2];exit}}}' "$1"
}
disk() { awk '$3 ~ /^sd[a-z]$/ {t+=$13} END{print t+0}' /proc/diskstats; }
mb()   { awk -v k="$1:" '$1==k{printf "%d", $2/1024}' /proc/meminfo; }

prev=$(disk)
printf '\n== start %s (uptime %ss) ==\n' "$(date '+%F %T')" "$(awk '{print int($1)}' /proc/uptime)" >>"$LOG"
while :; do
  now=$(disk); d=$(( now - prev )); (( d < 0 )) && d=0; prev=$now
  read -r load1 _ < /proc/loadavg
  printf 'S %s mem_full=%s avail=%sMB swap=%s/%sMB load=%s disk_ms=%s io_full=%s\n' \
    "$(date '+%T')" "$(psi /proc/pressure/memory full avg10)" "$(mb MemAvailable)" \
    "$(( $(mb SwapTotal) - $(mb SwapFree) ))" "$(mb SwapTotal)" "$load1" "$d" \
    "$(psi /proc/pressure/io full avg10)" >>"$LOG"
  # every minute, record who is holding memory — this is what names the culprit
  (( $(date +%s) % 60 < INTERVAL )) && \
    { printf 'TOP %s\n' "$(date '+%T')"
      timeout 5 ps -eo rss,pcpu,etime,comm --sort=-rss --no-headers | head -6 | sed 's/^/  /'; } >>"$LOG"
  sleep "$INTERVAL"
done
```

Run it as a user unit so it starts at boot (no `enable-linger` needed — the user
manager starts early enough) in `~/.config/systemd/user/wsl-health-sampler.service`:

```ini
[Unit]
Description=WSL2 health sampler (diagnostic only)
[Service]
ExecStart=%h/.local/bin/wsl-health-sampler
Restart=always
RestartSec=5
Nice=10
[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload && systemctl --user enable --now wsl-health-sampler
```

**Reading it.** `mem_full` climbing past ~50 with `avail` collapsing and swap
filling is the freeze; the `TOP` block immediately before the log stops names
the process responsible. Ignore `io_full` — it is kept in the output only so you
recognise the artifact when you see it (see the gotchas table). `disk_ms` is the
real disk-busy figure, out of `INTERVAL × 1000`.

`devenv` carries the same idea for launch-time state — see Appendix B.

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
| `C:\Users\<you>\.wslconfig` | VM sizing — memory / processors / swap (§9) |
| `~/.local/bin/wsl-health-sampler` | freeze forensics sampler (Appendix E) |
| `~/.config/systemd/user/wsl-health-sampler.service` | runs the sampler from boot |
| `~/.local/share/wsl-health/health.log` | sampled VM state; survives `wsl --shutdown` |
