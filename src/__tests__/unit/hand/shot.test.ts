/*
 * A hand step's picture: one red box per thing to grab, in the PNG's own pixels, checked by the one rule posting and
 * reading share — so a box past the picture's edge is refused at `hand post` and read as a corrupt row afterwards.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseHandLine } from "../../../hand/row.js";
import { checkedShot, parseBoxFlag, pngSize } from "../../../hand/shot.js";
import { HandShotErrors } from "../../../hand/shotErrors.js";
import { discardHandShot, handShotPath, readHandShot, storeHandShot } from "../../../hand/shotStore.js";
import { buildHandStep, type HandStepDraft } from "../../../hand/step.js";
import { checkedAttachments } from "../../../hand/stepAttachments.js";
import { unwrap } from "../../../lib/result.js";

/** The first 24 bytes of a PNG declaring this size — all `pngSize` reads, then a little body. */
function pngBytes({ width, height }: { width: number; height: number }): Buffer {
  const bytes = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).copy(
    bytes,
  );
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const SHA = "a".repeat(64);

const BOX = { height: 36, label: "the Personal API keys field", width: 320, x: 40, y: 120 };

const STEP: HandStepDraft = {
  id: "linear-token",
  postedBy: "workspace:1",
  postedIso: "2026-10-02T13:00:00.000Z",
  unblocks: "the Linear corpus pull",
  url: "https://linear.app/settings/account/security",
  what: "Create a Linear personal API key and paste it into the field below",
  witness: "slopweaver hand done linear-token",
};

describe("a --box flag", () => {
  it("reads x,y,width,height=label in image pixels", () => {
    expect(unwrap(parseBoxFlag({ value: "40,120,320,36=the Personal API keys field" }))).toEqual(BOX);
  });

  it("keeps an = inside the label", () => {
    expect(unwrap(parseBoxFlag({ value: "0,0,1,1=a=b" })).label).toBe("a=b");
  });

  it.each(["40,120,320=no height", "40,120,320,36", "-1,0,5,5=negative", "1.5,0,5,5=fraction", "a,b,c,d=words"])(
    "refuses %s",
    (value) => {
      const parsed = parseBoxFlag({ value });
      expect(parsed._unsafeUnwrapErr().code).toBe("INVALID_FIELD");
      expect(parsed._unsafeUnwrapErr().message).toContain("is not x,y,width,height=label");
    },
  );
});

describe("a PNG's declared size", () => {
  it("is read from its IHDR chunk", () => {
    expect(unwrap(pngSize({ bytes: pngBytes({ height: 900, width: 1440 }) }))).toEqual({ height: 900, width: 1440 });
  });

  it("refuses bytes that are not a PNG", () => {
    expect(pngSize({ bytes: Buffer.from("GIF89a and then some more bytes") })._unsafeUnwrapErr().message).toContain(
      "is not a PNG",
    );
  });

  it("refuses a zero-sized picture", () => {
    expect(pngSize({ bytes: pngBytes({ height: 0, width: 10 }) })._unsafeUnwrapErr().message).toContain(
      "declares 10x0 pixels",
    );
  });
});

