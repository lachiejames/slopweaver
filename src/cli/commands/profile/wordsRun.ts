/**
 * `slopweaver profile words` — their own words as one queryable source: every turn they spoke on a console call, gave the
 * console, or typed into the supervisor chain, each with its instant, spoken or written, and the anchor that reads it
 * whole again.
 *
 * The shell is here; what an utterance is and how a list is cut is `src/profile/ownerWords.ts`, and which chair's
 * transcript holds which of their turns is `src/profile/supervisorWords.ts`. It reads the record files on this machine,
 * never the store, so it answers the moment a turn is written.
 */
import { join } from "node:path";

import { anchorParses, resolveRawWords } from "../../../handover/hisWordsResolve.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import {
  type OwnerUtterance,
  type OwnerWordsGap,
  queryOwnerWords,
  utteranceFromRaw,
  utterancesFromCalls,
  utterancesFromConsoleTurns,
  utterancesFromSupervisorTurns,
} from "../../../profile/ownerWords.js";
import { ownerWordsLines, utteranceHead } from "../../../profile/ownerWordsLines.js";
import { outsideChairReason, readSupervisorWords } from "../../../profile/supervisorWords.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { allCallIds, type CallsRead, readCalls } from "../../../talk/callStore.js";
import { readConsoleTurns } from "../../../talk/consoleTurns.js";
import { indexedCalls } from "../../../talk/unreadRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "../talk/args.js";
import { profileTail } from "./core.js";
import { type ProfileWordsArgs, parseProfileWordsArgs, wordsWindow } from "./wordsArgs.js";
import { PROFILE_WORDS_USAGE } from "./wordsUsage.js";

/**
 * Every call the index names whose file is gone, and why the index could not say. A call is indexed before its first
 * line is written, so a deleted file is a loss rather than no call; with no file there is no
 * instant to judge, so it is a gap whatever the window. An indexed file that is there and held no line — zero bytes
 * or only whitespace — is the same loss, since the index says a call began. A call the read
 * already named as unreadable is not named twice, under either prefix: the listing names an entry that is not a
 * regular file `<id>.jsonl:`, and the file read names one that failed `<id>:`.
 */
function indexedCallGaps({ home, read }: { home: string; read: CallsRead | undefined }): readonly OwnerWordsGap[] {
  const indexed = indexedCalls({ home });
  if (indexed.isErr()) {
    return [{ source: "console-calls", why: `the call index would not read: ${indexed.error.message}` }];
  }
  const present = allCallIds({ home });
  if (present.isErr()) {
    return [{ source: "console-calls", why: present.error.message }];
  }
  const files = new Set(present.value);
  const unreadable = read === undefined ? [] : read.unreadable;
  const named = ({ callId }: { callId: string }): boolean =>
    unreadable.some((why) => why.startsWith(`${callId}:`) || why.startsWith(`${callId}.jsonl:`));
  const gaps = indexed.value
    .filter((callId) => !files.has(callId) && !named({ callId }))
    .map((callId): OwnerWordsGap => ({
      source: "console-calls",
      why: `call:${callId} is in the call index but its file is gone`,
    }));
  if (read === undefined) {
    return gaps;
  }
  const folded = new Set(read.calls.map((call) => call.callId));
  const empty = indexed.value.filter((callId) => files.has(callId) && !folded.has(callId) && !named({ callId }));
  return [
    ...gaps,
    ...empty.map((callId): OwnerWordsGap => ({
      source: "console-calls",
      why: `call:${callId} is in the call index but its file holds no call activity`,
    })),
  ];
}

/** The gap source a listed utterance's `where` reads under. */
const GAP_SOURCE: Readonly<Record<OwnerUtterance["where"], OwnerWordsGap["source"]>> = {
  "call-landing": "console-calls",
  "claude-session": "supervisor",
  "console-call": "console-calls",
  "console-relay": "console-relays",
  "console-typed": "console-relays",
  supervisor: "supervisor",
};

