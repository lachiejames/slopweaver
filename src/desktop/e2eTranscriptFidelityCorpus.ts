/**
 * The `transcription-fidelity` call scenario's fixed script, the microphone variants it compares and the order its
 * calls run in — pure and versioned, so every number the scenario reports is tied to words chosen BEFORE any result
 * was seen. The requirement is `./e2eTranscriptFidelity.ts`'s header.
 *
 * Every line is synthetic (`AGENTS.md`: nothing installation-specific is committed). The strata are the failure classes
 * the requirement names: a SHORT turn, a turn whose meaning rides its FIRST word, one whose meaning rides its LAST word, and the
 * repository's own nouns (GLOSSARY). Each stratum is spoken once at ordinary level and once quiet, because a quiet
 * onset or trail is where a noise suppressor or gain control would clip. Talking over the voice is NOT a stratum yet:
 * nothing on record can witness that the voice was audible when a line began, so a result there would be inferred.
 *
 * Three calls per variant, paired by round. The lines inside one call are correlated (one network, one session), so
 * the comparison is per call and claims no significance; three pairs is the fewest that can show a direction repeat.
 */

/** Which failure class a line is there to provoke. `setup` is spoken and aligned but never scored. */
export type E2eTranscriptStratum = "setup" | "short" | "start-critical" | "end-critical" | "glossary";

/** How loud a line is played, relative to `say`'s own level. */
export type E2eGainProfile = "ordinary" | "quiet";

/** One line of the script. */
interface E2eTranscriptUtterance {
  readonly id: string;
  readonly text: string;
  /** The words, as `fidelityWords` renders them, whose loss or substitution changes what was meant. */
  readonly critical: readonly string[];
  readonly stratum: E2eTranscriptStratum;
  readonly gain: E2eGainProfile;
  readonly scored: boolean;
  /** The silence after it, room for the voice to answer before the next line. */
  readonly silenceAfterMs: number;
}

/** The versioned script. */
export interface E2eTranscriptCorpus {
  readonly version: "transcription-fidelity-v1";
  readonly utterances: readonly E2eTranscriptUtterance[];
}

/** The microphone processing a test call asks Chromium for. `control` is today's, with gain control made explicit. */
export type E2eMicVariant = "control" | "noise-suppression-off" | "auto-gain-off" | "both-off";

/** A variant compared against control. */
export type E2eMicCandidate = Exclude<E2eMicVariant, "control">;

/** Every variant, for parsing a flag or an argv switch. */
export const E2E_MIC_VARIANTS: readonly E2eMicVariant[] = [
  "control",
  "noise-suppression-off",
  "auto-gain-off",
  "both-off",
];

/** Every candidate, for the `--call-mic-candidate` flag. */
export const E2E_MIC_CANDIDATES: readonly E2eMicCandidate[] = ["noise-suppression-off", "auto-gain-off", "both-off"];

/** One call of the paired run. */
export interface E2eTranscriptFidelitySpec {
  readonly corpusVersion: E2eTranscriptCorpus["version"];
  readonly round: 1 | 2 | 3;
  readonly variant: E2eMicVariant;
  readonly candidate: E2eMicCandidate;
}

/** The scale factor each gain profile multiplies the spoken samples by: quiet is about −9 dB. */
export const GAIN_FACTOR: Readonly<Record<E2eGainProfile, number>> = { ordinary: 1, quiet: 0.35 };

/**
 * The silence before the first line: Chromium starts the file when the page opens the microphone, before the call
 * listens. The same 15 s the single-prompt microphone leads with, for the same measured loss (`e2eCallAudio.ts`).
 */
export const FIDELITY_LEAD_MS = 15_000;

/** The longest a fidelity call may run before it is hung up, whatever has been heard. */
export const FIDELITY_CALL_CAP_MS = 420_000;

/** The silence after each scored line: the voice's "okay" fits well inside it. */
const BETWEEN_MS = 20_000;

/**
 * The silence after the last line. Chromium LOOPS the fake microphone's file, so the file must outlast the call's cap
 * or the script is spoken a second time into the same call and scored as insertions. The lead and the silences alone
 * come to 175 s, so this tail clears the cap before a word of speech is counted.
 */
