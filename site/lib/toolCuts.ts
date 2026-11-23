/**
 * How each shipped read tool's answer says it did not carry everything: ONE entry per tool the model can read with
 * (`does: "read"` in `./talkToolsList.ts`), naming the exact fields that tool sets, read only at the paths that tool
 * sets them (`./readCoverage.ts` applies it; `docs/console/voice-reads-on-past-a-cut.md`).
 *
 * Why per tool: a marker's meaning belongs to the tool that writes it. Read by field name alone, `slack_unread`'s
 * per-row `unread` (messages the owner has not read, its subject) read as a cut, while its real cut, `status:
 * "incomplete"`, and Slack's `warnings` prose read as nothing. An entry is
 * traced to its producer, and `site/__tests__/unit/toolCuts.test.ts` fails when a read tool has none, so a new tool
 * is a decision, never a silent `whole`.
 *
 * A **fixed preview** (a field a producer shortens with an ellipsis and no flag, the whole one named call away) is no
 * cut here: the owner wants reading token-efficient, never every fold opened, so each entry's `previews` says what is
 * previewed and which call reads it whole. The closing cuts, a window or page with the call that resumes it, are
 * `./readCoverage.ts`'s, and are read wherever they sit. Pure.
 */
import { type Bag, type CutProbe, isBag, probed, valueAt } from "./cutProbe";
import type { Json } from "./readCoverage";
import { VERB_CHILD_CUTS } from "./verbChildCuts";

/** One read tool's cuts, and the previews it carries by design. */
export interface ToolCutEntry {
  readonly probes: readonly CutProbe[];
  // What it shortens with no flag, and the call that reads it whole; or why it carries no cut.
  readonly previews: string;
}

/** The bot-token caveat a Slack read always carries: a standing scope note, never a loss of this read. */
const BOT_TOKEN = "read with the BOT token";

/** A recall source left out because the call named another (`src/cli/commands/talk/recallRun.ts`). */
const NOT_ASKED_FOR = "not asked for";

/** The standing line every recall carries about the supervisor chat it never searches (`src/talk/recall.ts`). */
const SUPERVISOR_CHAT_RESIDUE = "TYPED into the supervisor chat is not in this search";

/** A card answer's cuts, shared by the three tools that answer one. */
const CARD: ToolCutEntry = {
  previews: "none: a card's own fields are whole; a partial briefing is a closing cut read on with file_read",
  probes: [{ each: "briefings", field: "read", is: false }, { set: "briefingsLeftOut.count" }, { set: "unread" }],
};

/** A Slack conversation read's cuts (`src/talk/slackMessageFit.ts`, `src/talk/slackOpen.ts`). */
const SLACK_FITTED: readonly CutProbe[] = [
  { set: "omitted" },
  { set: "cut" },
  { each: "warnings", unless: [BOT_TOKEN] },
];

