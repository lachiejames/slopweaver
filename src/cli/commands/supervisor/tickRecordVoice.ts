/**
 * The unread-voice tick gate's text: its refusal, and the stretches it passed as still being spoken, which a recorded
 * tick names so the pass is never silent. The verdict is `../../../supervisor/voiceUnreadGate.ts`, composed with the
 * other gates in `./tickRecordGates.ts`.
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { VoiceUnreadVerdict } from "../../../supervisor/voiceUnreadGate.js";
import type { UnreadWord } from "../../../talk/unreadWords.js";

/** How many unread words the voice refusal quotes before it counts the rest. */
const VOICE_WORDS_SHOWN = 10;

/** How many characters of each quoted word the voice refusal carries — `talk unread` prints the whole of it. */
const VOICE_WORD_CHARS = 160;

/**
 * Render the unread-voice gate's refusal: the words the supervisor has not read, and the one way through.
 *
 * @param verdict the refused or unreadable verdict
 * @returns the hatch's four lines, one line per quoted word, the overflow line when any, and the way out
 */
export function voiceRefusalLines({
  verdict,
}: {
  verdict: Exclude<VoiceUnreadVerdict, { kind: "clean" }>;
}): readonly string[] {
  const hatch = hatchFor({ id: "unread-voice-words" });
  if (verdict.kind === "unreadable") {
    return [
      ...hatchRefusalLines({ detail: `the call files could not be read for unread words — ${verdict.why}`, hatch }),
      "Fix what that names — a call file rewritten under the cursor is refused, never read as consumed — and " +
        "re-run this. It refuses rather than passing, because a check that reports clean on an input it never saw " +
        "is worse than no check.",
    ];
  }
  if (verdict.neverMarked) {
    return [
      ...hatchRefusalLines({
        detail:
          "the supervisor's `talk unread` cursor has never been marked, so no word of the owner's on a call is on record " +
          "as read, and a first read shows only the last 24 hours",
        hatch,
      }),
      "Run `slopweaver talk unread` and act on each stretch, then `slopweaver talk unread --mark` — which refuses " +
        "and says how many older stretches it would pass over unprinted, if any: read those with `--all`, or " +
        "`--mark --adopt` when they were already read — and re-run this.",
    ];
  }
  const count = verdict.words.length + verdict.unparseable.length;
  const shown = verdict.words.slice(0, VOICE_WORDS_SHOWN).map((word) => quotedWord({ word }));
  const unparseable = verdict.unparseable.map(
    (line) => `  unparseable line in call ${line.callId} at byte ${String(line.byteOffset)}`,
  );
  const rest = verdict.words.length - shown.length;
  return [
    ...hatchRefusalLines({
      detail:
        `${String(count)} stretch(es) of the owner's speech on a call are unread by the supervisor — finished, or a stretch ` +
        "still being spoken that nobody has read the start of, whose call ended, or that stopped growing",
      hatch,
    }),
    ...shown,
    ...(rest > 0 ? [`  … and ${String(rest)} more — slopweaver talk unread prints every one, whole`] : []),
    ...unparseable,
    ...stillSpokenLines({ stillSpoken: verdict.stillSpoken }),
    "Run `slopweaver talk unread`, read each for an explicit or IMPLIED steer and rule, register or " +
      "`supervisor intake-mark --turn talk-call:…` it, then `slopweaver talk unread --mark` — which prints what it " +
      "records as read, so act on anything new it shows — and re-run this.",
  ];
}

/**
 * One unread word as a refusal or a record quotes it: its instant, its pointer and the start of its text.
 *
 * @param word the unread word
 * @returns the indented line
 */
function quotedWord({ word }: { word: UnreadWord }): string {
  return `  ${word.atIso} ${word.pointer} "${word.text.trim().slice(0, VOICE_WORD_CHARS)}"`;
}

/**
 * The stretches a verdict passed as still being spoken — none for one that could not read the call files.
 *
 * @param voice the unread-voice verdict
 * @returns the stretches
 */
export function stillSpokenOf({ voice }: { voice: VoiceUnreadVerdict }): readonly UnreadWord[] {
  return voice.kind === "unreadable" ? [] : voice.stillSpoken;
}

/**
 * Name every stretch the voice gate passed as still being spoken, or as inside the owner's two-minute quiet floor — what a
 * tick records past, so the pass is never silent. Each stays unread and refuses a later tick once the floor has passed
 * and it is final, its call ends, or it stops growing.
 *
 * @param stillSpoken the stretches the verdict carried as still being spoken
 * @returns nothing for none, else a heading and one quoted line per stretch
 */
export function stillSpokenLines({ stillSpoken }: { stillSpoken: readonly UnreadWord[] }): readonly string[] {
  if (stillSpoken.length === 0) {
    return [];
  }
  return [
    `${String(stillSpoken.length)} stretch(es) of the owner's speech are still being spoken, or inside the two-minute quiet ` +
      "floor, and do not refuse this tick — each stays unread, and refuses a later tick once the floor has passed and " +
      "it is final, its call ends, or it stops growing:",
    ...stillSpoken.map((word) => quotedWord({ word })),
  ];
}
