/**
 * The call leg's microphones beyond the one-saying prompt `./e2eCallAudio.ts` renders: a quiet room the owner says nothing
 * into, and words tiled from the first sample the owner speaks at once with — the two a reopened call is proven on
 * (`./e2eCallReopenScenario.ts`). Every file still has a quiet room laid under it ({@link withRoomTone}).
 */
import { readFileSync, writeFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";
import {
  type E2eAudioRun,
  generateFakeMicrophone,
  isWave,
  LEAD_SILENCE_MS,
  ROOM_RMS,
  SAY,
  sayArgs,
  signed16BitPcm,
  waveChunks,
  withRoomTone,
} from "./e2eCallAudio.js";

/** The rate every WAV this module builds itself is written at, the same as `say`'s ({@link sayArgs}). */
const BUILT_RATE = 48_000;

/**
 * A WAV of one `fmt ` chunk and one `data` chunk.
 *
 * @param format the `fmt ` chunk's body, sixteen bytes or more
 * @param samples the audio
 * @returns the file's bytes
 */
function waveOf({ format, samples }: { format: Buffer; samples: Buffer }): Uint8Array {
  const chunk = ({ id, body }: { id: string; body: Buffer }): Buffer => {
    const header = Buffer.alloc(8);
    header.write(id, 0, "latin1");
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
  };
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    chunk({ body: format, id: "fmt " }),
    chunk({ body: samples, id: "data" }),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/**
 * A mono signed 16-bit PCM WAV of digital silence, for {@link withRoomTone} to lay a room under: the microphone of a
 * reopened call the owner stays silent on, which no `say` can render (`say ""` writes nothing).
 *
 * @param ms how long it lasts
 * @returns the file's bytes, or `undefined` for a length that is not a positive finite number
 */
export function silentWave({ ms }: { ms: number }): Uint8Array | undefined {
  if (!Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(BUILT_RATE, 4);
  format.writeUInt32LE(BUILT_RATE * 2, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  return waveOf({ format, samples: Buffer.alloc(Math.ceil((BUILT_RATE * ms) / 1000) * 2) });
}

/**
 * The same words said over and over with `gapMs` of silence between, from the file's first sample and for at least
 * `totalMs`: a microphone that is heard within one saying of WHENEVER the call starts listening. The 15-second lead
 * (`LEAD_SILENCE_MS` in `./e2eCallAudio.ts`) is there because Chromium starts reading the file before the call
 * listens, so a single saying lands at a moment no scenario controls; a reopened call the owner speaks into at once must be
 * heard inside its first three seconds, so the words are tiled instead. The gap is past a breath (`OWNER_GAP_MS` in
 * `site/lib/voiceTurnTaking.ts`, 400 ms), so each saying is a turn of the owner's the voice can answer.
 *
 * @param bytes a signed 16-bit PCM WAV holding the words once, as `say` writes it
 * @param gapMs the silence after each saying
 * @param totalMs the least the file lasts
 * @returns the tiled file's bytes, or `undefined` when it is not that format or a length is out of range
 */
export function tiledWave({
  bytes,
  gapMs,
  totalMs,
}: {
  bytes: Uint8Array;
  gapMs: number;
  totalMs: number;
}): Uint8Array | undefined {
  const file = Buffer.from(bytes);
  const lengthsTileable = Number.isFinite(gapMs) && gapMs >= 0 && Number.isFinite(totalMs) && totalMs > 0;
  if (!lengthsTileable || !isWave({ bytes: file })) {
    return undefined;
  }
  const chunks = waveChunks({ bytes: file });
  const format = chunks?.find((chunk) => chunk.id === "fmt ");
  const audio = chunks?.filter((chunk) => chunk.id === "data");
  const data = audio?.length === 1 ? audio[0] : undefined;
  if (format === undefined || data === undefined || format.size < 16 || data.size === 0) {
    return undefined;
  }
  const pcm = signed16BitPcm({ data, file, format });
  if (pcm === undefined) {
    return undefined;
  }
  const saying = file.subarray(data.start, data.start + data.size);
  const gap = Buffer.alloc(Math.ceil((pcm.sampleRate * gapMs) / 1000) * pcm.blockAlign);
  const total = Math.ceil((pcm.sampleRate * totalMs) / 1000) * pcm.blockAlign;
  const period = saying.length + gap.length;
  const parts: Buffer[] = [];
  for (let written = 0; written < total; written += period) {
    parts.push(saying, gap);
  }
  return waveOf({ format: file.subarray(format.start, format.start + format.size), samples: Buffer.concat(parts) });
}

/** What one of the call leg's microphones plays. */
export type E2eMicrophone =
  /** The words once, after the 15-second lead, then `silenceMs` of quiet: every scenario's own microphone. */
  | { readonly kind: "once"; readonly words: string; readonly silenceMs: number }
  /** A quiet room and nothing else, for `ms`, looped: the owner reopened the call and says nothing. */
  | { readonly kind: "room"; readonly ms: number }
  /** The words tiled from the first sample ({@link tiledWave}): the owner reopened the call and speaks at once. */
  | { readonly kind: "tiled"; readonly words: string; readonly gapMs: number; readonly totalMs: number };

/**
 * Render `say`'s words into a WAV at a path and read it back.
 *
 * @returns the bytes, or why not
 */
function sayInto({
  path,
  words,
  run,
}: {
  path: string;
  words: string;
  run: E2eAudioRun;
}): Result<Uint8Array, E2eCallError> {
  try {
    run({ args: sayArgs({ path, words }), file: SAY });
    return ok(readFileSync(path));
  } catch (cause) {
    return err(E2eCallErrors.audioSynthesisFailed({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
}

/**
 * Write one of the call leg's microphones, a quiet room laid under all of it ({@link ROOM_RMS}), and check it is a WAV.
 *
 * @param path where it goes
 * @param microphone what it plays
 * @param run the program runner, `runSay` in production
 * @returns nothing once a valid WAV is on disk, else why not
 */
export function generateMicrophone({
  path,
  microphone,
  run,
}: {
  path: string;
  microphone: E2eMicrophone;
  run: E2eAudioRun;
}): Result<void, E2eCallError> {
  if (microphone.kind === "once") {
    return generateFakeMicrophone({
      leadMs: LEAD_SILENCE_MS,
      path,
      run,
      silenceMs: microphone.silenceMs,
      words: microphone.words,
    });
  }
  let quiet: Uint8Array | undefined;
  if (microphone.kind === "room") {
    quiet = silentWave({ ms: microphone.ms });
  } else {
    const said = sayInto({ path, run, words: microphone.words });
    if (said.isErr()) {
      return err(said.error);
    }
    quiet = tiledWave({ bytes: said.value, gapMs: microphone.gapMs, totalMs: microphone.totalMs });
  }
  const roomed = quiet === undefined ? undefined : withRoomTone({ bytes: quiet, rms: ROOM_RMS });
  if (roomed === undefined) {
    return err(E2eCallErrors.audioInvalid({ path }));
  }
  try {
    writeFileSync(path, roomed);
  } catch (cause) {
    return err(E2eCallErrors.audioSynthesisFailed({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  return ok(undefined);
}
