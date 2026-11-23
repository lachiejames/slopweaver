/**
 * The private store a parked draft's attachments live in, through its own files in a throwaway home.
 *
 * What a release trusts is that the bytes it reads back are the bytes admitted at recording, so the cases
 * worth holding down are the ones where that could quietly stop being true: a blob changed on disk, a blob
 * gone, a corrupt copy already sitting where a new recording would write, and permissions wider than the
 * unsent message's own.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSlackDraftMedia, slackDraftMediaPath, storeSlackDraftMedia } from "../../../admit/slackDraftMediaStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const HOMES: string[] = [];

afterEach(() => {
  for (const home of HOMES.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, minted inside this file's own sandbox root. */
function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-draft-media-"));
  HOMES.push(home);
  return home;
}

const VIDEO = Buffer.from("not really an mp4, but bytes are bytes");
const VIDEO_SHA = createHash("sha256").update(VIDEO).digest("hex");
const STILL = Buffer.from("a still");

describe("storeSlackDraftMedia", () => {
  it("keeps each upload under its SHA-256, owner-only, and answers the row entries in attach order", () => {
    const home = newHome();
    const records = unwrap(
      storeSlackDraftMedia({
        home,
        uploads: [
          { bytes: VIDEO, filename: "walkthrough.mp4" },
          { bytes: STILL, filename: "still.png" },
        ],
      }),
    );
    expect(records).toEqual([
      { bytes: VIDEO.length, name: "walkthrough.mp4", sha256: VIDEO_SHA },
      { bytes: STILL.length, name: "still.png", sha256: createHash("sha256").update(STILL).digest("hex") },
    ]);
    const path = slackDraftMediaPath({ home, sha256: VIDEO_SHA });
    expect(path).toBe(join(home, "queue", "slack-draft-media", VIDEO_SHA.slice(0, 2), VIDEO_SHA));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
  });

  it("leaves a store root and shard it found looser than owner-only at exactly 0700 after writing", () => {
    const home = newHome();
    const shard = dirname(slackDraftMediaPath({ home, sha256: VIDEO_SHA }));
    mkdirSync(shard, { mode: 0o777, recursive: true });
    chmodSync(dirname(shard), 0o777);
    chmodSync(shard, 0o777);
    unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    expect(statSync(dirname(shard)).mode & 0o777).toBe(0o700);
    expect(statSync(shard).mode & 0o777).toBe(0o700);
  });

  it("settles the modes of a blob it finds already there, not only one it writes", () => {
    const home = newHome();
    const path = slackDraftMediaPath({ home, sha256: VIDEO_SHA });
    unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    chmodSync(path, 0o666);
    chmodSync(dirname(path), 0o777);
    chmodSync(dirname(dirname(path)), 0o777);
    unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "b.mp4" }] }));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(statSync(dirname(dirname(path))).mode & 0o777).toBe(0o700);
  });

  it("never lets the filename a composer typed steer where the bytes are written", () => {
    const home = newHome();
    const [record] = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "../../escape.mp4" }] }));
    expect(record!.name).toBe("../../escape.mp4");
    expect(statSync(slackDraftMediaPath({ home, sha256: VIDEO_SHA })).size).toBe(VIDEO.length);
  });

  it("holds identical bytes once, recognising a verified copy already there", () => {
    const home = newHome();
    const first = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    const second = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "b.mp4" }] }));
    expect(first[0]!.sha256).toBe(second[0]!.sha256);
    expect(second[0]!.name).toBe("b.mp4");
  });

  it("REFUSES rather than overwriting a corrupt copy another draft's approval may name", () => {
    const home = newHome();
    unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    const path = slackDraftMediaPath({ home, sha256: VIDEO_SHA });
    writeFileSync(path, "tampered");
    const error = unwrapErr(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    expect(error.code).toBe("DRAFT_MEDIA_CORRUPT");
    expect(error.message).toContain(path);
  });

  it("REFUSES a shard that is a symbolic link, writing nothing where it points", () => {
    const home = newHome();
    const outside = newHome();
    const shard = dirname(slackDraftMediaPath({ home, sha256: VIDEO_SHA }));
    mkdirSync(dirname(shard), { recursive: true });
    symlinkSync(outside, shard);
    const error = unwrapErr(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    expect(error.code).toBe("DRAFT_MEDIA_LINKED");
    expect(error.message).toContain(shard);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("REFUSES a queue directory that is a symbolic link, though the store under it does not exist yet", () => {
    const home = newHome();
    const outside = newHome();
    symlinkSync(outside, join(home, "queue"));
    const error = unwrapErr(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    expect(error.code).toBe("DRAFT_MEDIA_LINKED");
    expect(error.message).toContain(join(home, "queue"));
    expect(readdirSync(outside)).toEqual([]);
  });

  it("REFUSES a store root that is a symbolic link", () => {
    const home = newHome();
    const outside = newHome();
    const root = dirname(dirname(slackDraftMediaPath({ home, sha256: VIDEO_SHA })));
    mkdirSync(dirname(root), { recursive: true });
    symlinkSync(outside, root);
    const error = unwrapErr(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "a.mp4" }] }));
    expect(error.code).toBe("DRAFT_MEDIA_LINKED");
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe("readSlackDraftMedia — verify before anything is sent", () => {
  it("answers the exact stored bytes under the recorded name, with the path and the row entry", () => {
    const home = newHome();
    const media = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "walkthrough.mp4" }] }));
    const [verified] = unwrap(readSlackDraftMedia({ home, media }));
    expect(Buffer.from(verified!.upload.bytes).equals(VIDEO)).toBe(true);
    expect(verified!.upload.filename).toBe("walkthrough.mp4");
    expect(verified!.path).toBe(slackDraftMediaPath({ home, sha256: VIDEO_SHA }));
    expect(verified!.record).toEqual(media[0]);
  });

  it("REFUSES a blob that is gone, naming the attachment", () => {
    const home = newHome();
    const error = unwrapErr(
      readSlackDraftMedia({ home, media: [{ bytes: VIDEO.length, name: "walkthrough.mp4", sha256: VIDEO_SHA }] }),
    );
    expect(error.code).toBe("DRAFT_MEDIA_MISSING");
    expect(error.message).toContain("walkthrough.mp4");
  });

  it("REFUSES a blob whose bytes changed after recording, even at the same length", () => {
    const home = newHome();
    const media = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "walkthrough.mp4" }] }));
    writeFileSync(slackDraftMediaPath({ home, sha256: VIDEO_SHA }), Buffer.alloc(VIDEO.length, 0x41));
    expect(unwrapErr(readSlackDraftMedia({ home, media })).code).toBe("DRAFT_MEDIA_CORRUPT");
  });

  it("REFUSES a blob that is a symbolic link, even to the exact approved bytes", () => {
    const home = newHome();
    const outside = join(newHome(), "copy.mp4");
    writeFileSync(outside, VIDEO);
    const path = slackDraftMediaPath({ home, sha256: VIDEO_SHA });
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(outside, path);
    const error = unwrapErr(
      readSlackDraftMedia({ home, media: [{ bytes: VIDEO.length, name: "walkthrough.mp4", sha256: VIDEO_SHA }] }),
    );
    expect(error.code).toBe("DRAFT_MEDIA_LINKED");
    expect(error.message).toContain(path);
  });

  it("REFUSES a row whose recorded byte count disagrees with the blob", () => {
    const home = newHome();
    const [record] = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: VIDEO, filename: "walkthrough.mp4" }] }));
    const error = unwrapErr(readSlackDraftMedia({ home, media: [{ ...record!, bytes: record!.bytes + 1 }] }));
    expect(error.code).toBe("DRAFT_MEDIA_CORRUPT");
  });
});
