/**
 * The plain-text lines `slopweaver talk unread` prints for one read — pure. Each quiet batch is headed
 * (`src/talk/quietBatches.ts`), then its stretches, each worded as evidence with what it answered. Which batch is
 * printed, and the `--json` shape, are `./unreadReport.ts`'s.
 */
import { type AnswerContext, answerContextLines } from "../../../talk/answerContext.js";
import { originPhrase } from "../../../talk/callOrigin.js";
import type { HeldRelay } from "../../../talk/chairWake.js";
import { quietBatches, quietBatchLine } from "../../../talk/quietBatches.js";
import type { ForeignCallWords, UnreadSelection, UnreadWord } from "../../../talk/unreadWords.js";

/**
 * The relay the call recorded next after a word, as evidence — a relay line names no segment, so never "relayed as".
 *
 * @param relay the next relay line, if any
 * @returns the phrase
 */
function relayPhrase({ relay }: { relay: UnreadWord["nextRelay"] }): string {
  if (relay === undefined) {
    return "no relay line after it among the unread lines";
  }
  const turn = relay.turnId === null ? "(no turn)" : `talk:${relay.turnId}`;
  return `next unread relay line after it: ${turn} ${relay.outcome} at ${relay.atIso}`;
}

/**
 * One word as the chair reads it: when, which pointer, whether the call was still in it, and the relay recorded
 * next after it — worded as evidence, because a relay line names no segment.
 *
 * @param answer what it answered: the voice's turn before it, and the verdict its next relay's turn stored
 * @param word the unread word
 * @returns its header line, its text line, what it answered, and a line per revision
 */
function wordLines({ answer, word }: { answer: AnswerContext | undefined; word: UnreadWord }): readonly string[] {
  const state = word.final ? "final" : "cut off mid-speech";
  const relay = relayPhrase({ relay: word.nextRelay });
  const cut = word.cut ? " [the call store cut it here; later words were never written down]" : "";
  return [
    `${word.atIso}  ${word.pointer}  ${state}; ${relay}`,
    `  "${word.text}"${cut}`,
    ...printedAnswerLines({ context: answer, relayPrinted: word.nextRelay !== undefined }),
    ...word.revisions.map((text) => `  earlier reading, since revised: "${text}"`),
  ];
}

/**
 * What one stretch answered, under its words: a bare "yes" is unreadable without the question before it
 * (`src/talk/answerContext.ts`). The contexts are read once over everything unread, so the verdict is the next relay's
 * turn's, named as that since a relay line names no segment. When that relay line lies past what this read prints —
 * past a batch's end, or past a part, which is the first line of its read — the verdict is named as past it: marking
 * the read moves past these words, so dropping it would lose the verdict for good.
 *
 * @param context the context read over everything unread, or `undefined` when none was
 * @param relayPrinted whether this read prints the relay line the verdict came from
 * @returns the voice's turn line and the verdict line, or the one line saying neither was read
 */
export function printedAnswerLines({
  context,
  relayPrinted,
}: {
  context: AnswerContext | undefined;
  relayPrinted: boolean;
}): readonly string[] {
  if (context === undefined) {
    return ["  what these words answered was not read: read the call before judging them"];
  }
  const [voice, verdict] = answerContextLines({ context, indent: "" });
  let whose = "";
  if (context.triage.kind !== "not-applicable") {
    whose = relayPrinted ? "next relay's " : "past this read, the next relay's ";
  }
  return [`  ${voice!}`, `  ${whose}${verdict!}`];
}

/**
 * One call a console that is not the owner's recorded, named rather than read as theirs: what its speech is NOT, and where it came
 * from (`src/talk/callOrigin.ts`).
 *
 * @param call the call set aside
 * @returns the line
 */
function foreignLine({ call }: { call: ForeignCallWords }): string {
  return (
    `NOT THEIRS: call ${call.callId} — ${String(call.stretches)} stretch(es) recorded as them by ${originPhrase({ origin: call.origin })}; ` +
    "set aside, never their words or intake"
  );
}

/**
 * The plain-text report of one read.
 *
 * @param answers what each stretch answered, keyed by its pointer
 * @param selection what is unread
 * @param scope the phrase naming what "since" means for this read
 * @param relays the relays held for the chair's quiet batch, headed beside the stretches they were held among
 * @param nowIso the instant a quiet batch is judged due at
 * @returns the lines to print: each quiet batch's head, then its stretches
 */
export function reportLines({
  answers,
  selection,
  scope,
  relays,
  nowIso,
}: {
  answers: ReadonlyMap<string, AnswerContext>;
  selection: UnreadSelection;
  scope: string;
  relays: readonly HeldRelay[];
  nowIso: string;
}): readonly string[] {
  const count = selection.words.length + selection.unparseable.length;
  const setAside = selection.foreign.map((call) => foreignLine({ call }));
  const batches = quietBatches({ nowIso, relays, words: selection.words });
  if (count === 0) {
    return [
      `talk unread: nothing new from them ${scope}`,
      ...batches.map((batch, index) => quietBatchLine({ batch, index: index + 1 })),
      ...setAside,
    ];
  }
  const byPointer = new Map(selection.words.map((word) => [word.pointer, word]));
  return [
    `talk unread: ${String(selection.words.length)} stretch(es) of their speech ${scope}, relayed or not — read each for an explicit or IMPLIED steer`,
    ...batches.flatMap((batch, index) => [
      quietBatchLine({ batch, index: index + 1 }),
      ...batch.stretches.flatMap((pointer) =>
        wordLines({ answer: answers.get(pointer), word: byPointer.get(pointer)! }),
      ),
    ]),
    ...selection.unparseable.map(
      (line) => `unparseable line in call ${line.callId} at byte ${String(line.byteOffset)}: ${line.text}`,
    ),
    ...setAside,
  ];
}
