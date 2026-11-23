/**
 * Codex TUI screens, verbatim, as `slopweaver cmux read-screen --workspace <ref> --json` returned them.
 *
 * MEASURED on a cmux workspace: `codex` v0.157.1 (the vendored CLI
 * `cmux spawn --driver codex` boots), GPT-5.6-Sol, cmux's default width — the long lines end in `…` where the
 * TUI truncated them. Protocol: boot, idle read; send a `sleep 150` turn, read mid-turn; send a uniquely named
 * probe line behind it, read within the second; `cmux send --interrupt` a second probe, read; a second round with
 * `sleep 45`, queued again, then read idle once every background terminal had ended. Repro: the same verbs
 * against any `cmux spawn <slug> --driver codex` seat. Only the measurement's own synthetic probe text is here.
 *
 * These are the evidence `../../cmux/turnBusy.ts` and `../../cmux/turnState.ts` encode: a pattern there that no
 * screen here exercises is one nobody measured.
 */

/** Fresh boot, folder trusted, empty composer, nothing submitted yet. */
export const CODEX_IDLE_BOOT = [
  "╭─────────────────────────────────────────────────────────╮",
  "│ >_ OpenAI Codex (v0.157.1)                              │",
  "│                                                         │",
  "│ model:     GPT-5.6-Sol   /model to change               │",
  "│ directory: ~/…/worktrees.noindex/acme-codex-tui-capture │",
  "╰─────────────────────────────────────────────────────────╯",
  "",
  "  Tip: Try the Desktop app. Run 'codex app' or visit",
  "  https://chatgpt.com/codex?app-landing-page=true",
  " ",
  " ",
  "›",
  " ",
  " ",
  "  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view",
].join("\n");

/** Mid-turn on a foreground `sleep 150`, nothing queued. */
export const CODEX_RUNNING = [
  "  Tip: Try the Desktop app. Run 'codex app' or visit",
  "  https://chatgpt.com/codex?app-landing-page=true",
  "",
  "",
  "› TUI measurement seat. Run the single foreground shell command: sleep",
  "  150 . Then reply with the one word done and stop. Nothing else.",
  "",
  " ",
  "• Working (8s • esc to interrupt) · 1 background terminal running · /ps to…",
  " ",
  " ",
  "› Ask Codex to do anything",
  " ",
  "  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view",
].join("\n");

/** The same turn with one line sent behind it — read within a second of the send. */
export const CODEX_QUEUED = [
  "› TUI measurement seat. Run the single foreground shell command: sleep",
  "  150 . Then reply with the one word done and stop. Nothing else.",
  "",
  " ",
  "• Working (23s • esc to interrupt) · 1 background terminal running · /ps t…",
  " ",
  "• Messages to be submitted after next tool call (press esc to interrupt and",
  "  send immediately)",
  "  ↳ QUEUEPROBE-ALPHA reply ok",
  " ",
  "› Ask Codex to do anything",
  " ",
  "  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view",
].join("\n");

/**
 * Right after `cmux send --interrupt`: the interrupt released the queued line, both probes ran and answered, and
 * the turn's `sleep` lives on as a background terminal. No `Working` line — the turn is over.
 */
export const CODEX_AFTER_INTERRUPT = [
  "  150 . Then reply with the one word done and stop. Nothing else.",
  "",
  "",
  "",
  "› QUEUEPROBE-ALPHA reply ok",
  "",
  "",
  "• ok",
  "",
  "  7:54 AM",
  "",
  "",
  "› QUEUEPROBE-BETA reply ok",
  "",
  "",
  "• ok",
  "",
  "  7:54 AM",
  " ",
  "  1 background terminal running · /ps to view · /stop to close",
  " ",
  " ",
  "› Ask Codex to do anything",
  " ",
  "  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view",
].join("\n");

/** Round two, idle once every background terminal had ended: the at-rest screen a park or a close acts on. */
export const CODEX_IDLE_AFTER_TURNS = [
  "› Round two. Run the single foreground shell command: sleep 45 . Then",
  "  reply done.",
  "",
  "",
  "",
  "› QUEUEPROBE-GAMMA reply ok",
  "",
  "",
  "• ok",
  "",
  "  7:55 AM",
  " ",
  " ",
  "› Ask Codex to do anything",
  " ",
  "  GPT-5.6-Sol default · ~/dev/personal/slopwea…  ⚠ 2 warnings · f2 to view",
].join("\n");

/**
 * The folder-trust menu a fresh `CODEX_HOME` raises before the composer exists. Its selected item is drawn with
 * the composer's own `›`, three lines above the last — the near miss an idle proof has to refuse.
 */
export const CODEX_TRUST_MENU = [
  "  Trust this folder? Codex can read, edit, and run files here, subject to",
  "  your permission settings. Folder settings can run code automatically,",
  "  even without a model request. Continue only if you trust these files.",
  "  Your trust decision will be saved.",
  " ",
  "› 1. Trust and continue",
  "  2. Quit",
  " ",
  "  enter continue · esc quit",
].join("\n");
