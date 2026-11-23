/**
 * The call leg's microphone: a WAV `/usr/bin/say` speaks once, then silence, which Chromium loops as the test
 * instance's only audio input (`--use-file-for-fake-audio-capture`, `./e2eApp.ts`). Run with `execFileSync`, never a
 * shell, so the words are one argument and nothing in them is ever interpreted.
 *
 * The loop's period is a short lead silence, the words, then the silence: room for the voice to answer before it hears
 * the prompt again. 16-bit
 * little-endian PCM at 48 kHz, mono — a format Chromium's WAV reader takes without a codec.
 *
 * **The silence is appended as zero samples, never spoken.** `say`'s own `[[slnc <ms>]]` caps one silence, or a run
 * of adjacent ones, at about 65 seconds and says nothing about it, so a 360-second hold came back as a 66-second file
 * and the call heard its prompt again every minute. A muted word between two silences lifts the cap but leaves a
 * residue the call's voice detection could hear. Repro, each printing `estimated duration: 65.87…`:
 * `say -o /tmp/s.wav --file-format=WAVE --data-format=LEI16@48000 --channels=1 "test [[slnc 360000]]" && afinfo /tmp/s.wav`
 * and the same with `"test [[slnc 60000]] [[slnc 60000]] [[slnc 60000]]"`; with
 * `"test [[slnc 60000]] [[volm 0]] x [[slnc 60000]] x [[slnc 60000]]"` it prints 181.07, and
 * `ffmpeg -ss 2 -i /tmp/s.wav -af volumedetect -f null -` reports `max_volume: -35.0 dB` past the words.
 *
 * **Then a quiet room is laid under the whole file** ({@link withRoomTone}, {@link ROOM_RMS}), so the silence is a
 * room's, which clears the page's spectral microphone bar and not its RMS one, exactly as the owner's does.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { type E2eCallError, E2eCallErrors } from "../../../desktop/e2eCallErrors.js";

/** How long `say` may take to render one prompt to a file. */
const SAY_TIMEOUT_MS = 60_000;

/** The one program run. */
export const SAY = "/usr/bin/say";

/** One run of a program, throwing as `execFileSync` does on a failure or a timeout. */
export type E2eAudioRun = (command: { readonly file: string; readonly args: readonly string[] }) => void;

/**
 * Run a program for real, bounded.
 *
 * @param command the program and its arguments
 */
export const runSay: E2eAudioRun = ({ file, args }) => {
  execFileSync(file, [...args], { stdio: "ignore", timeout: SAY_TIMEOUT_MS });
};

/**
 * The arguments that render the words, and only the words, to a WAV.
 *
 * @param path the WAV to write
 * @param words what is said
 * @returns `say`'s arguments
 */
export function sayArgs({ path, words }: { path: string; words: string }): readonly string[] {
  return ["-o", path, "--file-format=WAVE", "--data-format=LEI16@48000", "--channels=1", words];
}

/**
 * Whether bytes open as a RIFF/WAVE file.
 *
 * @param bytes the file's first bytes, twelve or more
 * @returns whether it is one
 */
export function isWave({ bytes }: { bytes: Uint8Array }): boolean {
  const text = Buffer.from(bytes.subarray(0, 12)).toString("latin1");
  return text.startsWith("RIFF") && text.slice(8, 12) === "WAVE";
}

/** One RIFF chunk: its four-character id, where its body starts, and the body's declared size. */
interface WaveChunk {
  readonly id: string;
  readonly start: number;
  readonly size: number;
}

/**
 * Every chunk of a RIFF/WAVE file, in order, or `undefined` when one runs past the end of the bytes.
 *
 * @param bytes the whole file
 * @returns the chunks
 */
