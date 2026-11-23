/**
 * Reading an image path into a `data:` URI: the extension decides the MIME (case-insensitively) and is
 * judged BEFORE any read, so an unsupported extension is refused even when no file exists; a supported one
 * that will not read is `FILE_UNREADABLE`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BriefingCommandErrors } from "../../../../../cli/commands/briefing/errors.js";
import { readImageDataUri } from "../../../../../cli/commands/briefing/readImageDataUri.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

/** The eight-byte PNG signature — real image bytes, small enough to spell out. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "imageuri-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("readImageDataUri", () => {
  it("answers a PNG's bytes as an exact image/png data URI", () => {
    const path = join(dir, "shot.png");
    writeFileSync(path, PNG_SIGNATURE);

    const result = readImageDataUri({ path });

    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("resolves an upper-case supported extension to its MIME type", () => {
    const path = join(dir, "SHOT.JPEG");
    writeFileSync(path, Buffer.from("jpeg-ish"));

    expect(unwrap(readImageDataUri({ path }))).toBe(
      `data:image/jpeg;base64,${Buffer.from("jpeg-ish").toString("base64")}`,
    );
  });

  it("refuses an unsupported extension before reading, even when no file is there", () => {
    const path = join(dir, "absent.svg");

    const result = readImageDataUri({ path });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(BriefingCommandErrors.imageExtensionUnsupported({ path }));
  });

  it("answers FILE_UNREADABLE naming the path when a supported image is not there", () => {
    const path = join(dir, "absent.png");

    const failure = unwrapErr(readImageDataUri({ path }));

    expect(failure).toMatchObject({ code: "FILE_UNREADABLE", path });
    expect(failure.message).toContain(`${path}: could not read the file — `);
  });
});
