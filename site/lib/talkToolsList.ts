/**
 * The rows of the console voice's closed tool list — the `TalkTool` contract, the two timeout budgets and
 * `TALK_TOOLS` itself. Why the list is closed, and how a row runs, is `./talkTools.ts`.
 */

import type { Slot } from "./slots";

/**
 * What a tool DOES. `relay` is the one writer past this machine, and it runs only through `relayGate.ts`; `draft`
 * rewrites the open parked draft in the local register and sends nothing. There is no generic `"write"` member, and
 * adding one is the whole of what this file is protecting — see the header.
 */
export type TalkDoes = "read" | "preference" | "show" | "list-write" | "relay" | "draft";

/**
 * An optional argument: a flag appended with the model's value when it supplied one, or — a `switch` — a bare flag
 * appended when the model passed `true`, and nothing for `false`.
 */
type TalkOption =
  | {
      /** The argument name in the schema the model was given. */
      readonly name: string;
      /** The flag it becomes, `--` included. */
      readonly flag: string;
      /** The shape its value is checked against. */
      readonly shape: Slot["shape"];
    }
  | {
      /** The argument name in the schema the model was given, a JSON Schema boolean. */
      readonly name: string;
      /** The bare flag `true` appends, `--` included. */
      readonly flag: string;
      readonly kind: "switch";
    };

/** One tool the model may call. */
export type TalkTool =
  | {
      readonly name: string;
      readonly does: TalkDoes;
      /** Spawned as a `slopweaver` verb by the tool route. */
      readonly where: "verb";
      /** The argv after `slopweaver` — literal strings and declared slots, never built from the call. */
      readonly argv: readonly (string | Slot)[];
      /** Arguments the schema marks optional; absent means the VERB's own default, never a copy of it. */
      readonly options: readonly TalkOption[];
      readonly timeoutMs: number;
      /** The verb line as a reader would type it, with the slots shown as `<slot>`. */
      readonly title: string;
    }
  | {
      readonly name: string;
      readonly does: TalkDoes;
      /** Answered in the browser, out of state the page already holds. */
      readonly where: "page";
    };

/**
 * Twenty seconds. `talk code find` walks the tracked files of the whole checkout under a byte budget —
 * MEASURED at 79,834,503 bytes across 8,290 files on this tree (the budget and its repro command are in
 * `src/talk/codeSearch.ts`) — and a tool call that has not answered inside twenty seconds is a session
 * the model has already talked over.
 */
export const TOOL_TIMEOUT_MS = 20_000;

/**
 * The `browser` and `browser_open` tools' budget: one open, look and close in the owner's own Chrome (no close for
 * `browser_open`, which leaves the tab), whose worst case `BUDGETED_LOOK_WORST_CASE_MS`
 * (`src/browser/lookBudget.ts`) puts at 213 s, so that its tab is closed before this kills it. Ten
 * seconds over it for the verb's own uncapped local work, its process start and its session record's write; a
 * filesystem stalled past those is outside every budget here, as that file says.
 *
 * Ninety of those seconds are thirty macOS foreground probes at their 3 s cap; each normally takes about 0.1 s
 * (`src/browser/foreground.ts`). Counting them at their measured cost instead left a look whose probes stalled to be
 * killed before its tab closed. The trade is that a look where everything stalls holds
 * the tool for over three minutes, with the page playing its progress sound throughout, rather than stranding a tab.
 *
 * It was 75 s while every client command, the attach included, was killed at 6 s. That kill landing mid-attach leaves "Failed to connect to MCP relay: WebSocket error" in front of the owner, so the
 * attach outlasts the client's own 30 s wait (`commandTimeoutFor`, `src/browser/terminalClient.ts`) and this budget
 * holds it, plus the 15 s a killed attach's daemon may take to shut down. A look whose attach is quick costs no more.
 * Eight more seconds hold a Slack message link's desktop-app attempt, which falls through to Chrome when it fails.
 */
export const BROWSER_TIMEOUT_MS = 223_000;

