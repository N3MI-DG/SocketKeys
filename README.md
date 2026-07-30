
# SocketKeys

A Tauri 2 desktop app with a Vue 3 + TypeScript frontend.

## Layout

- A custom title bar spanning the top of the window (native decorations are off).
- Two equal-size panes filling the remaining height, split by a draggable divider.

## Development

```sh
npm install
npm run tauri dev     # run the app
npm run tauri build   # produce a release bundle
npm run build         # type-check + build the frontend only
```

## Structure

| Path | Purpose |
| --- | --- |
| `src/App.vue` | Shell: title bar above, split panes below |
| `src/components/TitleBar.vue` | Custom title bar + window controls |
| `src/components/SplitPane.vue` | Resizable two-pane split |
| `src/styles.css` | Global theme tokens (light/dark) |
| `src-tauri/` | Rust side, window config, capabilities |
| `scripts/generate_klipper_builtins.py` | Regenerates `src/lib/moonraker/klipper-builtins.json` |

### Notes

- The divider is draggable, focusable, and responds to arrow keys; double-click
  or `Home` resets it to 50/50. Neither pane can shrink below `minPaneWidth`
  (160px by default).
- The title bar drags the window via `data-tauri-drag-region`. Its buttons need
  the `core:window:*` permissions listed in
  `src-tauri/capabilities/default.json`.
- To go back to native window decorations, set `"decorations": true` in
  `src-tauri/tauri.conf.json` and drop `<TitleBar />` from `src/App.vue`.
- The console's command autocomplete falls back to a bundled reference for
  Klipper's own built-in commands (G28, RESPOND, SET_SERVO, ...), since those
  expose no parameter schema through any live API. Regenerate it after
  updating your local Klipper checkout with:
  `python3 scripts/generate_klipper_builtins.py --klipper ~/klipper`

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
