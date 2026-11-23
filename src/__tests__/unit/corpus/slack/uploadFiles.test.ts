/**
 * `loadSlackUploads` — a real filesystem round-trip (`testing.md` allows this for a genuine fixture), since
 * the whole point is reading real bytes off disk in a stable order.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSlackUploads } from "../../../../corpus/slack/uploadFiles.js";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slop-upload-files-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a fixture file under the temp dir and return its path. */
function file({ contents, name }: { contents: string; name: string }): string {
  const path = join(dir, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

describe("loadSlackUploads", () => {
  it("returns an empty array for no paths, without touching the filesystem", async () => {
    expect(await loadSlackUploads({ paths: [], what: "image" })).toEqual([]);
  });

  it("reads one file's real bytes and basename", async () => {
    const path = file({ contents: "screenshot bytes", name: "shot.png" });

    const uploads = await loadSlackUploads({ paths: [path], what: "image" });

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.filename).toBe("shot.png");
    expect(Buffer.from(uploads[0]!.bytes).toString("utf8")).toBe("screenshot bytes");
  });

  it("reads several files IN THE CALLER'S ORDER, not filesystem order", async () => {
    const second = file({ contents: "b", name: "b.png" });
    const first = file({ contents: "a", name: "a.png" });

    const uploads = await loadSlackUploads({ paths: [second, first], what: "image" });

    expect(uploads.map((upload) => upload.filename)).toEqual(["b.png", "a.png"]);
  });

  it("names the exact unreadable path in its failure, rather than a generic message", async () => {
    const missing = join(dir, "not-there.png");

    await expect(loadSlackUploads({ paths: [missing], what: "image" })).rejects.toThrow(missing);
  });

  it("names the caller's own noun, so a document's failure never claims an image was unreadable", async () => {
    const missing = join(dir, "not-there.md");

    await expect(loadSlackUploads({ paths: [missing], what: "document" })).rejects.toThrow(
      "could not read the document",
    );
  });

  it("fails on the FIRST unreadable path, before reading any that follow it", async () => {
    const missing = join(dir, "not-there.png");
    const after = file({ contents: "never read", name: "after.png" });

    await expect(loadSlackUploads({ paths: [missing, after], what: "image" })).rejects.toThrow(missing);
  });
});