/**
 * The utterances whose anchor the resolver would read again, and one gap per source naming the rest. A record a
 * looser writer-side check accepted — a uuid outside the pointer grammar, a call file named for one not v4 — would otherwise
 * list under an anchor `profile words <anchor>` and `handover quote --anchor` refuse. Only a turn
 * inside the window is named, since one outside it was never going to be listed.
 */
function addressableUtterances({
  utterances,
  sinceIso,
  untilIso,
}: {
  utterances: readonly OwnerUtterance[];
  sinceIso: string;
  untilIso: string;
}): { readonly kept: readonly OwnerUtterance[]; readonly gaps: readonly OwnerWordsGap[] } {
  const kept = utterances.filter((one) => anchorParses({ anchor: one.anchor }));
  const floor = Date.parse(sinceIso);
  const ceiling = Date.parse(untilIso);
  const lost = utterances.filter((one) => {
    const at = Date.parse(one.atIso);
    return !anchorParses({ anchor: one.anchor }) && (Number.isNaN(at) || (at >= floor && at < ceiling));
  });
  const sources = [...new Set(lost.map((one) => GAP_SOURCE[one.where]))];
  const gaps = sources.map((source): OwnerWordsGap => {
    const these = lost.filter((one) => GAP_SOURCE[one.where] === source);
    return {
      source,
      why: `${String(these.length)} turn(s) from the owner carry an anchor no reader takes, so they are not listed (first: ${these[0]!.anchor})`,
    };
  });
  return { gaps, kept };
}

/**
 * Every utterance of their inside a window, from the three places they speak, and every record that would not read.
 *
 * @param home the Slopweaver home the talk records and the supervisor chain journal live under
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param sinceIso the floor, inclusive
 * @param untilIso the ceiling, exclusive — the query cuts to it; the readers only bound what they open
 * @returns the utterances, unordered, and the gaps
 */
export function gatherOwnerWords({
  home,
  claudeHome,
  sinceIso,
  untilIso,
}: {
  home: string;
  claudeHome: string;
  sinceIso: string;
  untilIso: string;
}): { readonly utterances: readonly OwnerUtterance[]; readonly gaps: readonly OwnerWordsGap[] } {
  const utterances: OwnerUtterance[] = [];
  const gaps: OwnerWordsGap[] = [];
  // Every call file, not those touched since the floor: a restored or copied file can carry an mtime older than the
  // lines inside it, and the window is applied to each line's own instant afterwards.
  const calls = readCalls({ home, keep: { limit: Number.POSITIVE_INFINITY } });
  if (calls.isErr()) {
    gaps.push({ source: "console-calls", why: calls.error.message });
  } else {
    const fromCalls = utterancesFromCalls({ read: calls.value });
    utterances.push(...fromCalls.utterances);
    gaps.push(...fromCalls.gaps);
  }
  gaps.push(...indexedCallGaps({ home, read: calls.isOk() ? calls.value : undefined }));
  const relays = readConsoleTurns({ home, sinceIso, untilIso });
  if (relays.isErr()) {
    gaps.push({ source: "console-relays", why: relays.error.message });
  } else {
    const fromRelays = utterancesFromConsoleTurns(relays.value);
    utterances.push(...fromRelays.utterances);
    gaps.push(...fromRelays.gaps);
  }
  const chain = utterancesFromSupervisorTurns(readSupervisorWords({ claudeHome, home, sinceIso, untilIso }));
  utterances.push(...chain.utterances);
  gaps.push(...chain.gaps);
  const addressable = addressableUtterances({ sinceIso, untilIso, utterances });
  return { gaps: [...gaps, ...addressable.gaps], utterances: addressable.kept };
}