/** Every tool the model may call. */
export const TALK_TOOLS: readonly TalkTool[] = [
  {
    argv: ["talk", "code", "find", "--text-hex", { shape: "hexText", slot: "text" }, "--json"],
    does: "read",
    name: "code_find",
    options: [{ flag: "--max-hits", name: "maxHits", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk code find --text-hex <text as UTF-8 hex> --json",
    where: "verb",
  },
  {
    argv: ["talk", "code", "read", "--path", { shape: "path", slot: "path" }, "--json"],
    does: "read",
    name: "code_read",
    options: [{ flag: "--from", name: "from", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk code read --path <path> --json",
    where: "verb",
  },
  {
    argv: ["talk", "code", "list", "--json"],
    does: "read",
    name: "code_list",
    options: [{ flag: "--dir", name: "dir", shape: "path" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk code list --json",
    where: "verb",
  },
  {
    argv: ["talk", "file", "read", "--path", { shape: "localPath", slot: "path" }, "--json"],
    does: "read",
    name: "file_read",
    options: [
      { flag: "--from", name: "from", shape: "count" },
      { flag: "--words", kind: "switch", name: "words" },
    ],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk file read --path <path> --json",
    where: "verb",
  },
  {
    argv: ["talk", "file", "list", "--dir", { shape: "localPath", slot: "dir" }, "--json"],
    does: "read",
    name: "file_list",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk file list --dir <dir> --json",
    where: "verb",
  },
  { does: "read", name: "action_items", where: "page" },
  { does: "read", name: "read_card", where: "page" },
  { does: "read", name: "open_card", where: "page" },
  // A live edit of the parked draft on the open card (`./draftEdit.ts`): start reads its words and shows the edit on
  // the owner's card; the two writes post to `/api/talk/draft`.
  { does: "read", name: "draft_edit_start", where: "page" },
  { does: "draft", name: "draft_edit", where: "page" },
  { does: "draft", name: "draft_restore", where: "page" },
  // The owner's triage pass, held by the page (`./triageWalk.ts`): the next card through open_card's presenter, the end,
  // and the clock paused or running.
  { does: "read", name: "triage_next", where: "page" },
  { does: "read", name: "triage_end", where: "page" },
  { does: "preference", name: "triage_clock", where: "page" },
  { does: "read", name: "read_page", where: "page" },
  { does: "read", name: "read_screen", where: "page" },
  { does: "show", name: "focus_screen", where: "page" },
  { does: "list-write", name: "offer_copy", where: "page" },
  {
    argv: ["talk", "list", "--voice-safe", "--json"],
    does: "read",
    name: "running_list",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk list --voice-safe --json",
    where: "verb",
  },
  { does: "preference", name: "set_stage_setting", where: "page" },
  // What the owner said they would do, held by the page's drift watch (`./driftWatch.ts`): set, dropped, or a nudge waved off.
  { does: "preference", name: "focus_set", where: "page" },
  { does: "preference", name: "focus_end", where: "page" },
  { does: "preference", name: "focus_quiet", where: "page" },
  // A meeting the owner said they have had or will not go to, held by the page's meeting watch (`./meetingDueWatch.ts`).
  { does: "preference", name: "meeting_skip", where: "page" },
  {
    argv: ["talk", "row", "--slug", { shape: "id", slot: "slug" }, "--json"],
    does: "read",
    name: "board_row",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk row --slug <slug> --json",
    where: "verb",
  },
  {
    argv: ["talk", "supervisor", "--json"],
    does: "read",
    name: "read_supervisor",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk supervisor --json",
    where: "verb",
  },
  {
    argv: ["talk", "glossary", "--json"],
    does: "read",
    name: "glossary",
    options: [{ flag: "--term", name: "term", shape: "text" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk glossary --json",
    where: "verb",
  },
  {
    argv: ["talk", "origin", "--slug", { shape: "text", slot: "slug" }, "--json"],
    does: "read",
    name: "origin",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk origin --slug <slug> --json",
    where: "verb",
  },
  {
    argv: ["talk", "knowledge", "--query", { shape: "text", slot: "query" }, "--json"],
    does: "read",
    name: "knowledge",
    options: [{ flag: "--limit", name: "limit", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk knowledge --query <query> --json",
    where: "verb",
  },
  {
    argv: ["talk", "history", "--phrase", { shape: "text", slot: "phrase" }, "--json"],
    does: "read",
    name: "supervisor_history",
    options: [{ flag: "--hours", name: "hours", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk history --phrase <phrase> --json",
    where: "verb",
  },
  {
    argv: ["talk", "recall", "--words", { shape: "text", slot: "words" }, "--json"],
    does: "read",
    name: "recall",
    options: [
      { flag: "--days", name: "days", shape: "count" },
      { flag: "--source", name: "source", shape: "id" },
    ],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk recall --words <words> --json",
    where: "verb",
  },
  {
    argv: ["talk", "recall", "--open", { shape: "text", slot: "pointer" }, "--json"],
    does: "read",
    name: "recall_open",
    options: [{ flag: "--from", name: "from", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk recall --open <pointer> --json",
    where: "verb",
  },
  {
    argv: ["talk", "verb", "--request", { shape: "request", slot: "request" }, "--json"],
    does: "read",
    name: "verb",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk verb --request <hex> --json",
    where: "verb",
  },
  {
    argv: ["browser", "inspect", "--url", { shape: "text", slot: "url" }, "--json"],
    does: "read",
    name: "browser",
    options: [],
    timeoutMs: BROWSER_TIMEOUT_MS,
    title: "slopweaver browser inspect --url <url> --json",
    where: "verb",
  },
  {
    // Every option optional here and exactly-one enforced by the verb: `browser present` refuses none or several
    // with its own sentence, so a second copy of that rule on this side could only drift from the one that runs.
    argv: ["browser", "present", "--json"],
    does: "read",
    name: "browser_open",
    options: [
      { flag: "--destination", name: "destination", shape: "id" },
      { flag: "--url", name: "url", shape: "text" },
      { flag: "--page", name: "page", shape: "id" },
    ],
    timeoutMs: BROWSER_TIMEOUT_MS,
    title: "slopweaver browser present --json",
    where: "verb",
  },
  {
    argv: ["talk", "slack-after", "--url", { shape: "text", slot: "url" }, "--json"],
    does: "read",
    name: "slack_thread_after",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk slack-after --url <url> --json",
    where: "verb",
  },
  {
    // Its own deadline is 15 s (`SLACK_UNREAD_DEADLINE_MS`), so it answers with a residue before this kill.
    argv: ["slack", "unread", "--json"],
    does: "read",
    name: "slack_unread",
    options: [{ flag: "--days", name: "days", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver slack unread --json",
    where: "verb",
  },
  {
    // Its own deadline is 14 s (`SLACK_CHANNEL_DEADLINE_MS`), so a slow name lookup is refused with a reason first.
    argv: ["talk", "slack-channel", "--channel", { shape: "text", slot: "channel" }, "--json"],
    does: "read",
    name: "slack_channel",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk slack-channel --channel <channel> --json",
    where: "verb",
  },
  {
    argv: ["talk", "slack-open", "--url", { shape: "text", slot: "url" }, "--json"],
    does: "read",
    name: "slack_open",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk slack-open --url <url> --json",
    where: "verb",
  },
  {
    argv: [
      "talk",
      "slack-send-outcome",
      "--url",
      { shape: "text", slot: "url" },
      "--since",
      { shape: "text", slot: "since" },
      "--json",
    ],
    does: "read",
    name: "slack_send_outcome",
    options: [],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk slack-send-outcome --url <url> --since <iso> --json",
    where: "verb",
  },
  {
    argv: ["talk", "recent", "--json"],
    does: "read",
    name: "recent_steers",
    options: [{ flag: "--hours", name: "hours", shape: "count" }],
    timeoutMs: TOOL_TIMEOUT_MS,
    title: "slopweaver talk recent --json",
    where: "verb",
  },
  { does: "relay", name: "relay_steer", where: "page" },
];
