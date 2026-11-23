/**
 * The `transcription-fidelity` scenario's microphone: every line of the versioned script
 * (`../../../desktop/e2eTranscriptFidelityCorpus.ts`) rendered by `say` in ONE pinned voice and rate, scaled to its
 * gain, separated by its silence, joined into one WAV with one quiet room laid under the whole of it. The file's
 * sha256 goes in the report, so two calls compared against each other are proven to have heard the same bytes.
 *
 * **The voice is checked, because `say` will not check it.** Asked for a voice that is not installed, `say` speaks in
 * the system default and exits 0, so a machine missing it would silently compare a different speaker. Repro, exiting
 * 0 with a playable file: `/usr/bin/say -v NoSuchVoiceAcme -o /tmp/novoice.aiff test`. `say -v '?'` lists what is
 * installed, and the scenario refuses before launching anything when the pinned voice is not in it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import {
  type E2eTranscriptCorpus,
  FIDELITY_LEAD_MS,
  GAIN_FACTOR,
  TRANSCRIPT_FIDELITY_CORPUS,
} from "../../../desktop/e2eTranscriptFidelityCorpus.js";
import {
  concatenatePcmWaves,
  type E2eAudioRun,
  ROOM_RMS,
  SAY,
  sayArgs,
  waveDurationMs,
  withGain,
  withRoomTone,
  withSilence,
} from "./e2eCallAudio.js";

/** The one voice every fidelity call speaks in: installed with macOS's English (US) set, on this machine measured. */
const FIDELITY_VOICE = "Samantha";

/** Words per minute: `say`'s own default pace, pinned so a system setting cannot change it between calls. */
const FIDELITY_RATE = 175;

/** How long listing the installed voices may take. */
const LIST_TIMEOUT_MS = 30_000;

/** The installed voices' listing, as `say -v '?'` prints it. */
export type E2eVoiceList = () => string;

/**
 * List the installed voices for real, bounded.
 *
 * @returns `say -v '?'`'s output
 */
export const listSayVoices: E2eVoiceList = () =>
  execFileSync(SAY, ["-v", "?"], { encoding: "utf8", timeout: LIST_TIMEOUT_MS });

/**
 * Whether a voice is installed, read from `say -v '?'`'s listing: one voice per line, its name first, then spaces.
 *
 * @param listing `say -v ?` output, one installed voice per line
 * @param voice the voice's exact name
 * @returns whether a line names it
 */
export function voiceListed({ listing, voice }: { listing: string; voice: string }): boolean {
  return listing.split("\n").some((line) => line.startsWith(`${voice} `));
}

/**
 * The arguments that render one line in the pinned voice and rate.
 *
 * @param path the WAV to write
 * @param words the line
 * @returns `say`'s arguments
 */
export function fidelitySayArgs({ path, words }: { path: string; words: string }): readonly string[] {
  return ["-v", FIDELITY_VOICE, "-r", String(FIDELITY_RATE), ...sayArgs({ path, words })];
}

/** What the scenario records about the microphone it played. */
export interface FidelityMicrophone {
  readonly corpusVersion: E2eTranscriptCorpus["version"];
  readonly voice: string;
  readonly rate: number;
  readonly sha256: string;
  /** When the last line finishes speaking, from the file's first byte: the lead, every line and every gap but the tail. */
  readonly scriptEndMs: number;
}

/**
 * The failure every step below reports, from whatever it threw.
 *
 * @param cause what was thrown
 * @returns the error
 */
function synthesisFailed({ cause }: { cause: unknown }): E2eCallError {
  return E2eCallErrors.audioSynthesisFailed({ detail: cause instanceof Error ? cause.message : String(cause) });
}

/**
 * One line, spoken, scaled and padded with its silence.
 *
 * @param path where its clip is written
 * @param index its place in the script; only the first carries the lead silence
 * @returns the clip's bytes, or why not
 */
function renderLine({
  index,
  path,
  run,
}: {
  index: number;
  path: string;
  run: E2eAudioRun;
}): Result<Uint8Array, E2eCallError> {
  const line = TRANSCRIPT_FIDELITY_CORPUS.utterances[index]!;
  try {
    run({ args: fidelitySayArgs({ path, words: line.text }), file: SAY });
  } catch (cause) {
    return err(synthesisFailed({ cause }));
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    return err(synthesisFailed({ cause }));
  }
  const scaled = withGain({ bytes, factor: GAIN_FACTOR[line.gain] });
  let leadMs = 0;
  if (index === 0) {
    leadMs = FIDELITY_LEAD_MS;
  }
  const padded =
    scaled === undefined ? undefined : withSilence({ bytes: scaled, leadMs, silenceMs: line.silenceAfterMs });
  if (padded === undefined) {
    return err(E2eCallErrors.audioInvalid({ path }));
  }
  return ok(padded);
}

/**
 * Write the fidelity microphone's WAV: the pinned voice checked, every line rendered into `scratch`, the whole joined
 * at `path` with the room under it.
 *
 * @param path where the microphone goes
 * @param scratch the folder each line's clip is written into
 * @param run the program runner, `runSay` in production
 * @param listVoices the installed voices' listing, {@link listSayVoices} in production
 * @returns what was played, or why it could not be written
 */
export function generateTranscriptFidelityMicrophone({
  listVoices,
  path,
  run,
  scratch,
}: {
  listVoices: E2eVoiceList;
  path: string;
  run: E2eAudioRun;
  scratch: string;
}): Result<FidelityMicrophone, E2eCallError> {
  let listing: string;
  try {
    listing = listVoices();
  } catch (cause) {
    return err(synthesisFailed({ cause }));
  }
  if (!voiceListed({ listing, voice: FIDELITY_VOICE })) {
    return err(
      E2eCallErrors.audioSynthesisFailed({
        detail: `the pinned voice ${FIDELITY_VOICE} is not installed, and say would silently speak another — install it in System Settings › Accessibility › Spoken Content`,
      }),
    );
  }
  const clips: Uint8Array[] = [];
  for (const [index, line] of TRANSCRIPT_FIDELITY_CORPUS.utterances.entries()) {
    const clip = renderLine({ index, path: join(scratch, `fidelity-${index}-${line.id}.wav`), run });
    if (clip.isErr()) {
      return err(clip.error);
    }
    clips.push(clip.value);
  }
  const joined = concatenatePcmWaves({ waves: clips });
  const roomed = joined === undefined ? undefined : withRoomTone({ bytes: joined, rms: ROOM_RMS });
  const playsMs = roomed === undefined ? undefined : waveDurationMs({ bytes: roomed });
  if (roomed === undefined || playsMs === undefined) {
    return err(E2eCallErrors.audioInvalid({ path }));
  }
  try {
    writeFileSync(path, roomed);
  } catch (cause) {
    return err(synthesisFailed({ cause }));
  }
  return ok({
    corpusVersion: TRANSCRIPT_FIDELITY_CORPUS.version,
    rate: FIDELITY_RATE,
    scriptEndMs: playsMs - TRANSCRIPT_FIDELITY_CORPUS.utterances.at(-1)!.silenceAfterMs,
    sha256: createHash("sha256").update(roomed).digest("hex"),
    voice: FIDELITY_VOICE,
  });
}
