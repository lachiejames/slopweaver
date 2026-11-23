/**
 * The link vet a console that is not the owner's must pass: every entry under the roots walked, a missing root holding
 * nothing, and a tree too large to vet refused rather than passed.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { homeLinkFault, MAX_VETTED_ENTRIES } from "../../../../../cli/commands/talk/homeLinks.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const tempDir = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sw-home-links-")));
  dirs.push(dir);
  return dir;
};

describe("homeLinkFault", () => {
  it("holds nothing under a root that does not exist yet", () => {
    expect(homeLinkFault({ cap: MAX_VETTED_ENTRIES, roots: [join(tempDir(), "not-yet")] })).toBe(undefined);
  });

  it("walks nested directories of plain files and finds nothing", () => {
    const root = tempDir();
    mkdirSync(join(root, "a", "b"), { recursive: true });
    writeFileSync(join(root, "a", "b", "f"), "x");
    expect(homeLinkFault({ cap: MAX_VETTED_ENTRIES, roots: [root] })).toBe(undefined);
  });

  it("refuses a tree with more entries than the cap rather than passing it unvetted", () => {
    const root = tempDir();
    writeFileSync(join(root, "a"), "");
    writeFileSync(join(root, "b"), "");
    writeFileSync(join(root, "c"), "");
    expect(homeLinkFault({ cap: 2, roots: [root] })).toBe(
      `more than 2 entries under ${root}, too many to vet for links`,
    );
  });
});
