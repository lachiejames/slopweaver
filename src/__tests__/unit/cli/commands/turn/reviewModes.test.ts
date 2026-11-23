/**
 * The two reading modes, and the import seam that keeps them two.
 *
 * `--poll` and `--close` are proven here only as far as a home with no review on record reaches — booting a
 * real reviewer needs cmux and is proven live. The seam is the part that matters most and is fully checkable
 * from the committed source: twelve reviewer workspaces died once because reading a verdict could
 * reach a teardown, so this file asserts that `reviewPollRun.ts` cannot reach one, against `reviewClose.ts`
 * as the positive control that proves the check is looking in the right place.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runClose } from "../../../../../cli/commands/turn/reviewClose.js";
import { runPoll } from "../../../../../cli/commands/turn/reviewPollRun.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";

const ASK = { channel: "C1", messageTs: "1785000000.000100", threadTs: "1785000000.000100" };

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-review-modes-"));
  dirs.push(home);
  return home;
}

/** Every module specifier one of this verb's own files imports, read off the committed source. */
function importedSpecifiers({ module }: { module: string }): readonly string[] {
  const source = readFileSync(new URL(`../../../../../cli/commands/turn/${module}`, import.meta.url), "utf8");
  return [...source.matchAll(/^import[^;]*?from "([^"]+)";$/gm)].map((match) => match[1]!);
}

describe("the reading modes over a home with no review on record", () => {
  it("refuses a --poll rather than reporting an absent verdict as one still coming", async () => {
    expect(await runPoll({ askIdentity: ASK, home: emptyHome(), wait: { timeoutSeconds: 1, wait: false } })).toBe(
      EXIT_ERROR,
    );
  });

  it("refuses a --close rather than closing something it never found", async () => {
    expect(await runClose({ askIdentity: ASK, home: emptyHome() })).toBe(EXIT_ERROR);
  });
});

describe("the poll/close import seam", () => {
  it("reads real import lines off both modules — the negatives below are evidence only if this holds", () => {
    expect(importedSpecifiers({ module: "reviewPollRun.ts" }).length).toBeGreaterThan(0);
    expect(importedSpecifiers({ module: "reviewClose.ts" }).length).toBeGreaterThan(0);
  });

  it("lets --close reach the reaper, because releasing a workspace is its whole job", () => {
    expect(importedSpecifiers({ module: "reviewClose.ts" })).toContain("./reviewReap.js");
  });

  it("gives --poll no path to a teardown: neither the reaper nor the close mode", () => {
    const pollImports = importedSpecifiers({ module: "reviewPollRun.ts" });
    expect(pollImports).not.toContain("./reviewReap.js");
    expect(pollImports).not.toContain("./reviewClose.js");
  });

  it("keeps the shared leaf free of the reaper, so no future helper there can re-open the path", () => {
    expect(importedSpecifiers({ module: "reviewCommon.ts" })).not.toContain("./reviewReap.js");
  });
});
