/**
 * What an attach reads before it plans: the row's bytes as the rewrite starts from them, and the owner's words at the
 * anchor or why they are not attached. The whole attach is `quoteAttach.test.ts`; this pins the reads alone.
 *
 * Per `testing.md`, every fixture is written under a directory this file minted.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rowBytesAsText, wordsToAttach } from "../../../../../cli/commands/handover/quoteAttachRead.js";

const TURN = "a0000015-0000-4000-8000-000000000016";
const ROW = "---\nslug: an-ask\nkind: ask\n---\n\n# body\n";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "quote-attach-read-"));
  mkdirSync(join(home, "projects"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("rowBytesAsText", () => {
  it("reads a regular file as the text it holds", () => {
    const path = join(home, "an-ask.md");
    writeFileSync(path, ROW);

    expect(rowBytesAsText({ path })).toBe(ROW);
  });

  it("refuses a symlink, which the atomic rename would replace rather than write through", () => {
    const real = join(home, "real.md");
    const path = join(home, "an-ask.md");
    writeFileSync(real, ROW);
    symlinkSync(real, path);

    expect(rowBytesAsText({ path })).toEqual({
      refusals: [`${path} is not a regular file inside the board directory, so it is not rewritten`],
    });
  });

  it("refuses a row that is not valid UTF-8, rather than writing U+FFFD over its bytes", () => {
    const path = join(home, "an-ask.md");
    writeFileSync(path, Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0x0a]));

    const read = rowBytesAsText({ path });

    expect(JSON.stringify(read)).toContain("not valid UTF-8");
  });

  it("refuses a row that is not there", () => {
    const path = join(home, "gone.md");

    const read = rowBytesAsText({ path });

    expect(JSON.stringify(read)).toContain(`cannot read ${path}`);
  });
});

describe("wordsToAttach", () => {
  it("refuses an anchor whose words would not read, naming the anchor", () => {
    const anchor = `talk:${TURN}`;

    const words = wordsToAttach({ anchor, home, projectsDir: join(home, "projects") });

    expect(JSON.stringify(words)).toContain(`${anchor} — `);
  });
});
