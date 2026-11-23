/**
 * `slopweaver talk history` — "what did I ask about X": the owner's turns across the whole supervisor chain and the
 * pinned chair's replies, searched by phrase, for the console voice.
 *
 * The voice's `supervisor_history` tool runs this. The owner's side is `readOwnerTurnWindow`, the chain read
 * `supervisor owner-turns` delivers from — every transcript that has held the pin, the owner's mid-turn queued dumps
 * included. The chair's side is its prose from the pinned transcript's tail only, the same read
 * `talk supervisor` makes, so an older chair's reply is out of reach and the answer's note says so. What
 * matches and how it is cut is `src/talk/supervisorHistory.ts`.
 */
import { logger } from "../../../lib/logger.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { chairClaudeHome, type OwnerTurnWindow, readOwnerTurnWindow } from "../../../supervisor/ownerTurnWindow.js";
import { chairRepliesFromTail, type HistoryTurn, searchHistory } from "../../../talk/supervisorHistory.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseHistoryArgs } from "./knowArgs.js";
import { TALK_HISTORY_USAGE } from "./knowUsage.js";
import { readSupervisorTail } from "./supervisorRun.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "history", ...]`. */
const VERB_ARG_OFFSET = 4;

/** Hours in a day, for the chain read's day-denominated window. */
const HOURS_PER_DAY = 24;

/** How many owner-side gaps are listed one per line; the rest are counted in one more. */
const OWNER_GAPS_LISTED = 3;

/** The most code points one gap line carries. */
const GAP_CHARS = 300;

/**
 * Run the `talk history` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkHistory(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_HISTORY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHistoryArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_HISTORY_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const { sinceIso, turns, unread } = gatherTurns({ home, hours: args.hours, now: args.now });
  // The unread lines share the cap with the hits, so the hits get what the lines leave.
  const unreadBytes = Buffer.byteLength(JSON.stringify(unread), "utf8");
  const answer = searchHistory({
    maxBytes: Math.max(0, args.maxBytes - unreadBytes),
    phrase: args.phrase,
    sinceIso,
    turns,
  });
  const document = {
    ...answer,
    reach:
      "The owner's turns: every chair since sinceIso. The chair's replies: the current chair's recent transcript only, " +
      "so an older chair's reply can be missing.",
    unread,
  };
  if (args.json) {
    logger.out({ line: JSON.stringify(document) });
    return EXIT_OK;
  }
  logger.out({
    line: `talk history: ${String(answer.hits.length)} hit(s) for ${answer.words.join(" ")} since ${answer.sinceIso}`,
  });
  answer.hits.forEach((hit) => {
    logger.out({ line: `  ${hit.atIso} ${hit.who}: ${hit.excerpt.replace(/\s+/gu, " ").slice(0, 200)}` });
  });
  unread.forEach((why) => {
    logger.out({ line: `  unread — ${why}` });
  });
  return EXIT_OK;
}

/** The owner's turns in the window and the current chair's replies inside it, with what could not be read. */
function gatherTurns({ home, hours, now }: { home: string; hours: number; now: string | undefined }): {
  readonly sinceIso: string;
  readonly turns: readonly HistoryTurn[];
  readonly unread: readonly string[];
} {
  let nowIso = new Date().toISOString();
  if (now !== undefined) {
    nowIso = new Date(now).toISOString();
  }
  const window = readOwnerTurnWindow({ claudeHome: chairClaudeHome(), days: hours / HOURS_PER_DAY, home, nowIso });
  const turns: HistoryTurn[] = window.turns
    .filter((turn) => turn.source === "chair")
    .map((turn) => ({ atIso: turn.instantIso, pointer: turn.pointer, text: turn.text, who: "owner" as const }));
  const unread = [...ownerSideUnreadOf({ window })];
  const tail = readSupervisorTail({ claudeHome: claudeHomeDir(), home, session: undefined });
  if (tail.isErr()) {
    unread.push(clipGap({ text: `the chair's replies: ${tail.error.message}` }));
  } else {
    const replies = chairRepliesFromTail({ sinceIso: window.sinceIso, tail: tail.value });
    turns.push(...replies.turns);
    unread.push(...replies.unread);
  }
  return { sinceIso: window.sinceIso, turns, unread };
}

/**
 * What of the owner's side of the window could not be read, so a missing chair is never read as the owner having
 * said nothing there. Bounded: the first {@link OWNER_GAPS_LISTED} gaps one per line, each clipped, then one line
 * counting the rest.
 *
 * @param window the chain read's two gap fields
 * @returns the `unread` lines, empty when the whole window read
 */
export function ownerSideUnreadOf({
  window,
}: {
  window: Pick<OwnerTurnWindow, "unreadable" | "readerGaps">;
}): readonly string[] {
  const gaps = window.unreadable === undefined ? window.readerGaps : [window.unreadable, ...window.readerGaps];
  const listed = gaps.slice(0, OWNER_GAPS_LISTED).map((gap) => clipGap({ text: `the owner's turns: ${gap}` }));
  const rest = gaps.length - listed.length;
  if (rest === 0) {
    return listed;
  }
  return [
    ...listed,
    `the owner's turns: ${String(rest)} more gap(s) not listed, each one a place a turn may be missing`,
  ];
}

/** One gap line clipped to {@link GAP_CHARS} code points, so a long failure cannot crowd the hits out of the cap. */
function clipGap({ text }: { text: string }): string {
  const points = Array.from(text);
  if (points.length <= GAP_CHARS) {
    return text;
  }
  return `${points.slice(0, GAP_CHARS).join("")} …`;
}

export const talkHistoryCommand = defineCommand({ run: runTalkHistory });
