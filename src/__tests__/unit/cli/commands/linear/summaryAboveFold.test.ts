/**
 * `summaryAboveFoldRefused` — the one above-the-fold wrapper the three summary-only Linear writes share. The
 * gate itself is proven in `../github/aboveFoldGate.test.ts`; this pins what the wrapper threads to it: the
 * `linear` surface, the dry-run flag, the named home and the door ledger a refusal is recorded through.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { summaryAboveFoldRefused } from "../../../../../cli/commands/linear/summaryAboveFold.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A temp state home carrying one exact voice rule: the em dash. */
function seededHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-linear-fold-"));
  homes.push(home);
  writeFileSync(
    join(home, "profile.json"),
    JSON.stringify({
      displayName: "Ada Owner",
      gitNamespace: "ada-gh",
      id: "owner-1",
      schemaVersion: 1,
      slackMe: { userId: "U_OWNER", voice: { exact: [{ kind: "literal", value: "—" }] } },
      sources: ["linear"],
    }),
    "utf8",
  );
  return home;
}

/** Run the wrapper over one summary cell, collecting what it printed. */
async function gate({ dryRun, text }: { dryRun: boolean; text: string }): Promise<{
  door: ReturnType<typeof memoryDoorLedger>;
  lines: string[];
  refused: boolean;
}> {
  const door = memoryDoorLedger();
  const lines: string[] = [];
  const refused = await summaryAboveFoldRefused({
    args: { dryRun, home: seededHome() },
    cells: [{ path: "artifact.summary", text }],
    deps: { doorLedger: door.port, env: () => undefined, out: (line) => lines.push(line) },
  });
  return { door, lines, refused };
}

describe("summaryAboveFoldRefused", () => {
  it("refuses a summary breaking a voice rule and records ONE refusal row under the named home", async () => {
    const { door, lines, refused } = await gate({ dryRun: false, text: "Fast — and safe." });
    expect(refused).toBe(true);
    expect(lines[0]).toContain("refused: ");
    expect(door.records().map((record) => [record["status"], record["action"]])).toStrictEqual([
      ["refused", "gate:above-the-fold-voice"],
    ]);
  });

  it("admits a clean summary and writes no row", async () => {
    const { door, lines, refused } = await gate({ dryRun: false, text: "Fast and safe." });
    expect(refused).toBe(false);
    expect(lines).toStrictEqual([]);
    expect(door.store.rows).toStrictEqual([]);
  });

  it("reports rather than records on a dry run", async () => {
    const { door, lines } = await gate({ dryRun: true, text: "Fast — and safe." });
    expect(lines[0]).toContain("above-the-fold gate: REFUSES this body");
    expect(door.store.rows).toStrictEqual([]);
  });
});
