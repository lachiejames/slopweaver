/**
 * What became of each orb cue, as one line of the call file (`name: "cue"`, `./talkTranscript.ts`'s tool line), so a
 * sound the owner expected and never heard leaves a reason on the record instead of silence.
 *
 * A badge shown with no sound effect, while the stall's cue still plays, is the case: the cue path holds a
 * badge over speech, throttles a flicker, and drops a cue that stopped being due while it routed (`./orbCue.ts`,
 * `components/voice/orbCueSound.ts`), every one of them silent by design; nothing on the call file could say which
 * rule fired, so the regression could not be told from the rules working. This names it, per cue, pure.
 */
import type { AnnounceCue, AnnounceStale, TriageDingStale } from "./announceCue";
import type { CueDecision, CueStale, OrbCue } from "./orbCue";
import type { Talking, TalkingSignal } from "./voiceTalking";

/**
 * Where a cue came from: a badge the orb wore, a server `progress` event, the owner's pick's sample, or a server `announce`
 * event heralding a line the owner did not ask for (`./announceCue.ts`).
 */
export type CueSource = "badge" | "progress" | "sample" | "announce";

/** Any sound the page plays: an orb cue or a herald. */
export type CueName = OrbCue | AnnounceCue;

/** Any still-due check a waiting sound can fail: an orb cue's, a herald's, or the page's own triage chime's. */
export type CueTraceStale = CueStale | AnnounceStale | TriageDingStale;

/**
 * What the player made of one cue (`components/voice/orbCueSound.ts`): played; no longer due before or after routing
 * to the owner's speaker; faded out mid-note once it stopped being due; refused by a speaker the page cannot route to; or
 * failed in the browser's audio, with its message.
 */
export type CueSoundOutcome =
  | { readonly kind: "played" }
  | { readonly kind: "stale"; readonly at: "before-routing" | "after-routing" }
  | { readonly kind: "faded" }
  | { readonly kind: "unroutable" }
  | { readonly kind: "refused"; readonly why: string };

/** Every way a cue's line ends: a decision the cuer took before the player saw it, or the player's outcome. */
export type CueTraceOutcome = Exclude<CueDecision, { readonly kind: "play" }> | CueSoundOutcome;

/** The words for each failed still-due check. */
const STALE_WORDS: Readonly<Record<CueTraceStale, string>> = {
  "badge-moved": "the badge moved on",
  "call-up": "a voice call came up, which says its own time-up line",
  "no-call": "the call was no longer up",
  "not-quiet": "somebody was talking, or no call was up",
  "sound-off": "the owner's sounds were off",
  "sound-changed": "the owner's sound pick changed",
  superseded: "a newer progress event superseded it",
  "work-ended": "the work had ended",
};

/**
 * The words for each signal that says somebody is talking (`./voiceTalking.ts`), so a held or dropped cue names the one
 * that fired rather than "somebody".
 */
const TALKING_WORDS: Readonly<Record<TalkingSignal, string>> = {
  "heard-hold": "the owner was transcribed moments ago",
  "mic-level": "the owner's microphone was loud",
  "output-level": "the voice's output was loud",
  "spoke-hold": "the voice spoke moments ago",
  yielded: "the voice had just stopped for the owner",
};

/**
 * Who was talking, in words, with both levels that sample read to three places — the gated level and the RMS beside
 * it — so a meter reading a quiet room as speech shows its number on the call file.
 *
 * @param talking the signal that fired and the levels it read
 * @returns the reason and its levels
 */
function talkingWords({ talking }: { talking: Talking }): string {
  const mic = `${talking.micLevel.toFixed(3)} rms ${talking.micRms.toFixed(3)}`;
  const output = `${talking.outputLevel.toFixed(3)} rms ${talking.outputRms.toFixed(3)}`;
  let muted = "";
  if (talking.muted) {
    muted = ", muted";
  }
  return `${TALKING_WORDS[talking.signal]} (mic ${mic}, output ${output}${muted})`;
}

/** A cue no longer due with no check named: the latch saw the speaker answer change, or none was known. */
const SPEAKER_WORDS = "the speaker changed, or none was known";

/**
 * The phrase for one outcome.
 *
 * @param outcome what became of the cue
 * @param stale the still-due check it failed, when it went stale
 * @param talking who was talking, when it was held over speech or went stale for it
 * @returns the outcome in words
 */
function outcomeWords({
  outcome,
  stale,
  talking,
}: {
  outcome: CueTraceOutcome;
  stale: CueTraceStale | undefined;
  talking: Talking | undefined;
}): string {
  let why = SPEAKER_WORDS;
  if (stale === "not-quiet" && talking !== undefined) {
    why = talkingWords({ talking });
  } else if (stale !== undefined) {
    why = STALE_WORDS[stale];
  }
  switch (outcome.kind) {
    case "played":
      return "played";
    case "held":
      // No signal named: no call was up, or a reset cleared the signal one sample before the phase it drew.
      if (talking === undefined) {
        return "held: somebody was talking, or no call was up";
      }
      return `held: ${talkingWords({ talking })}`;
    case "throttled":
      if (outcome.why === "gap") {
        return "silent: another cue had just played";
      }
      return "silent: the same cue had just played";
    case "stale":
      return `dropped ${outcome.at.replace("-", " ")}: ${why}`;
    case "faded":
      return `faded mid-note: ${why}`;
    case "unroutable":
      return "dropped: the voice's speaker cannot be routed to from this page";
    case "refused":
      return `dropped: the browser refused it (${outcome.why})`;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * One cue's line for the call file: the cue, where it came from, and what became of it — `refused` for every
 * outcome but played, so a reader filtering the call's tool lines sees the silences first.
 *
 * @param cue an orb cue, or a herald
 * @param source a badge, a progress event, a sample or an announce event
 * @param outcome what became of it
 * @param stale the still-due check it failed, when it went stale or faded
 * @param talking the signal that said somebody was talking and both levels, when it was held or dropped for that
 * @returns the tool line's detail and refused flag
 */
export function cueTraceLine({
  cue,
  source,
  outcome,
  stale,
  talking,
}: {
  cue: CueName;
  source: CueSource;
  outcome: CueTraceOutcome;
  stale: CueTraceStale | undefined;
  talking: Talking | undefined;
}): { readonly detail: string; readonly refused: boolean } {
  const words = outcomeWords({ outcome, stale, talking });
  return { detail: `${cue} (${source}) ${words}`, refused: outcome.kind !== "played" };
}
