/**
 * `readStatusEvidence` — the three sources `codex status` reads before judging anything, and that an outage of
 * either store-backed one stops the verb rather than reading as empty.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readStatusEvidence } from "../../../../../cli/commands/codex/statusEvidence.js";
import { EXIT_ERROR } from "../../../../../cli/exitCodes.js";
import { memoryFallbackRegisterPort, unavailableFallbackRegisterPort } from "../../../../fallbackRegisterFixture.js";
import { memorySupersessionPort, unavailableSupersessionPort } from "../../../../landingRegistersFixture.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with nothing recorded in it. */
function emptyHome(): string {
  const home = mkdtempSync(join(tmpdir(), "status-evidence-"));
  dirs.push(home);
  return home;
}

describe("readStatusEvidence", () => {
  it("reads all three sources over an empty home as empty, not as a failure", async () => {
    const evidence = await readStatusEvidence({
      fallbackPort: memoryFallbackRegisterPort(),
      home: emptyHome(),
      supersessions: memorySupersessionPort(),
    });
    expect(evidence).not.toBe(EXIT_ERROR);
    const read = evidence as Exclude<typeof evidence, number>;
    expect(read.retired.size).toBe(0);
    expect(read.scan.records).toEqual([]);
    expect(read.receipts.receipts).toEqual([]);
  });

  it("stops with EXIT_ERROR when the supersession register cannot be read", async () => {
    const evidence = await readStatusEvidence({
      fallbackPort: memoryFallbackRegisterPort(),
      home: emptyHome(),
      supersessions: unavailableSupersessionPort(),
    });
    expect(evidence).toBe(EXIT_ERROR);
  });

  it("stops with EXIT_ERROR when the fallback receipts cannot be read", async () => {
    const evidence = await readStatusEvidence({
      fallbackPort: unavailableFallbackRegisterPort(),
      home: emptyHome(),
      supersessions: memorySupersessionPort(),
    });
    expect(evidence).toBe(EXIT_ERROR);
  });
});