/** Every shipped read tool, by name. */
export const TOOL_CUTS: Readonly<Record<string, ToolCutEntry>> = {
  action_items: {
    previews: 'fields over 600 bytes end in " …" and the `cut` sentence says so; read_card {key} reads a card whole',
    probes: [
      { at: "complete", is: [false] },
      { set: "unread" },
      { set: "beyondCap.more" },
      { set: "cut" },
      { set: "recentlyLeftBeyondCap" },
      { anyOf: "shown", is: "unread" },
      { set: "withheld" },
    ],
  },
  board_row: { previews: "none past `truncated`", probes: [{ set: "truncated" }, { set: "journalUnread" }] },
  browser: {
    previews: "title, url and cleanup lines are capped; no tool reads them longer",
    probes: [{ set: "truncated" }, { set: "outlineCut" }],
  },
  browser_open: { previews: "the title is capped at 200 characters; browser {url} reads the page", probes: [] },
  code_find: {
    previews:
      "each matching line is a 200-character excerpt, code_read {path} reads the file; `binarySkipped` is scope, " +
      "since a text search cannot match inside a binary and counting it would cut every search of a tree with images",
    probes: [
      { set: "hitLimitReached" },
      { set: "scanBudgetExhausted" },
      { set: "excerptBudgetExhausted" },
      { set: "aliasSkipped" },
      { set: "unreadableSkipped" },
      { set: "undecodableNames" },
      { each: "hits", field: "partiallyScanned" },
    ],
  },
  code_list: { previews: "none: the list is not capped", probes: [{ set: "undecodableNames" }] },
  code_read: { previews: "none: its window is a closing cut", probes: [] },
  draft_edit_start: { previews: "none: the draft's words are whole", probes: [] },
  file_list: { previews: "none past `truncated`", probes: [{ set: "truncated" }] },
  file_read: {
    previews:
      "none past `outlineCut` and `redactions`: its window is a closing cut, and a masked credential stays masked",
    probes: [{ set: "redactions" }, { set: "outlineCut" }],
  },
  glossary: { previews: "none: the list is whole", probes: [] },
  knowledge: {
    previews: 'claim fields over 600 characters end in " …"; recall_open with its pointer reads a claim whole',
    probes: [{ set: "omitted" }, { set: "hasMore" }],
  },
  open_card: CARD,
  origin: {
    previews: "none: a passage cut at 1500 characters is counted, board_row {slug} reads the row",
    probes: [
      { set: "truncated" },
      { set: "mentionedOmitted" },
      { each: "anchorWords", field: "why" },
      { each: "quotes", endsWith: " …" },
      { each: "whereFrom", endsWith: " …" },
      { each: "mentioned[].quotes", endsWith: " …" },
    ],
  },
  read_card: CARD,
  read_page: {
    previews: "the Queue reading draws 12 rows and says `drawnMore`; read_card {key} reads one",
    probes: [
      { set: "truncated" },
      { set: "shows.drawnMore" },
      { set: "shows.unread" },
      { set: "shows.tags.hidden" },
      { set: "shows.hiddenByContext" },
      { each: "shows.automations", field: "historyUnread" },
      { set: "shows.withheld" },
      // A published page in the viewer that would not read (`./publishedPageVoice.ts`); a partial one reads on as a
      // card's briefing does, so only a failed read is a loss.
      { at: "shows.publishedPage.read", is: [false] },
      // A window's `shows` is text, so it carries the whole reading's own cuts here (`./pageVoice.ts`).
      { each: "readingCuts", unless: [] },
    ],
  },
  read_screen: { previews: "none: one frame of the screen, an image", probes: [] },
  read_supervisor: {
    previews: "none past `exchanges[].cut`",
    probes: [{ each: "exchanges", field: "cut" }, { set: "omitted" }, { set: "tailCut" }, { set: "undecodable" }],
  },
  recall: {
    previews: 'each hit is a window around the match marked "…"; recall_open {pointer} reads the record',
    probes: [
      { set: "notShown" },
      { set: "incomplete" },
      // A source left out on purpose (`--source`) or the standing supervisor-chat line is scope, never a loss.
      { each: "notSearched", says: "why", unless: [NOT_ASKED_FOR, SUPERVISOR_CHAT_RESIDUE] },
    ],
  },
  recall_open: {
    previews:
      "context turns either side are capped at 600 characters, `contextClipped` counts them; its page is a closing cut",
    probes: [{ set: "contextOmitted" }],
  },
  recent_steers: {
    previews:
      "heard words and notes are capped at 600 and 300 characters, recall_open reads a steer by its turn; a typed " +
      "turn's `reply.cut` is the supervisor read's 1500-character preview of a report that runs long",
    probes: [
      { set: "notShown" },
      { each: "calls", field: "linesCut" },
      { each: "calls", field: "skipped" },
      { each: "typed", field: "cut" },
      { set: "unread" },
    ],
  },
  running_list: { previews: "none: items are whole", probes: [{ each: "items", field: "withheld" }] },
  slack_channel: {
    previews: 'each message is a 400-character preview ending " …"; slack_open {url: permalink} reads it whole',
    probes: [
      { set: "olderExist" },
      { set: "omitted" },
      { set: "repliesNotRead" },
      { each: "warnings", unless: [BOT_TOKEN] },
    ],
  },
  slack_open: {
    previews: "none past `cut`",
    probes: [
      ...SLACK_FITTED,
      { set: "read.omitted" },
      { set: "read.cut" },
      { each: "read.warnings", unless: [BOT_TOKEN] },
    ],
  },
  slack_send_outcome: { previews: "none: it says what became of one send, never a read of content", probes: [] },
  slack_thread_after: { previews: "none past `cut`", probes: SLACK_FITTED },
  slack_unread: {
    previews: "each row's line is a 140-character preview; slack_open {url} reads the conversation",
    probes: [
      { at: "status", is: ["incomplete", "unavailable"] },
      { set: "dms.more" },
      { set: "activity.more" },
      { set: "activity.appTagsNotListed" },
    ],
  },
  supervisor_history: {
    previews: "each hit is a 700-character window around the match, counted as `hits[].cut`; reach prose is standing",
    probes: [{ each: "hits", field: "cut" }, { set: "omitted" }, { set: "unread" }],
  },
  triage_end: {
    previews: "none: the pass's summary is whole over what was read; `unread` names a source that was not",
    probes: [{ set: "unread" }],
  },
  triage_next: CARD,
  verb: {
    previews:
      "none: a cut stdout is a closing cut, read on from its spill; a whole JSON stdout is read at the fields its " +
      "own verb sets (`./verbChildCuts.ts`), and a verb with no entry there reads as whole",
    probes: [{ set: "timedOut" }, { at: "exitCode", is: [null] }, { set: "stderr.truncated" }],
  },
};

