/**
 * `handover settle` over a run whose seat PARKED or released it: nobody holds the cycle, so settle ends it.
 *
 * MEASURED: two incident rows were settled
 * over a parked run and sat under CONTRADICTION for good — the reaper skips a writerless cycle and the NEXT lines
 * named `finish`/`abandon`, which refuse a released run.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { reportRunResidue, type SettledAs } from "../../../../../cli/commands/handover/settleResidueRun.js";
import { EXIT_OK } from "../../../../../cli/exitCodes.js";
import { runDisposition } from "../../../../../handover/boardTypes.js";
import { consistencyOf } from "../../../../../handover/consistency.js";
import { parseLedger } from "../../../../../handover/ledger.js";
import { runJournalPath } from "../../../../../handover/runStore.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const SLUG = "incident-parked-row";
const HOLDER = "seat-session-1";

const STARTED = { atIso: "2026-10-04T20:47:23.229Z", kind: "started" };
const LAUNCHED = {
  atIso: "2026-10-04T20:47:23.229Z",
  kind: "launched",
  pid: 4242,
  sessionId: HOLDER,
  worktree: "/w/incident-parked-row",
};
const QUESTION = { atIso: "2026-10-04T21:30:40.628Z", kind: "question", question: "share the write-up?" };
const PARKED = {
  atIso: "2026-10-04T21:31:15.422Z",
  branch: "incident-parked-row",
  kind: "parked",
  question: "share the write-up?",
  screenTail: "",
  sessionId: HOLDER,
  workspaceRef: "workspace:357",
  worktree: "/w/incident-parked-row",
};

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "settle-released-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function journalPath(): string {
  return runJournalPath({ runsDir: stateHomePaths({ home }).runs, slug: SLUG });
}

function seed({ events }: { events: readonly object[] }): void {
  mkdirSync(stateHomePaths({ home }).runs, { recursive: true });
  writeFileSync(journalPath(), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

function kinds(): readonly string[] {
  return parseLedger({ text: readFileSync(journalPath(), "utf8") }).events.map((event) => event.kind);
}

async function residue({ settled }: { settled: SettledAs }): Promise<{ code: number; lines: readonly string[] }> {
  const lines: string[] = [];
  const code = await reportRunResidue({ home, out: ({ line }) => lines.push(line), settled, slug: SLUG });
  return { code, lines };
}

describe("settle over a PARKED run nobody holds", () => {
  it("ends an answered row's cycle `finished`, so a done row reads consistent", async () => {
    seed({ events: [STARTED, LAUNCHED, QUESTION, PARKED] });

    const result = await residue({ settled: { reason: undefined, settlement: "answered", witness: "sd-054caa4e" } });

    expect(result.code).toBe(EXIT_OK);
    expect(kinds()).toEqual(["started", "launched", "question", "parked", "finished"]);
    const events = parseLedger({ text: readFileSync(journalPath(), "utf8") }).events;
    expect(consistencyOf({ run: runDisposition({ events, unreadableLines: [] }), status: "done" }).kind).toBe(
      "consistent",
    );
    expect(result.lines).toEqual([
      `  The RUN for ${SLUG} was parked or released by session ${HOLDER} at ${PARKED.atIso} and nobody holds`,
      "  it, so no session could follow a NEXT line — settle appended the `finished` ending this settlement",
      "  implies. Nothing is left to reseat.",
    ]);
  });

  it("ends a declined row's cycle `abandoned` naming the settlement, so a rejected row reads consistent", async () => {
    seed({ events: [STARTED, LAUNCHED, QUESTION, PARKED] });

    const result = await residue({
      settled: { reason: "legacy call, used for nothing", settlement: "declined", witness: "talk-call:x#t" },
    });

    expect(result.code).toBe(EXIT_OK);
    const events = parseLedger({ text: readFileSync(journalPath(), "utf8") }).events;
    expect(events.at(-1)).toEqual({
      atIso: events.at(-1)!.atIso,
      kind: "abandoned",
      why: "the row was settled declined (witness: talk-call:x#t) — legacy call, used for nothing",
    });
    expect(consistencyOf({ run: runDisposition({ events, unreadableLines: [] }), status: "rejected" }).kind).toBe(
      "consistent",
    );
  });

  it("leaves a run a live session took back after the park alone, with the ordinary NEXT lines", async () => {
    // Hostless, so liveness is judged by this pid alone — never by the machine's real session registry.
    const retaken = { ...LAUNCHED, atIso: "2026-10-05T00:00:00.000Z", pid: process.pid, sessionId: "reseat-session" };
    seed({ events: [STARTED, LAUNCHED, QUESTION, PARKED, retaken] });

    const result = await residue({ settled: { reason: undefined, settlement: "answered", witness: "w" } });

    expect(result.code).toBe(EXIT_OK);
    expect(kinds()).toEqual(["started", "launched", "question", "parked", "launched"]);
    expect(result.lines).toContain(`  The run is WAITING ON THE OWNER: "share the write-up?"`);
  });
});
