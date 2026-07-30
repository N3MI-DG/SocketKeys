#!/usr/bin/env python3
"""
Generates src/lib/moonraker/klipper-builtins.json from a local Klipper
checkout's docs/G-Codes.md.

Why this exists: Moonraker/Klipper expose no API that returns a command's
parameter schema — printer.gcode.help gives at most a one-line description,
and plenty of built-ins (G28, G1, M112, ...) don't even get that, since
Klipper only registers a description when the Python code passes desc= to
gcode.register_command(). But Klipper's own maintainers hand-document every
built-in and extended command's exact syntax in docs/G-Codes.md. This script
parses that file into a small JSON table SocketKeys bundles and falls back to
for any command a live printer can't describe itself.

This is scoped to Klipper's own built-in/extended commands only — it has
nothing to do with, and can't help with, user-defined gcode_macros (those are
introspected live from the connected printer's config) or commands a
third-party plugin registers directly in Python (those have no public
documentation to parse and remain genuinely unavailable).

Usage:
    python3 scripts/generate_klipper_builtins.py [--klipper PATH] [--out PATH]

Defaults: --klipper ~/klipper, --out src/lib/moonraker/klipper-builtins.json
Re-run this whenever you update your local Klipper checkout and want the
bundled fallback data to catch up with newly documented commands.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# --- Section 1: the short bulleted list of standard G-code commands ------
#
#   - Move (G0 or G1): `G1 [X<pos>] [Y<pos>] [Z<pos>] [E<pos>] [F<speed>]`
#   - Turn off motors: `M18` or `M84`
#
# One bullet can hold multiple backtick-quoted syntaxes (aliases like M18/
# M84), and/or name an alias in a "(G0 or G1)"-style parenthetical next to
# the description that isn't its own backtick span.

BULLET_RE = re.compile(r"^-\s*(.+?):\s*(.+)$")
BACKTICK_RE = re.compile(r"`([^`]+)`")
ALIAS_PAREN_RE = re.compile(r"\(([A-Z][A-Z0-9]*)\s+or\s+([A-Z][A-Z0-9]*)\)")

# Same "description: `SYNTAX`" shape as BULLET_RE, but strict: the part after
# the colon must be *only* backtick span(s) joined by "or", nothing else.
# BULLET_RE alone is too loose for scanning the whole document — it also
# matches per-parameter description bullets like "- **AXIS:** Define the
# axis (`X` or `Y`) for..." (a parameter note, not a command), since that
# text also happens to contain backticks after a colon. Requiring the *whole*
# remainder to be backticks-and-"or" rejects that case correctly.
STANDARD_BULLET_RE = re.compile(
    r"^-\s*(.+?):\s*(`[^`]+`(?:\s*(?:or|OR)\s*`[^`]+`)*)\s*$"
)

# --- Section 2: "#### COMMAND_NAME" headings in the "Additional Commands" ---
#
#   #### BLTOUCH_DEBUG
#   `BLTOUCH_DEBUG COMMAND=<command>`: This sends a command to the
#   bltouch...
#
#   #### AXIS_TWIST_COMPENSATION_CALIBRATE
#   `AXIS_TWIST_COMPENSATION_CALIBRATE [AXIS=<X|Y>] [SAMPLE_COUNT=<value>]`
#
#   Calibrates axis twist compensation...
#
# The signature is always the first backtick span after the heading (it may
# wrap across lines). What follows the closing backtick is either an inline
# ": description" on the same paragraph, or nothing — in which case the
# description is the next paragraph down.

HEADING_RE = re.compile(r"^(#{2,4})\s+(.*)$")
# A handful of headings wrap the name in backticks (`` #### `EXCLUDE_OBJECT` ``)
# or carry a stray trailing colon (`#### TEMPERATURE_PROBE_COMPLETE:`).
COMMAND_HEADING_RE = re.compile(r"^####\s+`?([A-Z][A-Z0-9_]*)`?:?\s*$")
# Klipper's own extended commands use `NAME=<value>`; legacy RepRap-style
# G/M-codes (M104, M140, G1, ...) instead use `NAME<value>` with no `=` at
# all — both need to be recognized as a parameter.
PARAM_RE = re.compile(r"\b([A-Z][A-Z0-9_]*)\s*(?:=|<)")
# Bare optional flags with no value indicator whatsoever, e.g. G28's
# `[X] [Y] [Z]` — a standalone bracketed name and nothing else inside.
BARE_FLAG_RE = re.compile(r"\[([A-Z][A-Z0-9_]*)\]")

# A minority of commands (RESPOND is the canonical example) document several
# call variants as their own bullet list instead of one inline signature:
#   - `RESPOND MSG="<message>"`: echo the message prepended with...
#   - `RESPOND TYPE=echo MSG="<message>"`: echo the message prepended with...
VARIANT_BULLET_RE = re.compile(r"^-\s*`([^`]+)`:\s*(.*)$")


def extract_params(syntax: str, command_name: str = "") -> list[dict]:
    """Pulls parameter names out of a syntax string — both `NAME=<value>`
    and `NAME<value>` forms, plus bare `[NAME]` flags with no value at all —
    flagging ones inside [...] groups as optional. Good enough for display
    purposes — this doesn't attempt to model OR-groups (e.g.
    "[ANGLE=<x> | WIDTH=<y>]") as mutually exclusive, just lists both as
    optional params.

    `command_name` excludes the command's own name from the result: a bare
    positional placeholder right after the name with nothing in between
    (e.g. "M117 <message>") otherwise gets misread as `NAME<value>` with
    "M117" as the param name, since nothing distinguishes that shape from a
    real `NAME<value>` parameter without knowing what the command is called.
    """
    # (position, name, forced_optional) — bare-flag matches are always inside
    # their own "[...]", so they're marked optional directly rather than via
    # the bracket-depth count below (which excludes the token's own brackets).
    matches: list[tuple[int, str, bool | None]] = []
    for m in PARAM_RE.finditer(syntax):
        matches.append((m.start(), m.group(1), None))
    for m in BARE_FLAG_RE.finditer(syntax):
        matches.append((m.start(), m.group(1), True))
    matches.sort(key=lambda item: item[0])

    params: list[dict] = []
    seen = set()
    for start, name, forced_optional in matches:
        if name in seen or (command_name and name.upper() == command_name.upper()):
            continue
        seen.add(name)
        if forced_optional is None:
            depth = syntax.count("[", 0, start) - syntax.count("]", 0, start)
            optional = depth > 0
        else:
            optional = forced_optional
        params.append({"name": name, "optional": optional})
    return params


def parse_section1(lines: list[str], start: int, end: int) -> dict:
    entries: dict = {}
    i = start
    while i < end:
        line = lines[i].strip()
        m = BULLET_RE.match(line)
        if m:
            description, rest = m.group(1), m.group(2)
            syntaxes = BACKTICK_RE.findall(rest)
            aliases: list[str] = []
            alias_match = ALIAS_PAREN_RE.search(description)
            if alias_match:
                aliases = [alias_match.group(1), alias_match.group(2)]

            for syntax in syntaxes:
                token = syntax.strip().split()[0].rstrip(":")
                names = {token}
                if len(syntaxes) == 1:
                    names.update(aliases)
                for name in names:
                    entries[name] = {
                        "syntax": syntax.strip(),
                        "description": description.strip(),
                        "params": extract_params(syntax, token),
                    }
        i += 1
    return entries


def join_bullets(block_lines: list[str]) -> list[str]:
    """Merges a bullet list's wrapped continuation lines back into one
    logical line per bullet, e.g. an item whose text spans two physical
    lines (continuation lines are indented and don't start with "-")."""
    items: list[str] = []
    for raw in block_lines:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("-"):
            items.append(line)
        elif items:
            items[-1] += " " + line
    return items


def parse_variant_block(name: str, bullets: list[str]) -> dict:
    syntaxes = []
    descriptions = []
    params: list[dict] = []
    seen_params = set()
    for bullet in bullets:
        m = VARIANT_BULLET_RE.match(bullet)
        if not m:
            continue
        syntax, description = m.group(1).strip(), m.group(2).strip()
        syntaxes.append(syntax)
        descriptions.append(description)
        for p in extract_params(syntax, name):
            if p["name"] not in seen_params:
                seen_params.add(p["name"])
                params.append(p)
    return {
        "syntax": "\n".join(syntaxes) if syntaxes else name,
        "description": " / ".join(descriptions),
        "params": params,
    }


def parse_section2(lines: list[str], start: int, end: int) -> dict:
    entries: dict = {}
    i = start
    while i < end:
        m = COMMAND_HEADING_RE.match(lines[i])
        if not m:
            i += 1
            continue
        name = m.group(1)

        # Content block: everything until the next heading of any level.
        block_start = i + 1
        block_end = block_start
        while block_end < end and not HEADING_RE.match(lines[block_end]):
            block_end += 1
        block_lines = lines[block_start:block_end]
        block = "\n".join(block_lines)

        bullets = join_bullets(block_lines)
        # A *true* variant list (RESPOND) repeats the command name itself in
        # every bullet's syntax. A per-parameter description list (e.g.
        # EXCLUDE_OBJECT_DEFINE's "- `NAME`: This parameter is required...")
        # matches the same bullet shape but each backtick span is just a bare
        # param name — excluding those here is what tells the two apart.
        variant_bullets = [
            b
            for b in bullets
            if (vm := VARIANT_BULLET_RE.match(b)) and vm.group(1).split()[0] == name
        ]
        if len(variant_bullets) >= 2:
            entries[name] = parse_variant_block(name, variant_bullets)
            i = block_end
            continue

        syntax = ""
        description = ""
        tick_match = re.search(r"`(.+?)`", block, re.DOTALL)
        if tick_match:
            syntax = " ".join(tick_match.group(1).split())
            after = block[tick_match.end():]
            after_stripped = after.lstrip()
            if after_stripped.startswith(":"):
                # Inline description: rest of this paragraph (up to a blank line).
                inline = after_stripped[1:]
                para_end = inline.find("\n\n")
                description = " ".join(
                    (inline if para_end == -1 else inline[:para_end]).split()
                )
            else:
                # No inline description — take the next paragraph, if any.
                paragraphs = [p.strip() for p in after.split("\n\n") if p.strip()]
                if paragraphs:
                    description = " ".join(paragraphs[0].split())

        entries[name] = {
            "syntax": syntax or name,
            "description": description,
            "params": extract_params(syntax, name),
        }
        i = block_end
    return entries


def parse_module_bullets(lines: list[str], start: int, end: int) -> dict:
    """A third documentation shape: standalone bulleted commands sitting
    directly under a "### [module]" header with no "#### COMMAND" heading of
    their own — e.g. M117/M73 under [display_status], M118 under [respond],
    and the whole M20-M30 SD-card family under [virtual_sdcard]. Both bullet
    orderings appear in the wild ("description: `X`" and "`X`: description"),
    so both are checked. Anything already claimed by a "#### " heading block
    is skipped entirely, so this can never collide with parse_section2."""
    entries: dict = {}
    i = start
    while i < end:
        if COMMAND_HEADING_RE.match(lines[i]):
            i += 1
            while i < end and not HEADING_RE.match(lines[i]):
                i += 1
            continue
        if HEADING_RE.match(lines[i]):
            i += 1
            continue

        line = lines[i].strip()
        if not line.startswith("-"):
            i += 1
            continue

        # Accumulate this bullet's wrapped continuation lines. A blank line,
        # a new "-" bullet, or a heading all end it — treating blank lines as
        # a hard boundary (rather than just skipping them, as join_bullets
        # does) matters here: without it, trailing prose after a blank line
        # following the bullet (e.g. the next module's intro sentence) would
        # get appended onto this bullet's description.
        text = line
        j = i + 1
        while j < end:
            nxt = lines[j].strip()
            if not nxt or nxt.startswith("-") or HEADING_RE.match(lines[j]):
                break
            text += " " + nxt
            j += 1

        variant_match = VARIANT_BULLET_RE.match(text)
        if variant_match:
            syntax, description = variant_match.group(1).strip(), variant_match.group(2).strip()
            token = syntax.split()[0]
            entries[token] = {
                "syntax": syntax,
                "description": description,
                "params": extract_params(syntax, token),
            }
            i = j
            continue

        standard_match = STANDARD_BULLET_RE.match(text)
        if standard_match:
            description = standard_match.group(1).strip()
            for syntax in BACKTICK_RE.findall(standard_match.group(2)):
                token = syntax.strip().split()[0].rstrip(":")
                entries[token] = {
                    "syntax": syntax.strip(),
                    "description": description,
                    "params": extract_params(syntax, token),
                }
            i = j
            continue

        i = j
    return entries


def parse_gcodes_md(text: str) -> dict:
    lines = text.splitlines()

    additional_idx = next(
        (i for i, l in enumerate(lines) if l.strip() == "## Additional Commands"),
        len(lines),
    )

    entries = {}
    entries.update(parse_section1(lines, 0, additional_idx))
    entries.update(parse_section2(lines, additional_idx, len(lines)))
    entries.update(parse_module_bullets(lines, additional_idx, len(lines)))
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--klipper",
        default=str(Path.home() / "klipper"),
        help="Path to a local Klipper checkout (default: ~/klipper)",
    )
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "src" / "lib" / "moonraker" / "klipper-builtins.json"),
        help="Output JSON path",
    )
    args = parser.parse_args()

    gcodes_path = Path(args.klipper) / "docs" / "G-Codes.md"
    if not gcodes_path.is_file():
        print(f"error: {gcodes_path} not found", file=sys.stderr)
        return 1

    entries = parse_gcodes_md(gcodes_path.read_text())

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(entries, indent=2, sort_keys=True) + "\n")

    print(f"Wrote {len(entries)} commands to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
