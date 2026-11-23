/**
 * The relay picture: a bounded WebP checked by its own magic, kept once per turn beside the turn record, and
 * never replaced by a second frame. Filesystem cases round-trip through a temp home this file mints.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  isWebp,
  persistRelayPicture,
  prepareRelayPicture,
  RELAY_PICTURE_MAX_BYTES,
  relayPicturePath,
} from "../../../talk/relayPicture.js";

const TURN = "a0000017-0000-4000-8000-000000000019";

/** A WebP container — RIFF sized to the file, one `VP8L` chunk sized to its body — around one repeated byte. */
const webp = ({ fill, body }: { fill: number; body: number }): Buffer => {
  const head = Buffer.alloc(20);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(12 + body, 4);
  head.write("WEBPVP8L", 8, "latin1");
  head.writeUInt32LE(body, 16);
  return Buffer.concat([head, Buffer.alloc(body, fill)]);
};

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "relay-picture-"));
});

afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

describe("isWebp", () => {
  it("accepts a RIFF/WEBP container sized to the file around an image chunk that fits", () => {
    expect(isWebp({ bytes: webp({ body: 4, fill: 0 }) })).toBe(true);
    // Modernizr's 1x1 lossy detection image: a real encoder's output, not this file's own fixture shape.
    expect(isWebp({ bytes: Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64") })).toBe(
      true,
    );
  });

  it("refuses an extended VP8X header with no image behind it, and accepts one with a VP8L chunk after it", () => {
    // A counterexample: RIFF, WEBP, a 10-byte VP8X and nothing else.
    expect(isWebp({ bytes: Buffer.from("UklGRhYAAABXRUJQVlA4WAoAAAAAAAAAAAAAAAAA", "base64") })).toBe(false);
    const vp8x = Buffer.alloc(18);
    vp8x.write("VP8X", 0, "latin1");
    vp8x.writeUInt32LE(10, 4);
    const lossless = webp({ body: 4, fill: 0 }).subarray(12);
    const extended = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), vp8x, lossless]);
    extended.writeUInt32LE(extended.length - 8, 4);
    expect(isWebp({ bytes: extended })).toBe(true);
  });

  it("walks an odd-sized chunk by its even padding, and refuses one whose padding is missing", () => {
    const padded = webp({ body: 4, fill: 0 });
    const odd = Buffer.concat([padded.subarray(0, 16), Buffer.from([3, 0, 0, 0]), Buffer.alloc(4)]);
    odd.writeUInt32LE(odd.length - 8, 4);
    const unpadded = Buffer.concat([padded.subarray(0, 16), Buffer.from([3, 0, 0, 0]), Buffer.alloc(3)]);
    unpadded.writeUInt32LE(unpadded.length - 8, 4);
    expect([odd, unpadded].map((bytes) => isWebp({ bytes }))).toEqual([true, false]);
  });

  it("refuses the header-shaped shell with no image chunk that the magic alone would pass", () => {
    expect(isWebp({ bytes: Buffer.from("UklGRgAAAABXRUJQ", "base64") })).toBe(false);
  });

  it("refuses a RIFF size that is not the file's, a first chunk that is not an image, and a chunk past the end", () => {
    const good = webp({ body: 4, fill: 0 });
    const resized = Buffer.from(good);
    resized.writeUInt32LE(99, 4);
    const wrongChunk = Buffer.from(good);
    wrongChunk.write("ICCP", 12, "latin1");
    const overrun = Buffer.from(good);
    overrun.writeUInt32LE(5, 16);
    expect([resized, wrongChunk, overrun].map((bytes) => isWebp({ bytes }))).toEqual([false, false, false]);
  });

  it("refuses RIFF without WEBP, WEBP without RIFF, and a file too short to carry an image chunk", () => {
    const wave = webp({ body: 4, fill: 0 });
    wave.write("WAVE", 8, "latin1");
    const rifx = webp({ body: 4, fill: 0 });
    rifx.write("RIFX", 0, "latin1");
    expect([wave, rifx, Buffer.from("RIFF\0\0\0\0WEBPVP8 ")].map((bytes) => isWebp({ bytes }))).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("prepareRelayPicture", () => {
  it("says why there is no picture when none was sent — no share, or a share that gave no frame", () => {
    const home = join(scratch, "home");
    expect(
      unwrap(
        prepareRelayPicture({
          home,
          screenFailed: false,
          screenNotTaken: false,
          screenRecordingOff: false,
          sourcePath: undefined,
          turnId: TURN,
          typed: false,
        }),
      ),
    ).toEqual({
      data: undefined,
      picture: { kind: "none", reason: "screen-not-shared" },
    });
    expect(
      unwrap(
        prepareRelayPicture({
          home,
          screenFailed: true,
          screenNotTaken: false,
          screenRecordingOff: false,
          sourcePath: undefined,
          turnId: TURN,
          typed: false,
        }),
      ),
    ).toEqual({
      data: undefined,
      picture: { kind: "none", reason: "capture-failed" },
    });
  });

  it("says the desktop app's look was refused by Screen Recording, never that a share gave no frame", () => {
    expect(
      unwrap(
        prepareRelayPicture({
          home: join(scratch, "home"),
          screenFailed: false,
          screenNotTaken: false,
          screenRecordingOff: true,
          sourcePath: undefined,
          turnId: TURN,
          typed: false,
        }),
      ),
    ).toEqual({
      data: undefined,
      picture: { kind: "none", reason: "screen-recording-off" },
    });
  });

  it("says a shared screen had no frame taken this turn, rather than grabbing one", () => {
    const home = join(scratch, "home");
    expect(
      unwrap(
        prepareRelayPicture({
          home,
          screenFailed: false,
          screenNotTaken: true,
          screenRecordingOff: false,
          sourcePath: undefined,
          turnId: TURN,
          typed: false,
        }),
      ),
    ).toEqual({
      data: undefined,
      picture: { kind: "none", reason: "not-taken-this-turn" },
    });
  });

  it("says a typed steer with no image had none attached, whatever the share flag says", () => {
    const home = join(scratch, "home");
    expect(
      unwrap(
        prepareRelayPicture({
          home,
          screenFailed: true,
          screenNotTaken: false,
          screenRecordingOff: false,
          sourcePath: undefined,
          turnId: TURN,
          typed: true,
        }),
      ),
    ).toEqual({
      data: undefined,
      picture: { kind: "none", reason: "not-attached" },
    });
  });

  it("describes an attached frame by the turn's own absolute path, its size and its sha256", () => {
    const home = join(scratch, "home");
    const source = join(scratch, "frame.webp");
    writeFileSync(source, webp({ body: 20, fill: 7 }));
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(prepared.picture).toEqual({
      bytes: 40,
      kind: "attached",
      path: join(home, "talk", "turns", `${TURN}.webp`),
      sha256: createHash("sha256")
        .update(webp({ body: 20, fill: 7 }))
        .digest("hex"),
    });
  });

  it("refuses a file one byte over the bound, naming the bound", () => {
    const source = join(scratch, "big.webp");
    writeFileSync(source, webp({ body: RELAY_PICTURE_MAX_BYTES - 19, fill: 1 }));
    const failure = unwrapErr(
      prepareRelayPicture({
        home: join(scratch, "home"),
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(failure.code).toBe("PICTURE_INVALID");
    expect(failure.message).toContain(`is ${String(RELAY_PICTURE_MAX_BYTES + 1)} bytes`);
  });

  it("accepts a file exactly at the bound", () => {
    const source = join(scratch, "edge.webp");
    writeFileSync(source, webp({ body: RELAY_PICTURE_MAX_BYTES - 20, fill: 1 }));
    const prepared = unwrap(
      prepareRelayPicture({
        home: join(scratch, "home"),
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(prepared.data!.length).toBe(RELAY_PICTURE_MAX_BYTES);
  });

  it("refuses a file that is not a WebP, and one that is not there", () => {
    const source = join(scratch, "frame.png");
    writeFileSync(source, Buffer.from("\x89PNG\r\n\x1a\n0000"));
    const home = join(scratch, "home");
    expect(
      unwrapErr(
        prepareRelayPicture({
          home,
          screenFailed: false,
          screenNotTaken: false,
          screenRecordingOff: false,
          sourcePath: source,
          turnId: TURN,
          typed: false,
        }),
      ).message,
    ).toContain("is not a WebP image");
    expect(
      unwrapErr(
        prepareRelayPicture({
          home,
          screenFailed: false,
          screenNotTaken: false,
          screenRecordingOff: false,
          sourcePath: join(scratch, "gone.webp"),
          turnId: TURN,
          typed: false,
        }),
      ).message,
    ).toContain("could not be read");
  });

  // The supervisor line types the path with control characters blanked, so it named another path.
  it("refuses a picture whose kept path holds a control character, before reading the frame", () => {
    const home = join(scratch, "sw\thome");
    const failure = unwrapErr(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: join(scratch, "gone.webp"),
        turnId: TURN,
        typed: false,
      }),
    );
    expect(failure.message).toBe(
      `the relay picture at ${relayPicturePath({ home, turnId: TURN })} holds a control character, so no typed line could name it`,
    );
  });

  // A FIFO stats at 0 bytes and can then be read past the cap, so only a regular file is read.
  it("refuses a path that is not a regular file, before reading it", () => {
    const failure = unwrapErr(
      prepareRelayPicture({
        home: join(scratch, "home"),
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: scratch,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(failure.message).toBe(`the relay picture at ${scratch} is not a regular file`);
  });
});

describe("persistRelayPicture", () => {
  it("keeps the frame at the turn's path, and accepts the same frame again", () => {
    const home = join(scratch, "home");
    const source = join(scratch, "frame.webp");
    writeFileSync(source, webp({ body: 8, fill: 3 }));
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(persistRelayPicture({ claimedNow: true, prepared }).isOk()).toBe(true);
    expect(persistRelayPicture({ claimedNow: false, prepared }).isOk()).toBe(true);
    expect(readFileSync(relayPicturePath({ home, turnId: TURN }))).toEqual(webp({ body: 8, fill: 3 }));
  });

  // A fresh claim that REFUSED a file already there left its record behind, and the retry,
  // reading as a resume, adopted that file. A fresh claim now replaces it with its own bytes instead.
  it("replaces whatever is at the path of a turn claimed just now with this run's own bytes, a symlink too", () => {
    const home = join(scratch, "home");
    const source = join(scratch, "frame.webp");
    writeFileSync(source, webp({ body: 8, fill: 3 }));
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    const kept = relayPicturePath({ home, turnId: TURN });
    mkdirSync(join(home, "talk", "turns"), { recursive: true });
    const decoy = join(scratch, "decoy.webp");
    writeFileSync(decoy, webp({ body: 8, fill: 9 }));
    symlinkSync(decoy, kept);
    expect(persistRelayPicture({ claimedNow: true, prepared }).isOk()).toBe(true);
    expect([lstatSync(kept).isFile(), readFileSync(kept), readFileSync(decoy)]).toEqual([
      true,
      webp({ body: 8, fill: 3 }),
      webp({ body: 8, fill: 9 }),
    ]);
  });

  it("rewrites the same frame on a replay, so the kept file is always one this verb wrote", () => {
    const home = join(scratch, "home");
    const source = join(scratch, "frame.webp");
    writeFileSync(source, webp({ body: 8, fill: 3 }));
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    const kept = relayPicturePath({ home, turnId: TURN });
    mkdirSync(join(home, "talk", "turns"), { recursive: true });
    writeFileSync(kept, webp({ body: 8, fill: 3 }));
    const found = lstatSync(kept).ino;
    expect(persistRelayPicture({ claimedNow: false, prepared }).isOk()).toBe(true);
    expect(lstatSync(kept).ino).not.toBe(found);
  });

  it("never replaces the first frame with a different one", () => {
    const home = join(scratch, "home");
    const source = join(scratch, "frame.webp");
    writeFileSync(source, webp({ body: 8, fill: 3 }));
    unwrap(
      persistRelayPicture({
        claimedNow: true,
        prepared: unwrap(
          prepareRelayPicture({
            home,
            screenFailed: false,
            screenNotTaken: false,
            screenRecordingOff: false,
            sourcePath: source,
            turnId: TURN,
            typed: false,
          }),
        ),
      }),
    );
    writeFileSync(source, webp({ body: 8, fill: 4 }));
    const second = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(unwrapErr(persistRelayPicture({ claimedNow: false, prepared: second })).message).toContain(
      "already holds a different picture for this turn",
    );
    expect(readFileSync(relayPicturePath({ home, turnId: TURN }))).toEqual(webp({ body: 8, fill: 3 }));
  });

  // A symlink at the kept path, pointing at the same bytes, passed the hash check.
  it("refuses a symlink at the kept path even when it points at the same frame", () => {
    const home = join(scratch, "home");
    const source = join(scratch, "frame.webp");
    writeFileSync(source, webp({ body: 8, fill: 3 }));
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: source,
        turnId: TURN,
        typed: false,
      }),
    );
    mkdirSync(join(home, "talk", "turns"), { recursive: true });
    symlinkSync(source, relayPicturePath({ home, turnId: TURN }));
    expect(unwrapErr(persistRelayPicture({ claimedNow: false, prepared })).message).toBe(
      `the relay picture at ${relayPicturePath({ home, turnId: TURN })} is held by something that is not a regular file`,
    );
  });

  it("writes nothing for a relay with no picture", () => {
    const home = join(scratch, "home");
    const prepared = unwrap(
      prepareRelayPicture({
        home,
        screenFailed: false,
        screenNotTaken: false,
        screenRecordingOff: false,
        sourcePath: undefined,
        turnId: TURN,
        typed: false,
      }),
    );
    expect(persistRelayPicture({ claimedNow: true, prepared }).isOk()).toBe(true);
    expect(existsSync(relayPicturePath({ home, turnId: TURN }))).toBe(false);
  });
});
