/**
 * The `grants` leg of `store import-fleet`, run with no connection — what a dry run projects. The write and the
 * read-back are `integration/grantJournalStore.test.ts`'s.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runGrantLeg } from "../../../../cli/commands/store/importGrantLeg.js";
import { FleetImportErrors } from "../../../../store/fleet/errors.js";

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "import-grant-"));
  homes.push(home);
  return home;
}

const GRANT_LINE = JSON.stringify({
  grant: {
    anchor: "transcript:aaaa#bbbb",
    change: "TIMEOUT = 30",
    changeKind: "literal",
    id: "g-alpha",
    pinnedAtRecord: false,
    recordedAtIso: "2026-10-01T00:00:00.000Z",
    recordedBySessionId: "session-alpha",
    target: { kind: "system", name: "linear" },
  },
  kind: "grant",
});

/** Write the legacy journal under a home, returning its path. */
function journal({ home, text }: { home: string; text: string }): string {
  mkdirSync(join(home, "grants"), { recursive: true });
  const path = join(home, "grants", "journal.jsonl");
  writeFileSync(path, text);
  return path;
}

describe("runGrantLeg", () => {
  it("reports an install with no legacy journal as an absent source, not a failure", async () => {
    const home = freshHome();
    expect(await runGrantLeg({ client: undefined, home })).toEqual({
      absentSource: join(home, "grants", "journal.jsonl"),
      leg: "grants",
      projected: 0,
      refused: [],
      unreadableLines: 0,
      written: 0,
    });
  });

  it("projects every entry line, skipping blank lines and writing nothing on a dry run", async () => {
    const home = freshHome();
    journal({ home, text: `${GRANT_LINE}\n\n${GRANT_LINE}\n` });
    expect(await runGrantLeg({ client: undefined, home })).toEqual({
      absentSource: undefined,
      leg: "grants",
      projected: 2,
      refused: [],
      unreadableLines: 0,
      written: 0,
    });
  });

  it("refuses an unreadable line by its physical number and still projects the rest", async () => {
    const home = freshHome();
    const path = journal({ home, text: `${GRANT_LINE}\n{not json\n` });
    const outcome = await runGrantLeg({ client: undefined, home });
    expect(outcome.projected).toBe(1);
    expect(outcome.refused).toEqual([FleetImportErrors.unreadableLine({ lineNumber: 2, path })]);
  });
});