describe("a step's shot, checked whole", () => {
  const shot = { boxes: [BOX], height: 900, sha256: SHA, width: 1440 };

  it("is absent when the step carries none", () => {
    expect(unwrap(checkedShot({ unboxed: "refused", value: undefined }))).toBeUndefined();
  });

  it("passes a box that touches the picture's edge exactly", () => {
    const edge = { height: 1, label: "corner", width: 1, x: 1439, y: 899 };
    expect(unwrap(checkedShot({ unboxed: "refused", value: { ...shot, boxes: [edge] } }))!.boxes).toEqual([edge]);
  });

  it.each([
    ["one pixel past the right edge", { ...BOX, width: 1401 }, "runs past the 1440x900 picture"],
    ["starting below the picture", { ...BOX, y: 900 }, "starts outside the 1440x900 picture"],
    ["with no area", { ...BOX, height: 0 }, "has no area"],
    ["with a 61-character label", { ...BOX, label: "x".repeat(61) }, "label is one line of 1 to 60 characters"],
    ["with a two-line label", { ...BOX, label: "one\ntwo" }, "label is one line of 1 to 60 characters"],
  ])("refuses a box %s", (_name, box, why) => {
    expect(checkedShot({ unboxed: "refused", value: { ...shot, boxes: [box] } })._unsafeUnwrapErr().message).toContain(
      why,
    );
  });

  it.each([
    ["no boxes", []],
    ["ten boxes", Array.from({ length: 10 }, () => BOX)],
  ])("refuses %s on a picture that must point at something", (_name, boxes) => {
    expect(checkedShot({ unboxed: "refused", value: { ...shot, boxes } })._unsafeUnwrapErr().message).toContain(
      "carries 1 to 9 boxes",
    );
  });

  it("passes no boxes on a hand step's picture — the page its post opened, nothing to grab", () => {
    expect(unwrap(checkedShot({ unboxed: "admitted", value: { ...shot, boxes: [] } }))).toEqual({ ...shot, boxes: [] });
  });

  it("still refuses ten boxes on a hand step's picture", () => {
    const boxes = Array.from({ length: 10 }, () => BOX);
    expect(checkedShot({ unboxed: "admitted", value: { ...shot, boxes } })._unsafeUnwrapErr().message).toContain(
      "carries 0 to 9 boxes",
    );
  });

  it("refuses a hash that names no stored picture", () => {
    expect(
      checkedShot({ unboxed: "refused", value: { ...shot, sha256: "../../etc/passwd" } })._unsafeUnwrapErr().message,
    ).toContain("sha256 is 64 lowercase hex characters");
  });
});

describe("a step carrying a shot", () => {
  const shot = { boxes: [BOX], height: 900, sha256: SHA, width: 1440 };

  it("keeps it through a register round trip", () => {
    const step = unwrap(buildHandStep({ draft: { ...STEP, shot } }));
    const row = unwrap(parseHandLine({ line: JSON.stringify({ kind: "posted", step }), lineNumber: 1 }));
    expect(row).toEqual({ kind: "posted", step: { ...step, shot } });
  });

  it("reads a line whose shot runs past its picture as a corrupt row", () => {
    const step = { ...unwrap(buildHandStep({ draft: STEP })), shot: { ...shot, boxes: [{ ...BOX, x: 1400 }] } };
    const read = parseHandLine({ line: JSON.stringify({ kind: "posted", step }), lineNumber: 7 });
    expect(read._unsafeUnwrapErr().code).toBe("CORRUPT_ROW");
    expect(read._unsafeUnwrapErr().message).toContain("runs past the 1440x900 picture");
  });

  it("collects the shot beside the checklist, cites, details and quotes as pieces to spread, each empty when absent", () => {
    expect(unwrap(checkedAttachments({ draft: { ...STEP, shot } }))).toEqual({
      checklist: {},
      cites: {},
      details: {},
      quotes: {},
      shot: { shot },
    });
    expect(unwrap(checkedAttachments({ draft: STEP }))).toEqual({
      checklist: {},
      cites: {},
      details: {},
      quotes: {},
      shot: {},
    });
  });

  it("refuses the step on its shot's own rule", () => {
    const bad = { ...shot, boxes: [{ ...BOX, x: 1400 }] };
    expect(checkedAttachments({ draft: { ...STEP, shot: bad } })._unsafeUnwrapErr().message).toContain(
      "runs past the 1440x900 picture",
    );
  });
});

