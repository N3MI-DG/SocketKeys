<script setup lang="ts">
/**
 * Command entry: Up/Down cycles session command history; the popover above
 * the input has two modes:
 *
 *  - While multiple command names match what's typed, it's a filtered list
 *    (Tab/Enter accepts the highlighted one).
 *  - Once exactly one match remains — or a space commits the name and moves
 *    into argument text — it flips to a detail view: the command's help text,
 *    plus parameters from whichever source applies —
 *      - `gcode_macro`s: inferred from `params.NAME` references in the
 *        macro's own gcode template, introspected live from the connected
 *        printer (the only kind of command with a queryable config text).
 *      - Klipper's own built-ins (G28, RESPOND, SET_SERVO, ...): looked up
 *        in the bundled `klipper-builtins.json` reference, since these have
 *        no live schema at all — see `scripts/generate_klipper_builtins.py`.
 *      - anything else (a third-party plugin's directly Python-registered
 *        command, e.g. K-ShakeTune's internals): genuinely nothing further
 *        is available, so the view says so rather than showing nothing.
 *
 * Enter accepts an open suggestion/detail instead of submitting, exactly
 * when there's still something to accept (a highlighted list item, or a
 * locked-in command name not yet followed by a space) — otherwise it submits
 * as normal, so a fully-typed command + args still sends on one Enter.
 */
import { computed, ref } from "vue";
import {
  consoleState,
  getBuiltinInfo,
  getMacroParams,
  getMacroSource,
  isKnownMacro,
  macroSourceStatus,
  sendCommand,
} from "../../lib/moonraker/console";

defineProps<{ disabled: boolean }>();

const draft = ref("");
const highlightIndex = ref(0);
const suggestionsOpen = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

/** -1 = live draft; 0..n-1 = position back from the most recent command. */
let historyIndex = -1;
let draftBeforeHistory = "";

/** The command name text before the first space, if any — "" while empty. */
const firstToken = computed(() => {
  const text = draft.value;
  const spaceIndex = text.indexOf(" ");
  return (spaceIndex === -1 ? text : text.slice(0, spaceIndex)).trim();
});

const hasCommittedSpace = computed(() => draft.value.includes(" "));

/**
 * The single command the popover should now describe in detail, once one is
 * unambiguous — either because the user is past the name (a space follows a
 * recognized command) or because only one candidate still matches the prefix.
 */
const activeCommand = computed<string | null>(() => {
  const token = firstToken.value.toUpperCase();
  if (!token) return null;

  if (hasCommittedSpace.value) {
    return token in consoleState.gcodeHelp ? token : null;
  }
  if (token in consoleState.gcodeHelp) return token;

  const matches = Object.keys(consoleState.gcodeHelp).filter((name) =>
    name.startsWith(token),
  );
  return matches.length === 1 ? matches[0] : null;
});

/** Falls back to the bundled Klipper reference when the live text is empty —
 *  matters for built-ins Klipper registers with no desc= at all (G28, M112,
 *  ...), which would otherwise show blank in the filtered list and only
 *  resolve once narrowed down to a single match in the detail view. */
function descriptionFor(name: string): string {
  return consoleState.gcodeHelp[name] || getBuiltinInfo(name)?.description || "";
}

const macroParams = computed(() =>
  activeCommand.value ? getMacroParams(activeCommand.value) : null,
);

const isMacro = computed(
  () => !!activeCommand.value && isKnownMacro(activeCommand.value),
);

/** True once a macro's params are confirmed fetched with zero named `params.X`
 *  references — distinct from `null` (not a macro, or source not loaded yet),
 *  which must still show the detail view's loading/help state. */
function commandHasNoParams(name: string): boolean {
  return isKnownMacro(name) && getMacroParams(name)?.length === 0;
}

/** Nothing left to fill in for this command — the detail popover would have
 *  nothing useful to add beyond the name already typed, so it stays hidden. */
const activeHasNoParams = computed(
  () => !!activeCommand.value && commandHasNoParams(activeCommand.value),
);

/** Fallback when a macro has no named `params.X` references (e.g. it just
 *  forwards `{rawparams}` to a shell command) — the raw text is still useful. */
const macroSourceText = computed(() =>
  activeCommand.value && isMacro.value && macroParams.value?.length === 0
    ? getMacroSource(activeCommand.value)
    : null,
);

