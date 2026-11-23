/**
 * The `owner-turns` leg of `store import-fleet`, run dry over a real temp home: what it would write, and every
 * file it would refuse named rather than cleaned. No connection is opened when the client is absent.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runOwnerTurnsLeg } from "../../../../cli/commands/store/importOwnerTurnsLeg.js";

const homes: string[] = [];

afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "owner-turns-leg-"));
  homes.push(home);
  return home;
}

/** Write one file under the home, making its directory. */
function put({ home, path, text }: { home: string; path: string; text: string }): void {
  const full = join(home, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

describe("runOwnerTurnsLeg, dry", () => {
  it("projects every owner-turn file under both roots and writes nothing", async () => {
    const home = freshHome();
    put({ home, path: "handovers/archive/owner-turn-1-1.txt", text: "one" });
    put({ home, path: "supervisor-scratch/handoff-9002/owner-turn-2-1.txt", text: "two" });
    put({ home, path: "supervisor-scratch/handoff-9003/owner-turn-2-1.txt", text: "two" });
    put({ home, path: "supervisor-scratch/handoff-9003/tick.md", text: "not theirs" });

    const outcome = await runOwnerTurnsLeg({ client: undefined, home });

    expect(outcome).toEqual({
      absentSource: undefined,
      leg: "owner-turns",
      projected: 3,
      refused: [],
      unreadableLines: 0,
      written: 0,
    });
  });

  it("names a file it cannot store verbatim and still projects the rest", async () => {
    const home = freshHome();
    put({ home, path: "handovers/archive/owner-turn-1-1.txt", text: "a\u0000b" });
    put({ home, path: "handovers/archive/owner-turn-1-2.txt", text: "fine" });

    const outcome = await runOwnerTurnsLeg({ client: undefined, home });

    expect(outcome.projected).toBe(1);
    expect(outcome.refused.map((refusal) => refusal.message)).toEqual([
      "handovers/archive/owner-turn-1-1.txt cannot be stored as an owner turn verbatim: it contains a NUL byte, which a Postgres text column cannot hold",
    ]);
  });

  it("reads an empty home as nothing to do", async () => {
    const outcome = await runOwnerTurnsLeg({ client: undefined, home: freshHome() });

    expect(outcome.projected).toBe(0);
    expect(outcome.refused).toEqual([]);
  });
});
