/**
 * `slopweaver talk fidelity` — whether each summary on a call kept its source's claims. By default the claim reading
 * (`src/talk/callFidelity.ts`): both hops a call file records, source to answer on both surfaces and answer to voice,
 * counted by kind of change, then the newest pairs carrying one. `--words` gives the content-word reading of the voice
 * hop alone (`src/talk/voiceFidelity.ts`): per day, how many handed messages the voice added words to or moved one in.
 *
 * The question is whether the voice's paraphrase is a regression, answered from evidence, and it covers every summary
 * on the voice and the messenger. Every figure is a CANDIDATE, since overlap reads no meaning, and the output says so on its first line. Zero findings exits 0.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { callFidelityReport } from "../../../talk/callFidelity.js";
import { type CallRecord, foldCall } from "../../../talk/callRecord.js";
import { readCallEntriesCounted, readCalls } from "../../../talk/callStore.js";
import { type FidelityPair, type FidelityReport, voiceFidelityReport } from "../../../talk/voiceFidelity.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { wordsWindow } from "../profile/wordsArgs.js";
import { talkHomeOf } from "./args.js";
import { type FidelityArgs, parseFidelityArgs } from "./callArgs.js";
import { claimTextLines, shownClaimPairs, UNCALIBRATED_KINDS } from "./fidelityClaimsLines.js";
import { TALK_FIDELITY_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "fidelity", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The window when none is named: the sixty days `talk cut-ins` reads by default, so the two line up. */
const DEFAULT_SINCE = "60d";

/** A whole call's window: every message it holds, whenever written. */
const WHOLE_CALL = { sinceIso: "1970-01-01T00:00:00.000Z", untilIso: "9999-12-31T23:59:59.999Z" } as const;

/** How much of a handed message or a spoken answer one text line shows. */
const SHOWN_CHARS = 240;

/** How many gap lines the text output prints before it counts the rest. */
const SHOWN_GAPS = 20;

/** The calls one invocation reads, and the window it counts. */
interface FidelityInput {
  readonly calls: readonly CallRecord[];
  readonly unreadable: readonly string[];
  readonly sinceIso: string;
  readonly untilIso: string;
}

/**
 * The calls and window an invocation names: one call whole, or every call written inside a window.
 *
 * @returns the input, or the exit code and lines of a refusal
 */
function inputOf({
  args,
  home,
  nowIso,
}: {
  args: FidelityArgs;
  home: string;
  nowIso: string;
}): { readonly input: FidelityInput } | { readonly code: number; readonly lines: readonly string[] } {
  if (args.call !== undefined) {
    const read = readCallEntriesCounted({ callId: args.call, home });
    if (read.isErr()) {
      return { code: EXIT_ERROR, lines: [`talk fidelity: ${read.error.message}`] };
    }
    const call = foldCall({ callId: args.call, entries: read.value.entries, skipped: read.value.skipped });
    if (call === undefined) {
      return { code: EXIT_EXPECTED_EMPTY, lines: [`talk fidelity: no readable call ${args.call} on file`] };
    }
    return { input: { calls: [call], unreadable: [], ...WHOLE_CALL } };
  }
  let since = DEFAULT_SINCE;
  if (args.since !== undefined) {
    since = args.since;
  }
  const window = wordsWindow({ nowIso, since, until: args.until });
  if (window.isErr()) {
    return { code: EXIT_USAGE, lines: window.error.map((problem) => `talk fidelity: ${problem}`) };
  }
  const { sinceIso, untilIso } = window.value;
  const read = readCalls({ home, keep: { sinceIso } });
  if (read.isErr()) {
    return { code: EXIT_ERROR, lines: [`talk fidelity: ${read.error.message}`] };
  }
  return { input: { calls: read.value.calls, sinceIso, unreadable: read.value.unreadable, untilIso } };
}

/** The pairs worth printing: those with a divergence, newest first, at most `limit`. */
function shownPairs({ limit, report }: { limit: number; report: FidelityReport }): readonly FidelityPair[] {
  return report.pairs
    .filter((pair) => pair.added.length > 0 || pair.relocated.length > 0)
    .toReversed()
    .slice(0, limit);
}

/** A text cut to the shown length, its whitespace folded. */
function clip({ text }: { text: string }): string {
  const folded = text.replaceAll(/\s+/gu, " ").trim();
  if (folded.length <= SHOWN_CHARS) {
    return folded;
  }
  return `${folded.slice(0, SHOWN_CHARS)}…`;
}

/** Some words as one comma-separated list, a dash when there are none. */
function wordList({ words }: { words: readonly string[] }): string {
  if (words.length === 0) {
    return "-";
  }
  return words.join(", ");
}

/** Per hundred spoken content words, to one decimal place. */
function per100({ count, spoken }: { count: number; spoken: number }): string {
  if (spoken === 0) {
    return "-";
  }
  return ((count * 100) / spoken).toFixed(1);
}

/**
 * The verb's body with its inputs injected — what the unit test drives, since `logger.out` cannot be read back.
 *
 * @param args the parsed flags
 * @param home the Slopweaver home
 * @param nowIso the instant read at, which a span counts back from
 * @param out where each line goes
 * @returns 0 with or without a divergence, an empty window included, 2 on a window that will not parse, 3 for a named
 *   call with no file or no call activity on it (nothing parses, or only reconnect lines), 1 when the calls will not
 *   read
 */
