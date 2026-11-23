import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { FigureLoadErrors, figuresBeside } from "../../../policy/render/figures.js";

describe("figuresBeside", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "figures-"));
    mkdirSync(join(dir, "evidence"));
    writeFileSync(join(dir, "evidence", "one.png"), new Uint8Array([1, 2, 3]));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it("reads a figure by the path the markdown wrote, relative to the markdown file", () => {
    const load = figuresBeside({ file: join(dir, "policy.md") });
    expect([...unwrap(load({ source: "evidence/one.png" }))]).toStrictEqual([1, 2, 3]);
  });

  it("refuses a URL without fetching it", () => {
    const load = figuresBeside({ file: join(dir, "policy.md") });
    expect(unwrapErr(load({ source: "https://example.com/a.png" }))).toStrictEqual(
      FigureLoadErrors.isUrl({ source: "https://example.com/a.png" }),
    );
  });

  it("names the resolved path of a figure that is not there", () => {
    const load = figuresBeside({ file: join(dir, "policy.md") });
    expect(unwrapErr(load({ source: "evidence/missing.png" }))).toStrictEqual(
      FigureLoadErrors.unreadable({ path: join(dir, "evidence", "missing.png") }),
    );
  });
});
