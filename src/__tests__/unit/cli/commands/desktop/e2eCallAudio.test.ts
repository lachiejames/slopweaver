import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  type E2eAudioRun,
  ROOM_RMS,
  withRoomTone,
  withSilence,
} from "../../../../../cli/commands/desktop/e2eCallAudio.js";
import { generateMicrophone, silentWave, tiledWave } from "../../../../../cli/commands/desktop/e2eCallMicrophone.js";
import { E2eCallErrors } from "../../../../../desktop/e2eCallErrors.js";
import { unwrapErr } from "../../../../../lib/result.js";

/**
 * One RIFF chunk's bytes: its id, its size, its body and the pad byte an odd body carries.
 *
 * @param id the four-character id
 * @param body the chunk's body
 * @returns the chunk
 */
function chunk({ id, body }: { id: string; body: Buffer }): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, "latin1");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body, Buffer.alloc(body.length % 2)]);
}

/**
 * A mono 16-bit PCM WAV at 1 kHz, shaped as `say` writes one — `fmt `, an odd-sized `FLLR`, `data` — plus a
 * trailing chunk, so a pad that assumed `data` was last would be caught.
 *
 * @param samples the audio's bytes
 * @returns the whole file
 */
function wave({ samples }: { samples: Buffer }): Buffer {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(1000, 4);
  format.writeUInt32LE(2000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    chunk({ body: format, id: "fmt " }),
    chunk({ body: Buffer.from([0, 0, 0]), id: "FLLR" }),
    chunk({ body: samples, id: "data" }),
    chunk({ body: Buffer.from("tail", "latin1"), id: "LIST" }),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

describe("withSilence", () => {
  it("appends exactly the asked silence as zero samples and rewrites both sizes", () => {
    const samples = Buffer.from([1, 2, 3, 4]);
    const padded = Buffer.from(withSilence({ bytes: wave({ samples }), leadMs: 0, silenceMs: 10 })!);
    // 10 ms at 1 kHz is 10 samples of 2 bytes each.
    expect(padded.length).toBe(wave({ samples }).length + 20);
    expect(padded.readUInt32LE(4)).toBe(padded.length - 8);
    const dataAt = padded.indexOf("data", 12, "latin1");
    expect(padded.readUInt32LE(dataAt + 4)).toBe(24);
    expect([...padded.subarray(dataAt + 8, dataAt + 32)]).toEqual([1, 2, 3, 4, ...Array.from({ length: 20 }, () => 0)]);
    expect(padded.subarray(dataAt + 32).toString("latin1")).toBe("LIST\u0004\u0000\u0000\u0000tail");
  });

  it("puts the lead silence before the words and the rest after them", () => {
    const padded = Buffer.from(
      withSilence({ bytes: wave({ samples: Buffer.from([7, 7]) }), leadMs: 2, silenceMs: 1 })!,
    );
    const dataAt = padded.indexOf("data", 12, "latin1");
    expect(padded.readUInt32LE(dataAt + 4)).toBe(8);
    expect([...padded.subarray(dataAt + 8, dataAt + 16)]).toEqual([0, 0, 0, 0, 7, 7, 0, 0]);
    expect(padded.readUInt32LE(4)).toBe(padded.length - 8);
  });

  it("leaves the audio as it was when no silence is asked", () => {
    const original = wave({ samples: Buffer.from([9, 9]) });
    expect(Buffer.from(withSilence({ bytes: original, leadMs: 0, silenceMs: 0 })!).equals(original)).toBe(true);
  });

  it("refuses bytes that are not a WAVE", () => {
    const bytes = Buffer.from("not audio at all", "latin1");
    expect(withSilence({ bytes, leadMs: 0, silenceMs: 1000 })).toBe(undefined);
  });

  it("refuses a WAVE with no audio chunk", () => {
    const noData = Buffer.from("RIFF\u0004\u0000\u0000\u0000WAVE", "latin1");
    expect(withSilence({ bytes: noData, leadMs: 0, silenceMs: 1000 })).toBe(undefined);
  });

  it("refuses a WAVE ending in a cut-off chunk header", () => {
    const trailing = Buffer.concat([wave({ samples: Buffer.from([1, 2]) }), Buffer.from("LIS", "latin1")]);
    expect(withSilence({ bytes: trailing, leadMs: 0, silenceMs: 1000 })).toBe(undefined);
  });

  it("refuses a WAVE whose chunk runs past the end of the file", () => {
    // The `data` body starts at byte 56 and declares 4 bytes; cut two of them off.
    const truncated = wave({ samples: Buffer.from([1, 2, 3, 4]) }).subarray(0, 58);
    expect(withSilence({ bytes: truncated, leadMs: 0, silenceMs: 1000 })).toBe(undefined);
  });

  it("pads at least one frame for any positive duration, however coarse the rate", () => {
    const coarse = wave({ samples: Buffer.from([7, 7]) });
    // The `fmt ` rate field sits at byte 24: 1 Hz makes 1 ms a fraction of a frame.
    coarse.writeUInt32LE(1, 24);
    const padded = Buffer.from(withSilence({ bytes: coarse, leadMs: 1, silenceMs: 1 })!);
    const dataAt = padded.indexOf("data", 12, "latin1");
    expect([...padded.subarray(dataAt + 4, dataAt + 14)]).toEqual([6, 0, 0, 0, 0, 0, 7, 7, 0, 0]);
  });

  it("refuses audio that is not a whole number of frames", () => {
    expect(withSilence({ bytes: wave({ samples: Buffer.from([0x7f]) }), leadMs: 0, silenceMs: 1 })).toBe(undefined);
  });

  it("refuses a negative, non-finite or oversized silence rather than throwing on it", () => {
    const bytes = wave({ samples: Buffer.from([1, 2]) });
    expect([
      withSilence({ bytes, leadMs: 0, silenceMs: -1 }),
      withSilence({ bytes, leadMs: -1, silenceMs: 0 }),
      withSilence({ bytes, leadMs: 0, silenceMs: Number.NaN }),
      withSilence({ bytes, leadMs: Number.POSITIVE_INFINITY, silenceMs: 0 }),
      // At 1 kHz mono 16-bit, 2^31 ms of silence is 2^32 bytes: past what a 32-bit RIFF size can hold.
      withSilence({ bytes, leadMs: 0, silenceMs: 2 ** 31 }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses a WAVE with a second audio chunk, whose words would follow the padded silence", () => {
    const one = wave({ samples: Buffer.from([1, 2]) });
    const extra = chunk({ body: Buffer.from([5, 5]), id: "data" });
    const two = Buffer.concat([one, extra]);
    two.writeUInt32LE(two.length - 8, 4);
    expect(withSilence({ bytes: two, leadMs: 0, silenceMs: 1 })).toBe(undefined);
  });

  it("refuses a format whose zero bytes are not silence, or whose padding would come to nothing", () => {
    // The `fmt ` body starts at byte 20: format tag, channels, rate, byte rate, block align, bits per sample.
    const patched = ({ at, value, wide }: { at: number; value: number; wide: boolean }): Buffer => {
      const bytes = wave({ samples: Buffer.from([1, 2]) });
      if (wide) {
        bytes.writeUInt32LE(value, at);
        return bytes;
      }
      bytes.writeUInt16LE(value, at);
      return bytes;
    };
    const refused = [
      patched({ at: 20, value: 3, wide: false }),
      patched({ at: 22, value: 0, wide: false }),
      patched({ at: 24, value: 0, wide: true }),
      patched({ at: 32, value: 0, wide: false }),
      patched({ at: 34, value: 8, wide: false }),
    ].map((bytes) => withSilence({ bytes, leadMs: 1000, silenceMs: 1000 }));
    expect(refused).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

/**
 * Every 16-bit sample of a WAV's one `data` chunk, as full-scale fractions.
 *
 * @param bytes the whole file
 * @returns the samples
 */
function samplesOf({ bytes }: { bytes: Uint8Array }): readonly number[] {
  const file = Buffer.from(bytes);
  const dataAt = file.indexOf("data", 12, "latin1");
  const size = file.readUInt32LE(dataAt + 4);
  return Array.from({ length: size / 2 }, (_, index) => file.readInt16LE(dataAt + 8 + index * 2) / 32_767);
}

describe("withRoomTone", () => {
  // A quiet room read an RMS near 0.005: `grep -o '(mic [0-9.]* rms [0-9.]*' talk/calls/<call-id>-*.jsonl`.
  it("lays a quiet room at the asked RMS under digital silence, the same on every run", () => {
    const silent = wave({ samples: Buffer.alloc(20_000) });
    const roomed = withRoomTone({ bytes: silent, rms: ROOM_RMS })!;
    const samples = samplesOf({ bytes: roomed });
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    expect(ROOM_RMS).toBe(0.005);
    expect(samples.length).toBe(10_000);
    expect(rms).toBeCloseTo(0.005, 4);
    expect(Buffer.from(withRoomTone({ bytes: silent, rms: ROOM_RMS })!).equals(Buffer.from(roomed))).toBe(true);
  });

  it("changes only the audio, never a header or another chunk", () => {
    const original = wave({ samples: Buffer.alloc(8) });
    const roomed = Buffer.from(withRoomTone({ bytes: original, rms: 0.5 })!);
    const dataAt = original.indexOf("data", 12, "latin1");
    expect(roomed.length).toBe(original.length);
    expect(roomed.subarray(0, dataAt + 8).equals(original.subarray(0, dataAt + 8))).toBe(true);
    expect(roomed.subarray(dataAt + 16).equals(original.subarray(dataAt + 16))).toBe(true);
    expect(roomed.subarray(dataAt + 8, dataAt + 16).equals(original.subarray(dataAt + 8, dataAt + 16))).toBe(false);
  });

  it("clips at full scale rather than wrapping a loud sample round to a quiet one", () => {
    const loud = Buffer.alloc(200);
    for (let at = 0; at < loud.length; at += 2) {
      loud.writeInt16LE(32_767, at);
    }
    const samples = samplesOf({ bytes: withRoomTone({ bytes: wave({ samples: loud }), rms: 0.1 })! });
    expect(Math.max(...samples)).toBe(1);
    expect(Math.min(...samples)).toBeGreaterThan(0.5);
  });

  it("leaves the audio as it was at an RMS of zero", () => {
    const original = wave({ samples: Buffer.from([1, 2, 3, 4]) });
    expect(Buffer.from(withRoomTone({ bytes: original, rms: 0 })!).equals(original)).toBe(true);
  });

  it("refuses an RMS outside 0 to 1, and bytes that are not a 16-bit PCM WAVE", () => {
    const original = wave({ samples: Buffer.alloc(4) });
    const eightBit = Buffer.from(original);
    eightBit.writeUInt16LE(8, 34);
    expect([
      withRoomTone({ bytes: original, rms: -0.1 }),
      withRoomTone({ bytes: original, rms: 1.5 }),
      withRoomTone({ bytes: original, rms: Number.NaN }),
      withRoomTone({ bytes: Buffer.from("not a wave at all"), rms: ROOM_RMS }),
      withRoomTone({ bytes: eightBit, rms: ROOM_RMS }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

/**
 * The waveform RMS of a run of samples.
 *
 * @returns the RMS, 0 to 1
 */
function rmsOf({ samples }: { samples: readonly number[] }): number {
  return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
}

/**
 * The page's bar for the owner's microphone carrying them, loaded at run time: `src` cannot import `site/` statically.
 *
 * @returns `HEARING_RMS`
 */
async function hearingRms(): Promise<number> {
  const module = (await import(
    fileURLToPath(new URL("../../../../../../site/lib/micAudible.ts", import.meta.url))
  )) as Record<string, unknown>;
  return module["HEARING_RMS"] as number;
}

describe("silentWave", () => {
  it("is mono 16-bit PCM at 48 kHz of exactly the asked length, all zero", () => {
    const file = Buffer.from(silentWave({ ms: 250 })!);
    expect(file.toString("latin1", 0, 4)).toBe("RIFF");
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
    expect(file.readUInt32LE(24)).toBe(48_000);
    expect(samplesOf({ bytes: file }).length).toBe(12_000);
    expect(samplesOf({ bytes: file }).every((sample) => sample === 0)).toBe(true);
  });

  it("refuses a length that is not positive and finite", () => {
    expect([silentWave({ ms: 0 }), silentWave({ ms: -1 }), silentWave({ ms: Number.NaN })]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("with a room laid under it never clears the page's bar for the owner talking, so a silent reopen stays silent", async () => {
    const roomed = withRoomTone({ bytes: silentWave({ ms: 1000 })!, rms: ROOM_RMS })!;
    const bar = await hearingRms();
    expect(bar).toBe(0.02);
    expect(rmsOf({ samples: samplesOf({ bytes: roomed }) })).toBeLessThan(bar);
  });
});

describe("tiledWave", () => {
  // Four samples of "words" at 1 kHz: 4 ms of saying.
  const words = Buffer.alloc(8);
  for (let at = 0; at < words.length; at += 2) {
    words.writeInt16LE(16_000, at);
  }

  it("says the words from the first sample, a gap after each, until at least the asked length", () => {
    const samples = samplesOf({ bytes: tiledWave({ bytes: wave({ samples: words }), gapMs: 3, totalMs: 12 })! });
    const said = 16_000 / 32_767;
    // Two periods of 4 + 3 samples reach 12: 14 samples.
    expect(samples).toEqual([said, said, said, said, 0, 0, 0, said, said, said, said, 0, 0, 0]);
  });

  it("keeps only the audio and its format, so no other chunk is tiled into it", () => {
    const file = Buffer.from(tiledWave({ bytes: wave({ samples: words }), gapMs: 0, totalMs: 4 })!);
    expect(file.indexOf("LIST", 12, "latin1")).toBe(-1);
    expect(file.indexOf("FLLR", 12, "latin1")).toBe(-1);
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
  });

  it("tiled words over a quiet room clear the page's bar for the owner talking in every saying", async () => {
    const tiled = tiledWave({ bytes: wave({ samples: words }), gapMs: 3, totalMs: 12 })!;
    const samples = samplesOf({ bytes: withRoomTone({ bytes: tiled, rms: ROOM_RMS })! });
    const bar = await hearingRms();
    expect(
      [rmsOf({ samples: samples.slice(0, 4) }), rmsOf({ samples: samples.slice(7, 11) })].every((rms) => rms > bar),
    ).toBe(true);
  });

  it("refuses no words, a negative gap, no length, and bytes that are not a 16-bit PCM WAVE", () => {
    expect([
      tiledWave({ bytes: wave({ samples: Buffer.alloc(0) }), gapMs: 3, totalMs: 12 }),
      tiledWave({ bytes: wave({ samples: words }), gapMs: -1, totalMs: 12 }),
      tiledWave({ bytes: wave({ samples: words }), gapMs: 3, totalMs: 0 }),
      tiledWave({ bytes: Buffer.from("not a wave at all"), gapMs: 3, totalMs: 12 }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("generateMicrophone", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A `say` that writes a fixed four-sample saying wherever it is pointed: a seam, never a mock. */
  const fakeSay: E2eAudioRun = ({ args }) => {
    const words = Buffer.alloc(8, 0x40);
    writeFileSync(args[1]!, wave({ samples: words }));
  };

  it("writes a quiet room alone for a silent reopen, and runs no say for it", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-mic-"));
    dirs.push(dir);
    const path = join(dir, "room.wav");
    const ran: string[] = [];
    const written = generateMicrophone({
      microphone: { kind: "room", ms: 100 },
      path,
      run: ({ file }) => {
        ran.push(file);
      },
    });
    expect(written.isOk()).toBe(true);
    expect(ran).toEqual([]);
    expect(samplesOf({ bytes: readFileSync(path) }).length).toBe(4800);
  });

  it("writes the words tiled for a reopen the owner speaks into at once", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-mic-"));
    dirs.push(dir);
    const path = join(dir, "tiled.wav");
    const written = generateMicrophone({
      microphone: { gapMs: 3, kind: "tiled", totalMs: 12, words: "wait, one thing first" },
      path,
      run: fakeSay,
    });
    expect(written.isOk()).toBe(true);
    expect(samplesOf({ bytes: readFileSync(path) }).length).toBe(14);
  });

  it("names a say that failed", () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-mic-"));
    dirs.push(dir);
    const written = generateMicrophone({
      microphone: { gapMs: 3, kind: "tiled", totalMs: 12, words: "wait" },
      path: join(dir, "tiled.wav"),
      run: () => {
        throw new Error("say: no voice");
      },
    });
    expect(unwrapErr(written)).toEqual(E2eCallErrors.audioSynthesisFailed({ detail: "say: no voice" }));
  });
});
