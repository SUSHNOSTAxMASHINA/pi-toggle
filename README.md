# pi-toggle — extension manager for pi

Interactive on/off chart for [pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) packages, skills, and extensions.

- **packages** — on iff listed in `settings.json` `packages`; scans `~/.pi/agent/npm/node_modules` for installed pi packages (any `package.json` with a `pi` field)
- **skills** — on iff in `~/.pi/agent/skills/` (off = moved to `skills-disabled/`)
- **extensions** — on iff in `~/.pi/agent/extensions/` (directories need an entry point: `index.ts`, `index.js`, or `package.json`)

```
↑↓ / j k   move
space      toggle
enter      apply
r          revert
esc / q    cancel
```

After applying, run `/reload` (or restart pi) for changes to take effect.

## Install

Copy `toggle.ts` into `~/.pi/agent/extensions/`, then `/reload`. Run `/toggle`.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free to use, study, and modify for non-commercial purposes.