/**
 * A usage-line summary for macros, built live from the actual extracted
 * params rather than pulled from the bundled builtin reference — a macro
 * overriding a built-in (`rename_existing`, e.g. a custom M104) can add or
 * drop params freely, so the static reference would be actively wrong here;
 * this always reflects what the connected printer's own macro really takes.
 */
const macroSyntaxPreview = computed(() => {
  if (!activeCommand.value || !macroParams.value?.length) return null;
  const args = macroParams.value.map((p) => `${p.name}=<value>`).join(" ");
  return `${activeCommand.value} ${args}`;
});

/** Only relevant for non-macro commands — the bundled Klipper docs reference. */
const builtinInfo = computed(() =>
  activeCommand.value && !isMacro.value ? getBuiltinInfo(activeCommand.value) : null,
);

const suggestions = computed(() => {
  if (!suggestionsOpen.value || activeCommand.value || hasCommittedSpace.value) {
    return [];
  }
  const prefix = firstToken.value.toUpperCase();
  if (!prefix) return [];
  return Object.keys(consoleState.gcodeHelp)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .slice(0, 8);
});

const showDetail = computed(
  () =>
    suggestionsOpen.value &&
    !suggestions.value.length &&
    !!activeCommand.value &&
    !activeHasNoParams.value,
);

function resetHistoryNav() {
  historyIndex = -1;
}

function navigateHistory(delta: number) {
  const history = consoleState.commandHistory;
  if (!history.length) return;
  if (historyIndex === -1) draftBeforeHistory = draft.value;

  historyIndex = Math.min(Math.max(historyIndex + delta, -1), history.length - 1);
  draft.value =
    historyIndex === -1
      ? draftBeforeHistory
      : history[history.length - 1 - historyIndex];
}

/** A trailing space readies the input for typing a param — pointless (and
 *  visibly wrong) when the command takes none. */
function applySuggestion(name: string) {
  draft.value = commandHasNoParams(name) ? name : `${name} `;
  suggestionsOpen.value = false;
  inputEl.value?.focus();
}

/**
 * Accepts whatever the popover is currently offering. False if there's
 * nothing to accept — including a name that's already fully typed with a
 * confirmed empty param list, since there's nothing left to complete and
 * Enter should submit it on the first press rather than silently no-op.
 */
function acceptActive(): boolean {
  if (suggestions.value.length) {
    applySuggestion(suggestions.value[highlightIndex.value] ?? suggestions.value[0]);
    return true;
  }
  if (activeCommand.value && !hasCommittedSpace.value && !activeHasNoParams.value) {
    applySuggestion(activeCommand.value);
    return true;
  }
  return false;
}

function onInput() {
  suggestionsOpen.value = true;
  highlightIndex.value = 0;
  resetHistoryNav();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Tab") {
    if (acceptActive()) event.preventDefault();
    return;
  }
  if (event.key === "Enter" && acceptActive()) {
    event.preventDefault();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (suggestions.value.length) {
      highlightIndex.value = Math.min(highlightIndex.value + 1, suggestions.value.length - 1);
    } else {
      navigateHistory(-1);
    }
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (suggestions.value.length) {
      highlightIndex.value = Math.max(highlightIndex.value - 1, 0);
    } else {
      navigateHistory(1);
    }
    return;
  }
  if (event.key === "Escape") {
    suggestionsOpen.value = false;
  }
}

function submit() {
  if (!draft.value.trim()) return;
  void sendCommand(draft.value);
  draft.value = "";
  suggestionsOpen.value = false;
  resetHistoryNav();
}
</script>

