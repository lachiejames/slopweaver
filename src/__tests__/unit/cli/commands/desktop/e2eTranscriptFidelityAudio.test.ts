import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import {
  concatenatePcmWaves,
  type E2eAudioRun,
  waveDurationMs,
  withGain,
} from "../../../../../cli/commands/desktop/e2eCallAudio.js";
import {
  fidelitySayArgs,
  generateTranscriptFidelityMicrophone,
  voiceListed,
} from "../../../../../cli/commands/desktop/e2eTranscriptFidelityAudio.js";

/**
 * A mono 16-bit PCM WAV at `rate` Hz holding `samples`, shaped as `say` writes one: `fmt `, then `data`.
 *
 * @param samples the audio, one signed 16-bit value each
 * @param rate frames per second
 * @returns the whole file
 */
function wave({ samples, rate = 1000 }: { samples: readonly number[]; rate?: number }): Buffer {
  const format = Buffer.alloc(16);
  format.writeUInt16LE(1, 0);
  format.writeUInt16LE(1, 2);
  format.writeUInt32LE(rate, 4);
  format.writeUInt32LE(rate * 2, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, at) => data.writeInt16LE(sample, at * 2));
  const chunk = ({ id, body }: { id: string; body: Buffer }): Buffer => {
    const header = Buffer.alloc(8);
    header.write(id, 0, "latin1");
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
  };
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    chunk({ body: format, id: "fmt " }),
    chunk({ body: data, id: "data" }),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

/**
 * A file's samples, read from its `data` chunk.
 *
 * @param bytes the whole WAV
 * @returns every sample
 */
function samplesOf({ bytes }: { bytes: Uint8Array }): readonly number[] {
  const file = Buffer.from(bytes);
  const at = file.indexOf("data", 12, "latin1");
  const size = file.readUInt32LE(at + 4);
  return Array.from({ length: size / 2 }, (_, index) => file.readInt16LE(at + 8 + index * 2));
}

describe("withGain", () => {
  it("scales every sample, rounding, and leaves the header alone", () => {
    const scaled = Buffer.from(withGain({ bytes: wave({ samples: [1000, -1000, 3, 0] }), factor: 0.35 })!);
    expect(samplesOf({ bytes: scaled })).toEqual([350, -350, 1, 0]);
    expect(scaled.subarray(0, 44)).toEqual(wave({ samples: [350, -350, 1, 0] }).subarray(0, 44));
  });

  it("refuses a factor outside 0 to 1, and a file that is not a WAV", () => {
    expect([
      withGain({ bytes: wave({ samples: [1] }), factor: 1.5 }),
      withGain({ bytes: wave({ samples: [1] }), factor: Number.NaN }),
      withGain({ bytes: Buffer.from("not a wave at all"), factor: 0.5 }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("waveDurationMs", () => {
  it("reads a file's length off its byte rate, and refuses what is not a WAV", () => {
    expect([
      waveDurationMs({ bytes: wave({ samples: Array.from({ length: 1500 }, () => 0) }) }),
      waveDurationMs({ bytes: Buffer.from("not a wave at all") }),
    ]).toEqual([1500, undefined]);
  });
});

describe("concatenatePcmWaves", () => {
  it("joins the audio in order under one header whose sizes match the file", () => {
    const joined = Buffer.from(concatenatePcmWaves({ waves: [wave({ samples: [1, 2] }), wave({ samples: [3] })] })!);
    expect(samplesOf({ bytes: joined })).toEqual([1, 2, 3]);
    expect(joined.readUInt32LE(4)).toBe(joined.length - 8);
    expect(joined.length).toBe(44 + 6);
  });

  it("refuses an empty list and two waves of different rates", () => {
    expect([
      concatenatePcmWaves({ waves: [] }),
      concatenatePcmWaves({ waves: [wave({ samples: [1] }), wave({ rate: 2000, samples: [1] })] }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("voiceListed", () => {
  const LISTING = [
    "Fred                en_US    # Hello! My name is Fred.",
    "Samantha (English (US)) en_US    # Hello! My name is Samantha.",
  ].join("\n");

  it("finds a voice by its name at the start of a line", () => {
    expect([
      voiceListed({ listing: LISTING, voice: "Samantha" }),
      voiceListed({ listing: LISTING, voice: "Fred" }),
    ]).toEqual([true, true]);
  });

  it("never matches a name that only appears later in a line, or a prefix of another name", () => {
    expect([
      voiceListed({ listing: LISTING, voice: "Hello!" }),
      voiceListed({ listing: LISTING, voice: "Saman" }),
    ]).toEqual([false, false]);
  });
});

describe("fidelitySayArgs", () => {
  it("pins the voice and the rate ahead of the format arguments", () => {
    expect(fidelitySayArgs({ path: "/x.wav", words: "Hello." })).toEqual([
      "-v",
      "Samantha",
      "-r",
      "175",
      "-o",
      "/x.wav",
      "--file-format=WAVE",
      "--data-format=LEI16@48000",
      "--channels=1",
      "Hello.",
    ]);
  });
});

describe("generateTranscriptFidelityMicrophone", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  /** A `say` stand-in writing one 10-sample clip at 1 kHz to the path it is given, and recording what it said. */
  function fakeSay({ said }: { said: string[] }): E2eAudioRun {
    return ({ args }) => {
      said.push(args[args.length - 1]!);
      writeFileSync(args[args.indexOf("-o") + 1]!, wave({ samples: Array.from({ length: 10 }, () => 1000) }));
    };
  }

  it("refuses before speaking a word when the pinned voice is not installed", () => {
    const scratch = mkdtempSync(join(tmpdir(), "fidelity-mic-"));
    dirs.push(scratch);
    const said: string[] = [];
    const result = generateTranscriptFidelityMicrophone({
      listVoices: () => "Fred                en_US    # Hello! My name is Fred.",
      path: join(scratch, "microphone.wav"),
      run: fakeSay({ said }),
      scratch,
    });
    const failure = unwrapErr(result);
    expect(failure.code).toBe("AUDIO_SYNTHESIS_FAILED");
    expect(failure.message).toContain("Samantha is not installed");
    expect(said).toEqual([]);
  });

  it("speaks every line in order and joins them with the lead and every silence, the same bytes twice", () => {
    const scratch = mkdtempSync(join(tmpdir(), "fidelity-mic-"));
    dirs.push(scratch);
    const said: string[] = [];
    const path = join(scratch, "microphone.wav");
    const once = unwrap(
      generateTranscriptFidelityMicrophone({
        listVoices: () => "Samantha (English (US)) en_US",
        path,
        run: fakeSay({ said }),
        scratch,
      }),
    );
    const again = unwrap(
      generateTranscriptFidelityMicrophone({
        listVoices: () => "Samantha (English (US)) en_US",
        path,
        run: fakeSay({ said: [] }),
        scratch,
      }),
    );
    expect(said.slice(0, 2)).toEqual([
      "This is a synthetic transcription test. Reply with okay after each line and do not use tools.",
      "Hello.",
    ]);
    expect(said.length).toBe(9);
    // Nine 10-sample clips, plus 435 s of lead and silence, at 1 kHz.
    expect(samplesOf({ bytes: readFileSync(path) }).length).toBe(90 + 435_000);
    expect([once.voice, once.rate, once.corpusVersion]).toEqual(["Samantha", 175, "transcription-fidelity-v1"]);
    expect(once.sha256).toBe(again.sha256);
    // Nine 90 ms of speech, the 15 s lead and eight 20 s gaps: the 260 s tail is the only part not counted.
    expect(once.scriptEndMs).toBe(175_090);
  });
});