/**
 * The cuts one tool's answer marks, each as the field and what it says. Any tool's answer the page refused whole
 * (`refused`, past its byte cap or for any other reason) carried nothing.
 *
 * @param tool the tool the model called
 * @param answer the top of its parsed answer
 * @returns one clause per cut, in the entry's order
 */
export function toolCutsOf({ tool, answer }: { tool: string; answer: Bag }): readonly string[] {
  const refused = valueAt({ answer, path: "refused" });
  if (typeof refused === "string" && refused !== "") {
    return [`refused: ${refused}`];
  }
  // Found rather than indexed: a tool that is not a read has no entry, which the record's type cannot say.
  const entry = Object.entries(TOOL_CUTS).find(([name]) => name === tool)?.[1];
  if (entry === undefined) {
    return [];
  }
  const own = entry.probes.flatMap((probe) => {
    const found = probed({ answer, probe });
    return found === undefined ? [] : [found];
  });
  return tool === "verb" ? [...own, ...verbChildCutsOf({ answer })] : own;
}

/** The cuts a traced verb's own JSON marks, named as coming from its stdout; none for any other child. */
function verbChildCutsOf({ answer }: { answer: Bag }): readonly string[] {
  const command = valueAt({ answer, path: "command" });
  const text = valueAt({ answer, path: "stdout.text" });
  const complete =
    valueAt({ answer, path: "format" }) === "json" && valueAt({ answer, path: "stdout.truncated" }) === false;
  if (typeof command !== "string" || typeof text !== "string" || !complete) {
    return [];
  }
  const probes = Object.entries(VERB_CHILD_CUTS).find(
    ([words]) => command === words || command.startsWith(`${words} `),
  )?.[1];
  const child = childDocument({ text });
  if (probes === undefined || !isBag(child)) {
    return [];
  }
  return probes.flatMap((probe) => {
    const found = probed({ answer: child, probe });
    return found === undefined ? [] : [`stdout ${found}`];
  });
}

/**
 * A child's stdout as JSON, or `undefined` when it does not parse. The route marks `format: "json"` only for text it
 * has already parsed (`stdoutFormat`, `src/talk/verbOutput.ts`), so the caller meets `undefined` only from a hand-made
 * answer.
 */
function childDocument({ text }: { text: string }): Json | undefined {
  try {
    const value: Json = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