/** One record whole, by its anchor. */
function readOneAnchor({
  anchor,
  home,
  claudeHome,
  json,
  out,
}: {
  anchor: string;
  home: string;
  claudeHome: string;
  json: boolean;
  out: (line: string) => void;
}): number {
  const raw = resolveRawWords({ anchor, home, projectsDir: join(claudeHome, "projects") });
  if (raw.isErr()) {
    out(`profile words: ${raw.error.message}`);
    return EXIT_ERROR;
  }
  // A record written before their words were stored holds only the voice's paraphrase; the list names it as a gap, so
  // the one-anchor read refuses it rather than printing an empty turn as theirs.
  if (raw.value.text.trim() === "") {
    out(`profile words: ${anchor} holds none of their own words — the record was written before they were stored`);
    return EXIT_ERROR;
  }
  // The list names a record with no readable instant as unread and `handover quote` refuses it, so this read does too,
  // rather than print the malformed instant as a timestamp.
  if (Number.isNaN(Date.parse(raw.value.atIso))) {
    out(
      `profile words: ${anchor} carries no readable instant (${raw.value.atIso}), so it is not read as a turn of theirs`,
    );
    return EXIT_ERROR;
  }
  // The list leaves the console's typed relay and wake lines out as not their turn, and the read refuses them too
  // (`TURN_CONSOLE_LINE`), so one never reaches here.
  const outside = outsideChairReason({ anchor, atIso: raw.value.atIso, home });
  if (outside !== undefined) {
    out(`profile words: ${outside}`);
    return EXIT_ERROR;
  }
  const one = utteranceFromRaw({ anchor, raw: raw.value });
  if (json) {
    out(safeJsonStringify({ label: "profile words anchor", value: one }));
    return EXIT_OK;
  }
  out(utteranceHead({ one }));
  one.text.split("\n").forEach((line) => {
    out(`    ${line}`);
  });
  return EXIT_OK;
}

/**
 * The verb's body with its inputs injected — what the unit test drives, since `logger.out` cannot be read back.
 *
 * @param args the parsed flags
 * @param home the Slopweaver home
 * @param claudeHome the directory holding Claude Code's `projects`
 * @param nowIso the instant a relative `--since` counts back from and a missing `--until` stands for
 * @param out where each line goes
 * @returns 0 with a match, 3 with none and nothing unread, 1 with none and something unread or an anchor that
 *   would not read, 2 on a window that holds nothing
 */
export function profileWords({
  args,
  home,
  claudeHome,
  nowIso,
  out,
}: {
  args: ProfileWordsArgs;
  home: string;
  claudeHome: string;
  nowIso: string;
  out: (line: string) => void;
}): number {
  if (args.anchor !== undefined) {
    return readOneAnchor({ anchor: args.anchor, claudeHome, home, json: args.json, out });
  }
  const window = wordsWindow({ nowIso, since: args.since, until: args.until });
  if (window.isErr()) {
    window.error.forEach((problem) => {
      out(`profile words: ${problem}`);
    });
    return EXIT_USAGE;
  }
  const { sinceIso, untilIso } = window.value;
  const gathered = gatherOwnerWords({ claudeHome, home, sinceIso, untilIso });
  const report = queryOwnerWords({
    ...gathered,
    query: { how: args.how, limit: args.limit, phrase: args.phrase, sinceIso, untilIso },
  });
  if (args.json) {
    out(safeJsonStringify({ label: "profile words", value: report }));
  } else {
    ownerWordsLines({ full: args.full, report }).forEach((line) => {
      out(line);
    });
  }
  if (report.matched > 0) {
    return EXIT_OK;
  }
  if (report.gaps.length > 0) {
    return EXIT_ERROR;
  }
  return EXIT_EXPECTED_EMPTY;
}

/**
 * Run the `profile words` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runProfileWords(argv: readonly string[]): number {
  const rest = profileTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PROFILE_WORDS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProfileWordsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: PROFILE_WORDS_USAGE });
    return EXIT_USAGE;
  }
  let nowIso = new Date().toISOString();
  if (parsed.value.now !== undefined) {
    nowIso = new Date(parsed.value.now).toISOString();
  }
  return profileWords({
    args: parsed.value,
    claudeHome: claudeHomeDir(),
    home: talkHomeOf({ home: parsed.value.home }),
    nowIso,
    out: (line) => {
      logger.out({ line });
    },
  });
}

export const profileWordsCommand = defineCommand({ run: runProfileWords });