describe("the picture store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.splice(0).forEach((dir) => {
      rmSync(dir, { force: true, recursive: true });
    });
  });
  const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "hand-shot-"));
    dirs.push(dir);
    return dir;
  };

  it("stores the bytes 0600 under their SHA-256, in a 0700 shard", () => {
    const dir = scratch();
    const home = join(dir, "home");
    const source = join(dir, "page.png");
    writeFileSync(source, pngBytes({ height: 900, width: 1440 }));
    const read = unwrap(readHandShot({ path: source }));
    const stored = unwrap(storeHandShot({ home, shot: read }));
    expect(stored.created).toBe(true);
    const blob = stored.path;
    expect(blob).toBe(handShotPath({ home, sha256: read.sha256 }));
    expect(blob).toBe(join(home, "hand-steps", "shots", read.sha256.slice(0, 2), read.sha256));
    expect(readFileSync(blob).equals(pngBytes({ height: 900, width: 1440 }))).toBe(true);
    expect(lstatSync(blob).mode & 0o777).toBe(0o600);
    expect(lstatSync(join(blob, "..")).mode & 0o777).toBe(0o700);
    expect({ height: read.height, width: read.width }).toEqual({ height: 900, width: 1440 });
  });

  it("refuses a file that is not a PNG, naming the path", () => {
    const dir = scratch();
    const source = join(dir, "page.jpg");
    writeFileSync(source, "not a png at all, just some text bytes");
    expect(readHandShot({ path: source })._unsafeUnwrapErr().message).toContain("is not a PNG");
  });

  it("takes back only a picture this post created — one already stored is another step's too", () => {
    const dir = scratch();
    const home = join(dir, "home");
    const source = join(dir, "page.png");
    writeFileSync(source, pngBytes({ height: 900, width: 1440 }));
    const read = unwrap(readHandShot({ path: source }));
    const first = unwrap(storeHandShot({ home, shot: read }));
    const again = unwrap(storeHandShot({ home, shot: read }));
    expect(again).toEqual({ created: false, path: first.path });
    expect(discardHandShot({ stored: again })).toBeUndefined();
    expect(existsSync(first.path)).toBe(true);
    expect(discardHandShot({ stored: first })).toBeUndefined();
    expect(existsSync(first.path)).toBe(false);
  });

  it("refuses a file past 16 MiB by its size, before reading it", () => {
    const source = join(scratch(), "huge.png");
    writeFileSync(source, pngBytes({ height: 900, width: 1440 }));
    // Sparse, so the test allocates nothing: a valid PNG header with its length pushed one byte past the cap.
    truncateSync(source, 16 * 1024 * 1024 + 1);
    expect(readHandShot({ path: source })._unsafeUnwrapErr().message).toBe(
      `the step's picture at ${source} is 16777217 bytes, past the 16777216 a screenshot needs — nothing was posted`,
    );
  });

  it("refuses a path it cannot read", () => {
    const missing = join(scratch(), "absent.png");
    const read = readHandShot({ path: missing });
    expect(read._unsafeUnwrapErr().code).toBe("SHOT_STORE");
    expect(read._unsafeUnwrapErr().message).toBe(
      HandShotErrors.shotStore({ path: missing, why: "could not be read" }).message,
    );
    expect(read._unsafeUnwrapErr().message).toBe(
      `the step's picture at ${missing} could not be read — nothing was posted`,
    );
  });

  it("refuses to follow a symbolic link out of the home, and writes nothing through it", () => {
    const dir = scratch();
    const home = join(dir, "home");
    const elsewhere = join(dir, "elsewhere");
    const source = join(dir, "page.png");
    writeFileSync(source, pngBytes({ height: 10, width: 10 }));
    mkdirSync(home);
    mkdirSync(elsewhere);
    // `hand-steps` itself is the link, so following it would store the picture under `elsewhere`.
    symlinkSync(elsewhere, join(home, "hand-steps"));
    const stored = storeHandShot({ home, shot: unwrap(readHandShot({ path: source })) });
    expect(stored._unsafeUnwrapErr().code).toBe("SHOT_STORE");
    expect(stored._unsafeUnwrapErr().message).toBe(
      `the step's picture at ${join(home, "hand-steps")} is a symbolic link, so the store would leave the home — nothing was posted`,
    );
    expect(readdirSync(elsewhere)).toEqual([]);
  });
});
