
# TLDR
This app is vibe coded. if you have a problem with the code, bitch at Anthropic. Not me.

The credit should go to the developers of Klipper, Moonraker and Mainsail. Their projects made this possible.

# SocketKeys
A desktop client for [Moonraker](https://moonraker.readthedocs.io/), the JSON-RPC
API server that fronts the [Klipper](https://www.klipper3d.org/) 3D-printer
firmware. Built with [Tauri 2](https://tauri.app/) (Rust shell + native
webview) and a Vue 3 + TypeScript frontend.

Where Mainsail/Fluidd aim at a general-purpose printer dashboard, SocketKeys is
a smaller, developer-facing tool: connect to a printer's Moonraker instance
and get a live G-code console, a raw printer-object/state browser, a macro
launcher, a Klipper/Moonraker log viewer, and embeddable web panels — arranged
into 1–4 resizable panes that you assign independently.

## Features

- **Console** — a G-code REPL. Sends raw G-code over `printer.gcode.script`,
  backfills history from `server.gcode_store`, and streams live
  `notify_gcode_response` output. Autocomplete and parameter hints come from
  live `gcode_macro` introspection plus a bundled reference of Klipper's own
  built-in commands (those expose no schema through any API).
- **Macros** — a button grid for every invokable command (Klipper built-ins
  and your own `gcode_macro`s). Each button sends the bare command, or opens a
  small form when parameters are detected. Commands can be sorted into your
  own drag-and-drop groups, since there's no API to tell which plugin
  registered a given command.
- **Printer Objects tree** — a filterable, expandable live view over
  Moonraker's `printer.objects.list`/`subscribe` state. Drill into any
  Klipper object's fields in real time, and copy a Jinja
  `{ printer.a.b }`-style expression straight into a macro.
- **Logs** — lists and tails `moonraker.log`, `klippy.log`, and friends,
  polling Moonraker's file server over HTTP (via Tauri's HTTP plugin, to
  avoid CORS) and colorizing errors/warnings/tracebacks. Can trigger a log
  rollover.
- **Web panels** — bookmark arbitrary URLs (a webcam stream, Home Assistant,
  the printer's own web UI, ...) and render them in an iframe pane. A
  `*addr*` placeholder in the URL is substituted with whichever printer host
  is currently connected.
- **Layout** — a custom title bar (native decorations are off) holding the
  connect UI (address/port, recent-connections dropdown) plus window
  controls, and 1–4 resizable panes, each independently switchable between
  any of the panels above via its own header dropdown ("frame").
- **Settings** — pane count and default frame per pane, web panel management,
  log poll interval, auto-reconnect duration, theme colors, and full
  settings/data export-import to a JSON file.

## Tech stack

- **Frontend:** Vue 3, TypeScript, Vite, DOMPurify (sanitizing console/log
  HTML).
- **Shell:** Tauri 2 (Rust), with the `opener`, `http`, `dialog`, and `fs`
  plugins.
- **Printer integration:** JSON-RPC 2.0 over a plain WebSocket
  (`ws://host:port/websocket`) for live state and control; plain HTTP against
  Moonraker's file server for log content.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ and npm.
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) and
  Cargo.
- Platform-specific Tauri dependencies — follow the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for
  your OS (on Windows this means the WebView2 runtime and the MSVC C++ build
  tools; on Linux, `webkit2gtk` and friends via your package manager).

### Run

```sh
npm install
npm run tauri dev     # run the app with hot reload
```

### Build

```sh
npm run tauri build    # produce a release bundle (installer/binary) for your OS
npm run build          # type-check + build the frontend only, no Rust step
```

Bundled installers/binaries land under `src-tauri/target/release/bundle/`.
