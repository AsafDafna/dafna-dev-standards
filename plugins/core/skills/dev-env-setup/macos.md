# macOS setup

1. Homebrew (if missing): see https://brew.sh
2. Ghostty: `brew install --cask ghostty`
3. herdr: install per https://herdr.dev so the binary lands on PATH
   (`~/.local/bin` or Homebrew prefix); ensure the location is in PATH.
4. Config: `mkdir -p ~/.config/herdr && herdr --default-config > ~/.config/herdr/config.toml`;
   recommended non-defaults (same as the Windows guide): `onboarding = false`,
   `[theme] name = "terminal"`, `[ui] pane_borders = true`, `pane_gaps = true`.
5. Validate: `herdr config check`. Launch Ghostty, run `herdr`.
6. Optional fonts: `brew install --cask font-jetbrains-mono-nerd-font`, then set
   `font-family = "JetBrainsMono Nerd Font"` in ~/.config/ghostty/config.
