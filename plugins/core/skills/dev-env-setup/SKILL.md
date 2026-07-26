---
name: dev-env-setup
description: Use when setting up a development machine or terminal environment — a new laptop, a fresh OS install, "set up my dev environment", "install the terminal stack", Ghostty or herdr installation, or WSL setup on Windows. Covers macOS and Windows (WSL2); native-Windows (non-WSL) Claude Code is unsupported.
---

# Dev environment setup — Ghostty + herdr

Recommended terminal stack: Ghostty (terminal) + herdr (agent workspace manager).
Detect the platform, then follow ONE guide in this skill's directory:

- macOS → macos.md
- Windows → windows-wsl.md (WSL2/WSLg + Ubuntu; includes launcher, fonts,
  shortcuts, VM sizing, freeze forensics, and a troubleshooting table of
  hard-won gotchas)

On Windows, size the VM (windows-wsl.md §9) before trusting the environment: an
undersized `.wslconfig` produces hard freezes and blank GUI windows that look
like GPU or terminal faults but are memory exhaustion.

Verify at the end of either guide: launching the environment opens Ghostty
running herdr. On Windows this must work from the desktop shortcut, not only
from a shell.