export function waveChunks({ bytes }: { bytes: Buffer }): readonly WaveChunk[] | undefined {
  const chunks: WaveChunk[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("latin1", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const start = at + 8;
    if (start + size > bytes.length) {
      return undefined;
    }
    chunks.push({ id, size, start });
    // A chunk's body is padded to an even length, and the pad byte is not counted in its size.
    at = start + size + (size % 2);
  }
  // Fewer than eight bytes left over is a cut-off chunk header, and carrying it on would leave a broken file. Past the
  // end by one is only a last chunk's missing pad byte.
  if (at < bytes.length) {
    return undefined;
  }
  return chunks;
}

/**
 * The silence BEFORE the words, for every microphone but one whose step names its own (`microphoneLeadMs` in
 * `src/desktop/e2eCallPlan.ts`). Chromium starts reading the file when the page opens the microphone, which is before
 * the call is listening, so the words' opening is lost into that gap — and when a step's silence outlasts its cap the
 * words are heard only once, so it never comes round again. MEASURED: two `card-read` calls each
 * transcribed the prompt from "Tell me, in the card's own terms" on, its first ~7 s of speech (the part
 * naming the card) gone; `slopweaver talk calls --limit 2` shows the first line of the owner's each heard. Twice that.
 */
export const LEAD_SILENCE_MS = 15_000;

/**
 * The frame size and rate of a WAV whose audio is signed 16-bit PCM in whole frames, the one format zero bytes pad as
 * silence. Zero bytes are silence only in signed 16-bit PCM (8-bit PCM is unsigned, silent at 128), a zero rate or
 * block size would pad nothing while still answering a buffer, and audio that is not whole frames would borrow a byte
 * of the padding, so anything else is refused rather than trusted.
 *
 * @param file the whole WAV
 * @param format its `fmt ` chunk, sixteen bytes or more
 * @param data its one `data` chunk
 * @returns the bytes per frame and frames per second, or `undefined` when the audio is not that format
 */
export function signed16BitPcm({
  file,
  format,
  data,
}: {
  file: Buffer;
  format: WaveChunk;
  data: WaveChunk;
}): { readonly blockAlign: number; readonly sampleRate: number } | undefined {
  const audioFormat = file.readUInt16LE(format.start);
  const channels = file.readUInt16LE(format.start + 2);
  const sampleRate = file.readUInt32LE(format.start + 4);
  const blockAlign = file.readUInt16LE(format.start + 12);
  const bitsPerSample = file.readUInt16LE(format.start + 14);
  const isSigned16BitPcm =
    audioFormat === 1 &&
    bitsPerSample === 16 &&
    channels > 0 &&
    blockAlign === channels * 2 &&
    sampleRate > 0 &&
    data.size % blockAlign === 0;
  if (!isSigned16BitPcm) {
    return undefined;
  }
  return { blockAlign, sampleRate };
}

/**
 * The same WAV with `leadMs` of zero samples before its audio and `silenceMs` after, every header size rewritten.
 *
 * @param bytes the whole WAV `say` wrote
 * @param leadMs how long the silence before the words lasts
 * @param silenceMs how long the silence after them lasts
 * @returns the padded file's bytes, or `undefined` when it has no `fmt ` and `data` chunk to pad
 */
export function withSilence({
  bytes,
  leadMs,
  silenceMs,
}: {
  bytes: Uint8Array;
  leadMs: number;
  silenceMs: number;
}): Uint8Array | undefined {
  const file = Buffer.from(bytes);
  // A negative or non-finite length is no silence to pad, and Buffer.alloc would throw on it rather than refuse.
  const lengthsPaddable = [leadMs, silenceMs].every((ms) => Number.isFinite(ms) && ms >= 0);
  if (!lengthsPaddable || !isWave({ bytes: file })) {
    return undefined;
  }
  const chunks = waveChunks({ bytes: file });
  const format = chunks?.find((chunk) => chunk.id === "fmt ");
  // Exactly one audio chunk: with a second, the words could sit after the silence padded into the first.
  const audio = chunks?.filter((chunk) => chunk.id === "data");
  const data = audio?.length === 1 ? audio[0] : undefined;
  if (format === undefined || data === undefined || format.size < 16) {
    return undefined;
  }
  const pcm = signed16BitPcm({ data, file, format });
  if (pcm === undefined) {
    return undefined;
  }
  const { blockAlign, sampleRate } = pcm;
  // Rounded UP to whole frames, so a positive duration never pads nothing however coarse the rate.
  const lead = Math.ceil((sampleRate * leadMs) / 1000) * blockAlign;
  const silence = Math.ceil((sampleRate * silenceMs) / 1000) * blockAlign;
  const size = lead + data.size + silence;
  // RIFF sizes are 32-bit: a file whose padded size would not fit is refused before anything is allocated. A size
  // that fits but exceeds the memory Buffer.alloc can get still throws; the call scenario asks for minutes, tens of
  // megabytes, and a try around the allocation is what would turn that into a refusal.
  const riffSize = file.length - 8 - (data.size + (data.size % 2)) + size + (size % 2);
  if (riffSize > 0xff_ff_ff_ff) {
    return undefined;
  }
  const header = Buffer.alloc(8);
  header.write("data", 0, "latin1");
  header.writeUInt32LE(size, 4);
  const padded = Buffer.concat([
    file.subarray(0, data.start - 8),
    header,
    Buffer.alloc(lead),
    file.subarray(data.start, data.start + data.size),
    Buffer.alloc(silence + (size % 2)),
    file.subarray(data.start + data.size + (data.size % 2)),
  ]);
  padded.writeUInt32LE(padded.length - 8, 4);
  return padded;
}

/**
 * The waveform RMS of the quiet room laid under every sample the fake microphone plays, so its silence is a room's and
 * never digital zero, which no real microphone produces. Zero silence reads 0 on both of the page's microphone bars, so
 * an end-to-end call could never tell a decision that reads the spectral level alone from one that reads both: a call
 * once slept under ZZZ through the owner's quiet room, which the e2e leg's zeros could not reproduce. That
 * room read an RMS near 0.005 and spectral 0.07 to 0.47; white noise at this RMS lands near 0.44 on the page's
 * 64-point analyser before Chromium's noise suppression. Repro, from the home:
 * `grep -o '(mic [0-9.]* rms [0-9.]*' talk/calls/281228ba-*.jsonl | sort | uniq -c`
 */
export const ROOM_RMS = 0.005;

/** The largest magnitude a signed 16-bit sample holds. */
const INT16_MAX = 32_767;

/**
 * A fixed-seed generator of uniform numbers in [0, 1), so the same WAV is written on every run (mulberry32).
 *
 * @param seed where the sequence starts
 * @returns the next number on each call
 */
function seededUniform({ seed }: { seed: number }): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * The same WAV with a quiet room's white noise, at `rms` of full scale, added to every sample of its audio, clipped to
 * the 16-bit range. The noise is the same on every run.
 *
 * @param bytes a signed 16-bit PCM WAV, as {@link withSilence} returns it
 * @param rms the noise's waveform RMS as a fraction of full scale, 0 to 1
 * @returns the file with the room under it, or `undefined` when it is not that format or `rms` is out of range
 */
export function withRoomTone({ bytes, rms }: { bytes: Uint8Array; rms: number }): Uint8Array | undefined {
  const file = Buffer.from(bytes);
  if (!Number.isFinite(rms) || rms < 0 || rms > 1 || !isWave({ bytes: file })) {
    return undefined;
  }
  const chunks = waveChunks({ bytes: file });
  const format = chunks?.find((chunk) => chunk.id === "fmt ");
  const audio = chunks?.filter((chunk) => chunk.id === "data");
  const data = audio?.length === 1 ? audio[0] : undefined;
  if (format === undefined || data === undefined || format.size < 16) {
    return undefined;
  }
  if (signed16BitPcm({ data, file, format }) === undefined) {
    return undefined;
  }
  // Uniform noise on [-a, a] has an RMS of a / sqrt(3).
  const amplitude = rms * INT16_MAX * Math.sqrt(3);
  const next = seededUniform({ seed: 281_228 });
  for (let at = data.start; at < data.start + data.size; at += 2) {
    const noisy = file.readInt16LE(at) + Math.round((next() * 2 - 1) * amplitude);
    file.writeInt16LE(Math.max(-INT16_MAX - 1, Math.min(INT16_MAX, noisy)), at);
  }
  return file;
}

/** A WAV's one `fmt ` and one `data` chunk, when its audio is signed 16-bit PCM in whole frames. */
interface PcmWave {
  readonly file: Buffer;
  readonly format: WaveChunk;
  readonly data: WaveChunk;
}

/**
 * A WAV's audio, or `undefined` when it is not one signed 16-bit PCM `data` chunk under a whole `fmt ` chunk.
 *
 * @param bytes the whole WAV
 * @returns its chunks
 */
function pcmWave({ bytes }: { bytes: Uint8Array }): PcmWave | undefined {
  const file = Buffer.from(bytes);
  if (!isWave({ bytes: file })) {
    return undefined;
  }
  const chunks = waveChunks({ bytes: file });
  const format = chunks?.find((chunk) => chunk.id === "fmt ");
  const audio = chunks?.filter((chunk) => chunk.id === "data");
  const data = audio?.length === 1 ? audio[0] : undefined;
  if (format === undefined || data === undefined || format.size < 16) {
    return undefined;
  }
  if (signed16BitPcm({ data, file, format }) === undefined) {
    return undefined;
  }
  return { data, file, format };
}

/**
 * How long a WAV plays: its audio bytes over the `fmt ` chunk's byte rate.
 *
 * @param bytes a signed 16-bit PCM WAV
 * @returns its length in milliseconds, or `undefined` when it is not that format
 */
export function waveDurationMs({ bytes }: { bytes: Uint8Array }): number | undefined {
  const wave = pcmWave({ bytes });
  if (wave === undefined) {
    return undefined;
  }
  const byteRate = wave.file.readUInt32LE(wave.format.start + 8);
  return byteRate === 0 ? undefined : (wave.data.size / byteRate) * 1000;
}

/**
 * The same WAV with every sample multiplied by `factor`, rounded and clipped to the 16-bit range — how a line is made
 * quieter than `say` speaks it.
 *
 * @param bytes a signed 16-bit PCM WAV
 * @param factor the scale, 0 to 1
 * @returns the scaled file, or `undefined` when it is not that format or `factor` is out of range
 */
export function withGain({ bytes, factor }: { bytes: Uint8Array; factor: number }): Uint8Array | undefined {
  const wave = Number.isFinite(factor) && factor >= 0 && factor <= 1 ? pcmWave({ bytes }) : undefined;
  if (wave === undefined) {
    return undefined;
  }
  const { data, file } = wave;
  for (let at = data.start; at < data.start + data.size; at += 2) {
    const scaled = Math.round(file.readInt16LE(at) * factor);
    file.writeInt16LE(Math.max(-INT16_MAX - 1, Math.min(INT16_MAX, scaled)), at);
  }
  return file;
}

/**
 * One WAV holding every given WAV's audio in order, under the first one's `fmt ` chunk. Any other chunk is dropped.
 *
 * @param waves signed 16-bit PCM WAVs, one or more, every `fmt ` chunk byte-identical
 * @returns the joined file, or `undefined` when there is none, one is not that format, or their formats differ
 */
export function concatenatePcmWaves({ waves }: { waves: readonly Uint8Array[] }): Uint8Array | undefined {
  const parsed = waves.map((bytes) => pcmWave({ bytes }));
  const first = parsed[0];
  if (first === undefined) {
    return undefined;
  }
  const formatOf = ({ wave }: { wave: PcmWave }): Buffer =>
    wave.file.subarray(wave.format.start, wave.format.start + wave.format.size);
  const format = formatOf({ wave: first });
  const sameFormat = parsed.every((wave) => wave !== undefined && formatOf({ wave }).equals(format));
  if (!sameFormat) {
    return undefined;
  }
  const audio = parsed.map((wave) => wave!.file.subarray(wave!.data.start, wave!.data.start + wave!.data.size));
  const size = audio.reduce((sum, one) => sum + one.length, 0);
  // RIFF size: "WAVE", the fmt chunk's header, body and pad, the data chunk's header, body and pad.
  const riffSize = 4 + 8 + format.length + (format.length % 2) + 8 + size + (size % 2);
  if (riffSize > 0xff_ff_ff_ff) {
    return undefined;
  }
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVE", 8, "latin1");
  const chunkHeader = ({ id, length }: { id: string; length: number }): Buffer => {
    const bytes = Buffer.alloc(8);
    bytes.write(id, 0, "latin1");
    bytes.writeUInt32LE(length, 4);
    return bytes;
  };
  return Buffer.concat([
    header,
    chunkHeader({ id: "fmt ", length: format.length }),
    format,
    Buffer.alloc(format.length % 2),
    chunkHeader({ id: "data", length: size }),
    ...audio,
    Buffer.alloc(size % 2),
  ]);
}

/**
 * Write the fake microphone's WAV and check it is one.
 *
 * @param path where it goes
 * @param words what it says
 * @param leadMs the silence before the words, {@link LEAD_SILENCE_MS} unless the step names its own
 * @param silenceMs the silence after the words
 * @param run the program runner, {@link runSay} in production
 * @returns nothing once a valid WAV is on disk, else why not
 */
export function generateFakeMicrophone({
  path,
  words,
  leadMs,
  silenceMs,
  run,
}: {
  path: string;
  words: string;
  leadMs: number;
  silenceMs: number;
  run: E2eAudioRun;
}): Result<void, E2eCallError> {
  try {
    run({ args: sayArgs({ path, words }), file: SAY });
  } catch (cause) {
    return err(E2eCallErrors.audioSynthesisFailed({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch (cause) {
    return err(E2eCallErrors.audioSynthesisFailed({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  const silent = withSilence({ bytes, leadMs, silenceMs });
  const padded = silent === undefined ? undefined : withRoomTone({ bytes: silent, rms: ROOM_RMS });
  if (padded === undefined) {
    return err(E2eCallErrors.audioInvalid({ path }));
  }
  try {
    writeFileSync(path, padded);
  } catch (cause) {
    return err(E2eCallErrors.audioSynthesisFailed({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  return ok(undefined);
}