export function talkFidelity({
  args,
  home,
  nowIso,
  out,
}: {
  args: FidelityArgs;
  home: string;
  nowIso: string;
  out: (line: string) => void;
}): number {
  const resolved = inputOf({ args, home, nowIso });
  if ("code" in resolved) {
    resolved.lines.forEach((line) => {
      out(line);
    });
    return resolved.code;
  }
  const lines = args.words
    ? wordReadingLines({ args, input: resolved.input, nowIso })
    : claimReadingLines({ args, input: resolved.input, nowIso });
  lines.forEach((line) => {
    out(line);
  });
  return EXIT_OK;
}

/** The claim reading, the default: every pair in `--json`, so a precision grade reads the whole denominator. */
function claimReadingLines({
  args,
  input,
  nowIso,
}: {
  args: FidelityArgs;
  input: FidelityInput;
  nowIso: string;
}): readonly string[] {
  const { calls, sinceIso, unreadable, untilIso } = input;
  const claims = callFidelityReport({ calls, sinceIso, untilIso });
  if (!args.json) {
    return claimTextLines({
      report: claims,
      shown: shownClaimPairs({ limit: args.limit, report: claims }),
      unreadable,
    });
  }
  const value = {
    ...claims,
    observedAtIso: nowIso,
    ok: true,
    sinceIso,
    uncalibratedKinds: [...UNCALIBRATED_KINDS],
    unreadable,
    untilIso,
  };
  return [safeJsonStringify({ label: "talk fidelity", value })];
}

/** The word reading, `--words`: the voice hop's added and moved content words, per day. */
function wordReadingLines({
  args,
  input,
  nowIso,
}: {
  args: FidelityArgs;
  input: FidelityInput;
  nowIso: string;
}): readonly string[] {
  const { calls, sinceIso, unreadable, untilIso } = input;
  const report = voiceFidelityReport({ calls, sinceIso, untilIso });
  const shown = shownPairs({ limit: args.limit, report });
  const divergent = report.pairs.filter((pair) => pair.added.length > 0 || pair.relocated.length > 0).length;
  if (!args.json) {
    return textLines({ divergent, report, shown, unreadable });
  }
  const value = {
    days: report.days,
    divergentPairs: divergent,
    gaps: report.gaps,
    // The JSON says what the text headline says: word overlap was never hand-graded.
    handGraded: false,
    observedAtIso: nowIso,
    ok: true,
    pairs: shown,
    sinceIso,
    totalPairs: report.pairs.length,
    unreadable,
    untilIso,
    voiceCalls: report.voiceCalls,
  };
  return [safeJsonStringify({ label: "talk fidelity", value })];
}

/** The text report: the headline, the per-day table, the shown pairs, then what was not read whole. */
function textLines({
  divergent,
  report,
  shown,
  unreadable,
}: {
  divergent: number;
  report: FidelityReport;
  shown: readonly FidelityPair[];
  unreadable: readonly string[];
}): readonly string[] {
  const lines: string[] = [];
  // Annotated on the binding so the arrow inherits its parameter, the shape `named-object-params` exempts.
  const out: (line: string) => void = (line) => {
    lines.push(line);
  };
  out(
    `talk fidelity: CANDIDATE divergence (word overlap, never meaning: a synonym reads as added; never hand-graded, ` +
      `so not a figure to quote) — ` +
      `${String(divergent)} of ${String(report.pairs.length)} handed message(s) the voice added to or moved a word ` +
      `within, across ${String(report.voiceCalls)} voice call(s) read`,
  );
  if (report.days.length > 0) {
    out("  day         pairs  +added  ~moved  per 100 spoken words (added / moved)");
  }
  report.days.forEach((day) => {
    const rates = `${per100({ count: day.addedWords, spoken: day.spokenWords })} / ${per100({ count: day.relocatedWords, spoken: day.spokenWords })}`;
    out(
      `  ${day.day}  ${String(day.pairs).padStart(5)}  ${String(day.pairsWithAdded).padStart(6)}  ${String(day.pairsWithRelocated).padStart(6)}  ${rates}`,
    );
  });
  shown.forEach((pair) => {
    out(`  ${pair.writtenIso}  ${pair.anchor}`);
    out(`    added: ${wordList({ words: pair.added })} · moved: ${wordList({ words: pair.relocated })}`);
    out(`    handed: ${clip({ text: pair.handed })}`);
    out(`    said:   ${clip({ text: pair.spoken })}`);
  });
  const gaps = [...unreadable, ...report.gaps.map((gap) => `${gap.callId} ${gap.kind}: ${gap.detail}`)];
  gaps.slice(0, SHOWN_GAPS).forEach((why) => {
    out(`  not read whole — ${why}`);
  });
  if (gaps.length > SHOWN_GAPS) {
    out(`  not read whole — and ${String(gaps.length - SHOWN_GAPS)} more (--json lists every one)`);
  }
  return lines;
}

/**
 * Run the `talk fidelity` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkFidelity(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_FIDELITY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFidelityArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_FIDELITY_USAGE });
    return EXIT_USAGE;
  }
  return talkFidelity({
    args: parsed.value,
    home: talkHomeOf({ home: parsed.value.home }),
    nowIso: new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
  });
}

export const talkFidelityCommand = defineCommand({ run: runTalkFidelity });
