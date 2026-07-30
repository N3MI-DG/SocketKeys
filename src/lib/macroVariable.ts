/**
 * Builds the `{ printer.a.b.c }` macro-template expression a gcode_macro
 * would write to read a given printer-object field, from the chain of keys
 * from the root object down to a specific tree node.
 *
 * Klipper's Jinja templates access status via `printer.<name>` for a plain
 * identifier, or `printer["name with a space"]` bracket form when it isn't
 * one (e.g. `temperature_sensor my_sensor`) — Python/Jinja attribute syntax
 * can't contain a space. Numeric segments (array indices) use `[0]`, not
 * `.0`, since dict/list indexing and attribute access aren't interchangeable.
 */

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INDEX_RE = /^\d+$/;

export function buildMacroVariable(path: string[]): string {
  if (!path.length) return "";

  const [root, ...rest] = path;
  let expr = IDENTIFIER_RE.test(root) ? `printer.${root}` : `printer["${root}"]`;

  for (const segment of rest) {
    if (IDENTIFIER_RE.test(segment)) expr += `.${segment}`;
    else if (INDEX_RE.test(segment)) expr += `[${segment}]`;
    else expr += `["${segment}"]`;
  }

  return `{ ${expr} }`;
}
