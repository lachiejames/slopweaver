/**
 * The `measurements` leg of `store import-fleet`, run dry over a real temp home: every file under the four
 * roots projected, `datadog/` and Finder's folder state left out, and no connection — to the database or to
 * Storage — opened when the client is absent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runMeasurementsLeg } from "../../../../cli/commands/store/importMeasurementsLeg.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "measurements-leg-"));
  homes.push(home);
  return home;
}

/** Write one file under the home, making its directory. */
function put({ home, path, bytes }: { home: string; path: string; bytes: Uint8Array | string }): void {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, bytes);
}

describe("runMeasurementsLeg, dry", () => {
  it("projects every file under the four roots and nothing under datadog/", async () => {
    const home = freshHome();
    put({ bytes: "{}", home, path: "bakeoff/lap1/replies/a.json" });
    put({ bytes: Uint8Array.from([0x89, 0x50, 0xff]), home, path: "datadog-shots/one.png" });
    put({ bytes: "note", home, path: "evidence/sup-3534/deep/note.md" });
    put({ bytes: "gold", home, path: "proof/1263/gold.md" });
    put({ bytes: "x", home, path: "proof/.DS_Store" });
    put({ bytes: "{}", home, path: "datadog/hits.jsonl" });

    const outcome = await runMeasurementsLeg({ client: undefined, home });

    expect(outcome).toEqual({
      absentSource: undefined,
      leg: "measurements",
      projected: 4,
      refused: [],
      unreadableLines: 0,
      written: 0,
    });
  });

  it("reads an empty home as nothing to do", async () => {
    const outcome = await runMeasurementsLeg({ client: undefined, home: freshHome() });

    expect(outcome.projected).toBe(0);
    expect(outcome.refused).toEqual([]);
  });
});