<template>
  <div class="console-input">
    <div v-if="suggestions.length || showDetail" class="popover">
      <ul v-if="suggestions.length" class="suggestions">
        <li
          v-for="(name, index) in suggestions"
          :key="name"
          :class="{ active: index === highlightIndex }"
          @mousedown.prevent="applySuggestion(name)"
        >
          <span class="name">{{ name }}</span>
          <span class="help">{{ descriptionFor(name) }}</span>
        </li>
      </ul>

      <div v-else-if="showDetail && activeCommand" class="detail">
        <div class="detail-name" @mousedown.prevent="applySuggestion(activeCommand)">
          {{ activeCommand }}
        </div>
        <p v-if="descriptionFor(activeCommand)" class="detail-help">
          {{ descriptionFor(activeCommand) }}
        </p>
        <p v-else class="detail-help muted">No description available.</p>

        <template v-if="isMacro">
          <template v-if="macroParams && macroParams.length">
            <pre class="macro-source">{{ macroSyntaxPreview }}</pre>
            <ul class="params">
              <li v-for="param in macroParams" :key="param.name">
                <span class="pname">{{ param.name }}</span>
                <span v-if="param.type" class="ptype">{{ param.type }}</span>
                <span v-if="param.default !== null" class="pdefault">
                  default: {{ param.default }}
                </span>
              </li>
            </ul>
          </template>
          <template v-else-if="macroSourceText">
            <p class="detail-help muted">
              No named parameters found — showing the macro's gcode:
            </p>
            <pre class="macro-source">{{ macroSourceText }}</pre>
          </template>
          <p v-else-if="macroSourceStatus.state === 'error'" class="detail-help muted">
            Couldn't load macro syntax: {{ macroSourceStatus.error }}
          </p>
          <p v-else-if="macroSourceStatus.state === 'loaded'" class="detail-help muted">
            No config text found for this macro.
          </p>
          <p v-else class="detail-help muted">Loading macro syntax…</p>
        </template>

        <template v-else-if="builtinInfo">
          <pre class="macro-source">{{ builtinInfo.syntax }}</pre>
          <ul v-if="builtinInfo.params.length" class="params">
            <li v-for="param in builtinInfo.params" :key="param.name">
              <span class="pname">{{ param.name }}</span>
              <span v-if="!param.optional" class="ptype">required</span>
            </li>
          </ul>
        </template>
        <p v-else class="detail-help muted">
          Built-in or plugin command — no syntax reference found for it,
          beyond the description above.
        </p>
      </div>
    </div>

    <form class="row" @submit.prevent="submit">
      <input
        ref="inputEl"
        v-model="draft"
        type="text"
        class="field"
        placeholder="Send a command…"
        autocomplete="off"
        spellcheck="false"
        :disabled="disabled"
        @input="onInput"
        @keydown="onKeydown"
        @focus="suggestionsOpen = true"
        @blur="suggestionsOpen = false"
      />
      <button type="submit" class="send-btn" :disabled="disabled || !draft.trim()">
        Send
      </button>
    </form>
  </div>
</template>

<style scoped>
.console-input {
  position: relative;
  flex: 0 0 auto;
  border-top: 1px solid var(--border);
}

.row {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
}

.field {
  flex: 1 1 auto;
  height: 28px;
  padding: 0 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface-1);
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  outline: none;
}

.field::placeholder {
  color: var(--text-muted);
}

.field:focus-visible {
  border-color: var(--accent);
}

.field:disabled {
  color: var(--text-muted);
  background: var(--surface-2);
}

.send-btn {
  height: 28px;
  padding: 0 14px;
  border-radius: 5px;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.12s ease;
}

.send-btn:hover {
  opacity: 0.9;
}

.send-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.popover {
  position: absolute;
  bottom: 100%;
  left: 12px;
  right: 12px;
  margin: 0 0 4px;
  max-height: 260px;
  overflow: auto;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 25%);
}

.suggestions {
  margin: 0;
  padding: 4px;
  list-style: none;
}

.suggestions li {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  cursor: pointer;
}

.suggestions li.active {
  background: var(--surface-3);
}

.suggestions .name {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--accent);
}

.suggestions .help {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.detail {
  padding: 10px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.detail-name {
  display: inline-block;
  font-weight: 600;
  color: var(--accent);
  cursor: pointer;
}

.detail-help {
  margin: 4px 0 0;
  color: var(--text);
  white-space: pre-wrap;
}

.detail-help.muted {
  color: var(--text-muted);
  font-style: italic;
}

.params {
  margin: 8px 0 0;
  padding: 8px 0 0;
  border-top: 1px solid var(--border);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.params li {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.pname {
  font-weight: 600;
  color: var(--text);
}

.ptype {
  color: var(--accent);
  font-size: 11px;
}

.pdefault {
  color: var(--text-muted);
}

.macro-source {
  margin: 6px 0 0;
  padding: 8px;
  max-height: 160px;
  overflow: auto;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
