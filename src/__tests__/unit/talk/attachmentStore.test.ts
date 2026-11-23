/*
 * Keeping a file the owner attached: judged from the staged file itself, written once under `talk/attachments/<id>/`, owner
 * only — and on every refusal, nothing written at all.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { ATTACHMENT_PICTURE_MAX_BYTES, ATTACHMENT_TEXT_MAX_BYTES } from "../../../talk/attachment.js";
import { keepAttachment } from "../../../talk/attachmentStore.js";

const ID = "00000000-0000-4000-8000-000000000001";
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

let scratch: string;
let home: string;
let staged: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "slop-attach-"));
  home = join(scratch, "home");
  staged = join(scratch, "staged");
  mkdirSync(staged);
});
afterEach(() => {
  rmSync(scratch, { force: true, recursive: true });
});

/** Stage `bytes` as the route would, and return its path. */
function stage({ bytes }: { bytes: Uint8Array }): string {
  const path = join(staged, "upload");
  writeFileSync(path, bytes, { mode: 0o600 });
  return path;
}

/** Keep the staged file under the test home with the fixed id. */
function keep({ name, stagedPath }: { name: string; stagedPath: string }): ReturnType<typeof keepAttachment> {
  return keepAttachment({ home, name, newId: () => ID, stagedPath });
}

/** Everything under the attachments directory, or nothing when it was never made. */
function attachmentsDir(): readonly string[] {
  const root = join(home, "talk", "attachments");
  return existsSync(root) ? readdirSync(root, { recursive: true }).map(String).toSorted() : [];
}

describe("keepAttachment", () => {
  it("keeps a text file byte for byte under its own id, the directory 0700 and the file 0600", () => {
    const bytes = new TextEncoder().encode("# notes\ncafé\n");
    const kept = unwrap(keep({ name: "/Users/owner/Desktop/notes.md", stagedPath: stage({ bytes }) }));
    const path = join(home, "talk", "attachments", ID, "notes.md");
    expect(kept).toEqual({ bytes: 14, kind: "text", name: "notes.md", path });
    expect(Array.from(readFileSync(path))).toEqual(Array.from(bytes));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "talk", "attachments", ID)).mode & 0o777).toBe(0o700);
  });

  it("keeps a picture and names its type", () => {
    const bytes = new Uint8Array(64);
    bytes.set(PNG_HEAD);
    const kept = unwrap(keep({ name: "shot.png", stagedPath: stage({ bytes }) }));
    expect(kept).toEqual({
      bytes: 64,
      kind: "picture",
      mediaType: "image/png",
      name: "shot.png",
      path: join(home, "talk", "attachments", ID, "shot.png"),
    });
  });

  it("refuses a picture over its cap on its size, writing nothing", () => {
    const bytes = new Uint8Array(ATTACHMENT_PICTURE_MAX_BYTES + 1);
    bytes.set(PNG_HEAD);
    expect(unwrapErr(keep({ name: "big.png", stagedPath: stage({ bytes }) })).message).toBe(
      "the picture is 8388609 bytes; the most attached is 8388608",
    );
    expect(attachmentsDir()).toEqual([]);
  });

  it("refuses a text file one byte over its cap, writing nothing", () => {
    const bytes = new Uint8Array(ATTACHMENT_TEXT_MAX_BYTES + 1).fill(0x61);
    expect(unwrapErr(keep({ name: "big.txt", stagedPath: stage({ bytes }) })).code).toBe("TOO_LARGE");
    expect(attachmentsDir()).toEqual([]);
  });

  it("refuses a binary file, writing nothing", () => {
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0, 1, 2]);
    expect(unwrapErr(keep({ name: "deck.pdf", stagedPath: stage({ bytes }) })).code).toBe("BINARY");
    expect(attachmentsDir()).toEqual([]);
  });

  it("refuses a credential's name before it opens the staged file", () => {
    expect(unwrapErr(keep({ name: "id_ed25519", stagedPath: join(staged, "absent") })).code).toBe("NAME_INVALID");
    expect(attachmentsDir()).toEqual([]);
  });

  it("never follows a staged symlink", () => {
    const target = join(scratch, "elsewhere.txt");
    writeFileSync(target, "not the owner's choice");
    const link = join(staged, "link");
    symlinkSync(target, link);
    expect(unwrapErr(keep({ name: "notes.txt", stagedPath: link })).code).toBe("STAGED_UNREADABLE");
    expect(attachmentsDir()).toEqual([]);
  });

  it("refuses a staged directory as not a regular file", () => {
    expect(unwrapErr(keep({ name: "notes.txt", stagedPath: staged })).message).toBe(
      `the staged file ${staged} is not a regular file`,
    );
  });

  it("never writes over a kept attachment already holding its id", () => {
    const stagedPath = stage({ bytes: new TextEncoder().encode("first") });
    unwrap(keep({ name: "notes.txt", stagedPath }));
    expect(unwrapErr(keep({ name: "notes.txt", stagedPath })).code).toBe("WRITE_FAILED");
    expect(readFileSync(join(home, "talk", "attachments", ID, "notes.txt"), "utf8")).toBe("first");
  });
});