const TAIL_MS = 260_000;

/** The script, v1. Changing a word is a new version, never an edit of this one. */
export const TRANSCRIPT_FIDELITY_CORPUS: E2eTranscriptCorpus = {
  utterances: [
    {
      critical: [],
      gain: "ordinary",
      id: "setup",
      scored: false,
      silenceAfterMs: BETWEEN_MS,
      stratum: "setup",
      text: "This is a synthetic transcription test. Reply with okay after each line and do not use tools.",
    },
    line({ critical: ["hello"], gain: "ordinary", id: "short-ordinary", stratum: "short", text: "Hello." }),
    line({ critical: ["card"], gain: "quiet", id: "short-quiet", stratum: "short", text: "Say card." }),
    line({
      critical: ["delete"],
      gain: "ordinary",
      id: "start-ordinary",
      stratum: "start-critical",
      text: "Delete is the first word in this synthetic sentence.",
    }),
    line({
      critical: ["keep"],
      gain: "quiet",
      id: "start-quiet",
      stratum: "start-critical",
      text: "Keep is the first word in this synthetic sentence.",
    }),
    line({
      critical: ["urgent"],
      gain: "ordinary",
      id: "end-ordinary",
      stratum: "end-critical",
      text: "The final word in this synthetic sentence is urgent.",
    }),
    line({
      critical: ["overnight"],
      gain: "quiet",
      id: "end-quiet",
      stratum: "end-critical",
      text: "The final word in this automated test line is overnight.",
    }),
    line({
      critical: ["slopweaver", "queue"],
      gain: "ordinary",
      id: "glossary-ordinary",
      stratum: "glossary",
      text: "This synthetic glossary line says Slopweaver queue.",
    }),
    {
      critical: ["codex", "cmux", "handover"],
      gain: "quiet",
      id: "glossary-quiet",
      scored: true,
      silenceAfterMs: TAIL_MS,
      stratum: "glossary",
      text: "This synthetic glossary line says Codex cmux handover.",
    },
  ],
  version: "transcription-fidelity-v1",
};

/** A scored line with the ordinary gap after it. */
function line({
  critical,
  gain,
  id,
  stratum,
  text,
}: {
  critical: readonly string[];
  gain: E2eGainProfile;
  id: string;
  stratum: E2eTranscriptStratum;
  text: string;
}): E2eTranscriptUtterance {
  return { critical, gain, id, scored: true, silenceAfterMs: BETWEEN_MS, stratum, text };
}

/**
 * The six calls, counterbalanced by round so neither member of a pair always runs first: control then candidate,
 * candidate then control, control then candidate. Pairs are matched by `round`, never by position.
 *
 * @param candidate the variant compared against control
 * @returns the calls, in the order they run
 */
export function transcriptFidelitySchedule({
  candidate,
}: {
  candidate: E2eMicCandidate;
}): readonly E2eTranscriptFidelitySpec[] {
  const version = TRANSCRIPT_FIDELITY_CORPUS.version;
  const call = ({ round, variant }: { round: 1 | 2 | 3; variant: E2eMicVariant }): E2eTranscriptFidelitySpec => ({
    candidate,
    corpusVersion: version,
    round,
    variant,
  });
  return [
    call({ round: 1, variant: "control" }),
    call({ round: 1, variant: candidate }),
    call({ round: 2, variant: candidate }),
    call({ round: 2, variant: "control" }),
    call({ round: 3, variant: "control" }),
    call({ round: 3, variant: candidate }),
  ];
}

/**
 * A variant named in text, or `undefined` when the text names none.
 *
 * @param text a flag value or an argv switch's value
 * @returns the variant
 */
export function parseMicVariant({ text }: { text: string }): E2eMicVariant | undefined {
  return E2E_MIC_VARIANTS.find((variant) => variant === text);
}

/**
 * A candidate named in text, or `undefined` when the text names none — `control` is never a candidate.
 *
 * @param text the `--call-mic-candidate` value
 * @returns the candidate
 */
export function parseMicCandidate({ text }: { text: string }): E2eMicCandidate | undefined {
  return E2E_MIC_CANDIDATES.find((candidate) => candidate === text);
}
