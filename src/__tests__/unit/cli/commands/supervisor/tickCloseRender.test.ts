/**
 * The refused page a refused close names is written into the tick's own directory, never `--out` and never
 * anywhere else, and not at all once the directory was swapped under the close.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { writeRefusedPages } from "../../../../../cli/commands/supervisor/tickCloseRender.js";
import { directoryIdentity } from "../../../../../cli/commands/supervisor/tickFiles.js";
import { unwrapErr } from "../../../../../lib/result.js";

let root = "";

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A fresh tick directory and the identity the close would have read for it. */
function tick(): { tickDir: string; identity: string } {
  root = mkdtempSync(join(tmpdir(), "refused-"));
  const tickDir = join(root, "tick-1");
  mkdirSync(tickDir);
  return { identity: directoryIdentity({ path: tickDir })!, tickDir };
}

describe("writeRefusedPages", () => {
  it("writes the refused page inside the tick directory, and neither --out nor a page outside it", () => {
    const { tickDir, identity } = tick();
    const out = join(tickDir, "page.fragment.html");
    const refused = join(tickDir, "page.fragment.refused.html");
    const elsewhere = join(root, "stray.html");
    const pages = new Map([
      [out, "<p>checked</p>"],
      [refused, "<p>refused</p>"],
      [elsewhere, "<p>stray</p>"],
    ]);

    const result = writeRefusedPages({ out, pages, tickDir, tickDirIdentity: identity });

    expect(result.isOk()).toBe(true);
    expect(readFileSync(refused, "utf8")).toBe("<p>refused</p>");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(elsewhere)).toBe(false);
  });

  it("refuses, writing nothing, when the tick directory was replaced after the close read it", () => {
    const { tickDir, identity } = tick();
    renameSync(tickDir, join(root, "moved"));
    mkdirSync(tickDir);
    const refused = join(tickDir, "page.fragment.refused.html");

    const result = writeRefusedPages({
      out: join(tickDir, "page.fragment.html"),
      pages: new Map([[refused, "<p>refused</p>"]]),
      tickDir,
      tickDirIdentity: identity,
    });

    expect(unwrapErr(result).code).toBe("CAPTURE_INVALID");
    expect(existsSync(refused)).toBe(false);
  });
});
