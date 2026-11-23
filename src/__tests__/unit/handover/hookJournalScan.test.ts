/**
 * The run hooks' journal pre-pass over a REAL runs directory larger than the cap: the run this session holds is
 * examined however late its slug sorts, the rest go newest first, and what was left out is counted.
 *
 * MEASURED before the fix: the hooks examined `slugsWithJournals(...).slice(0, 24)`, the first 24 slugs
 * ALPHABETICALLY, so the regression below — 30 journals, this session's run named `zz-…` — examined `run-00`
 * to `run-23` and never saw it, reporting no skip at all.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../handover/doc.js";
import {
  heldBySession,
  journalReadBuffer,
  MAX_JOURNAL_BYTES,
  PRE_PARSE_BYTE_BUDGET,
  readJournalBounded,
  selectHookJournals,
  sessionNeedle,
} from "../../../handover/hookJournalScan.js";
import { type RunScanSeams, runsOnDisk } from "../../../handover/hookShell.js";
import { ledgerLine } from "../../../handover/ledger.js";
import { measured } from "../../../measurement/status.js";

const AT = "2026-08-04T00:00:00.000Z";
const MINE = "session-mine";
const THEIRS = "session-theirs";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** An empty runs directory, removed after the test. */
function emptyRunsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-rank-"));
  fixtureDirs.push(dir);
  return dir;
}

/** Write one journal and pin its mtime, so recency never depends on the real clock or write order. */
function writeJournal({
  dir,
  slug,
  text,
  mtimeSeconds,
}: {
  dir: string;
  slug: string;
  text: string;
  mtimeSeconds: number;
}): void {
  const path = join(dir, `${slug}.jsonl`);
  writeFileSync(path, text, "utf8");
  utimesSync(path, mtimeSeconds, mtimeSeconds);
}

const started = ledgerLine({ event: { atIso: AT, branch: "feat/x", docHash: "h", kind: "started" } });

/** A `launched` line naming its writer — the line that makes a run a session's own. */
const launchedBy = ({ sessionId }: { sessionId: string }): string =>
  ledgerLine({
    event: { atIso: AT, host: "claude-code", kind: "launched", pid: 4242, sessionId, worktree: "/wt" },
  });

/** A run the session started and still holds. */
const heldBy = ({ sessionId }: { sessionId: string }): string => started + launchedBy({ sessionId });

/** A run the session started and then RELEASED — it still mentions the session, but no longer belongs to it. */
const releasedBy = ({ sessionId }: { sessionId: string }): string =>
  heldBy({ sessionId }) + ledgerLine({ event: { atIso: AT, kind: "released", sessionId, why: "parked" } });

/** Thirty journals: `run-00`…`run-28` held by a neighbour, oldest first alphabetically, and this session's `zz-mine`. */
function thirtyJournals(): string {
  const dir = emptyRunsDir();
  for (let index = 0; index < 29; index += 1) {
    const slug = `run-${String(index).padStart(2, "0")}`;
    writeJournal({ dir, mtimeSeconds: 1_000 + index, slug, text: heldBy({ sessionId: THEIRS }) });
  }
  // The OLDEST journal on disk, and the last slug alphabetically: neither order would ever reach it.
  writeJournal({ dir, mtimeSeconds: 10, slug: "zz-mine", text: heldBy({ sessionId: MINE }) });
  return dir;
}

/** Inert seams: nothing resolves, nothing is evaluated, every session reads live. */
const inertSeams = ({ sessionId }: { sessionId: string | undefined }): RunScanSeams => ({
  branchHead: () => undefined,
  codexThread: () => ({ kind: "not-observed", why: "no Codex process holds this thread" }),
  commandSessionIds: [],
  evaluate: () => [],
  nowMs: Date.parse("2026-08-06T03:00:00.000Z"),
  processAlive: () => true,
  sessionId,
  sessionLive: () => measured({ value: true }),
});

describe("runsOnDisk over a runs directory larger than the cap", () => {
  it("examines the run this session holds however it sorts, and counts the six left out", () => {
    const dir = thirtyJournals();
    const doc = parseHandoverDoc({ path: "/h/zz-mine.md", text: "---\nslug: zz-mine\nstatus: ready\n---\n" });

    const scan = runsOnDisk({ boardPartial: false, docs: [doc], runsDir: dir, seams: inertSeams({ sessionId: MINE }) });
    const slugs = scan.runs.map((run) => run.slug);

    expect(slugs.length).toBe(24);
    expect(slugs[0]).toBe("zz-mine");
    expect(scan.runs[0]!.ownership.kind).toBe("mine");
    expect(scan.journals).toEqual({ cap: 24, skippedBeyondCap: 6, skippedUnavailable: 0 });
    // Newest first after it: the six oldest neighbours are the ones left out, never the alphabetically last.
    expect(slugs.slice(1, 3)).toEqual(["run-28", "run-27"]);
    expect(slugs.includes("run-00")).toBe(false);
    expect(slugs.includes("run-05")).toBe(false);
    expect(slugs.includes("run-06")).toBe(true);
  });

  it("is not crowded out by two dozen newer runs this session RELEASED, which still mention it (r1 review)", () => {
    const dir = emptyRunsDir();
    for (let index = 0; index < 24; index += 1) {
      const slug = `released-${String(index).padStart(2, "0")}`;
      writeJournal({ dir, mtimeSeconds: 100 + index, slug, text: releasedBy({ sessionId: MINE }) });
    }
    writeJournal({ dir, mtimeSeconds: 1, slug: "held", text: heldBy({ sessionId: MINE }) });

    const scan = runsOnDisk({ boardPartial: false, docs: [], runsDir: dir, seams: inertSeams({ sessionId: MINE }) });

    expect(scan.runs[0]!.slug).toBe("held");
    expect(scan.runs[0]!.ownership.kind).toBe("mine");
    expect(scan.runs[1]!.ownership.kind).toBe("released");
    expect(scan.journals.skippedBeyondCap).toBe(1);
  });

  it("ranks purely by recency for an unidentified session, so its oldest journal is the one skipped", () => {
    const dir = thirtyJournals();

    const scan = runsOnDisk({
      boardPartial: false,
      docs: [],
      runsDir: dir,
      seams: inertSeams({ sessionId: undefined }),
    });

    expect(scan.runs.map((run) => run.slug).includes("zz-mine")).toBe(false);
    expect(scan.journals.skippedBeyondCap).toBe(6);
  });
});

describe("selectHookJournals", () => {
  it("holds the session only as a whole `sessionId` property — never a longer id, never another field", () => {
    const dir = emptyRunsDir();
    writeJournal({ dir, mtimeSeconds: 30, slug: "longer-id", text: heldBy({ sessionId: `${MINE}-2` }) });
    writeJournal({ dir, mtimeSeconds: 20, slug: "other-field", text: `${started}{"kind":"said","text":"${MINE}"}\n` });
    writeJournal({ dir, mtimeSeconds: 10, slug: "mine", text: heldBy({ sessionId: MINE }) });

    expect(selectHookJournals({ runsDir: dir, sessionId: MINE }).slugs).toEqual(["mine", "longer-id", "other-field"]);
  });

  it("finds a held run whose line is spaced by hand, not as `ledgerLine` writes it", () => {
    const dir = emptyRunsDir();
    const spaced = started + launchedBy({ sessionId: MINE }).replace('"sessionId":', '"sessionId": ');
    writeJournal({ dir, mtimeSeconds: 20, slug: "newer", text: heldBy({ sessionId: THEIRS }) });
    writeJournal({ dir, mtimeSeconds: 10, slug: "spaced", text: spaced });

    expect(spaced.includes('"sessionId": "')).toBe(true);
    expect(selectHookJournals({ runsDir: dir, sessionId: MINE }).slugs).toEqual(["spaced", "newer"]);
  });

  it("ranks a mentioning journal past the parse budget as unverified, above the ones it proved not held", () => {
    const dir = emptyRunsDir();
    // Each journal names the session, then pads with an undecodable line to near the per-journal bound, so the
    // budget is spent after eight of them; the ninth, the OLDEST, is never parsed.
    const padded = `${launchedBy({ sessionId: MINE })}${"x".repeat(MAX_JOURNAL_BYTES - 200)}\n`;
    const count = Math.floor(PRE_PARSE_BYTE_BUDGET / padded.length) + 1;
    for (let index = 0; index < count; index += 1) {
      writeJournal({ dir, mtimeSeconds: 100 + index, slug: `padded-${String(index)}`, text: padded });
    }

    const selection = selectHookJournals({ runsDir: dir, sessionId: MINE });

    expect(count).toBe(9);
    expect(selection.slugs[0]).toBe("padded-0");
    expect(selection.slugs[1]).toBe("padded-8");
  });

  it("counts an oversized journal as unavailable, without spending one of the cap's slots", () => {
    const dir = emptyRunsDir();
    writeJournal({ dir, mtimeSeconds: 20, slug: "huge", text: "x".repeat(MAX_JOURNAL_BYTES + 1) });
    writeJournal({ dir, mtimeSeconds: 10, slug: "small", text: started });

    const selection = selectHookJournals({ runsDir: dir, sessionId: MINE });

    expect(selection).toEqual({ slugs: ["small"], summary: { cap: 24, skippedBeyondCap: 0, skippedUnavailable: 1 } });
  });

  it("counts a journal that is not a file as unavailable rather than throwing", () => {
    const dir = emptyRunsDir();
    mkdirSync(join(dir, "not-a-file.jsonl"));

    expect(selectHookJournals({ runsDir: dir, sessionId: MINE }).summary.skippedUnavailable).toBe(1);
  });

  it("is empty, skipping nothing, for a runs directory that does not exist", () => {
    expect(selectHookJournals({ runsDir: "/nope/never/here", sessionId: MINE })).toEqual({
      slugs: [],
      summary: { cap: 24, skippedBeyondCap: 0, skippedUnavailable: 0 },
    });
  });
});

describe("readJournalBounded", () => {
  it("parses a journal exactly at the bound, through the shared buffer", () => {
    const dir = emptyRunsDir();
    const text = started + "\n".repeat(MAX_JOURNAL_BYTES - Buffer.byteLength(started));
    writeJournal({ dir, mtimeSeconds: 10, slug: "edge", text });

    const ledger = readJournalBounded({ buffer: journalReadBuffer(), runsDir: dir, slug: "edge" })!;

    expect(ledger.events.map((event) => event.kind)).toEqual(["started"]);
    expect(ledger.unreadable).toEqual([]);
  });

  it("refuses a journal one byte past the bound, a directory, a missing file and an unsafe slug", () => {
    const dir = emptyRunsDir();
    writeJournal({ dir, mtimeSeconds: 10, slug: "huge", text: "x".repeat(MAX_JOURNAL_BYTES + 1) });
    mkdirSync(join(dir, "not-a-file.jsonl"));
    const slugs = ["huge", "not-a-file", "absent", "../escape"];

    expect(slugs.map((slug) => readJournalBounded({ buffer: journalReadBuffer(), runsDir: dir, slug }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("allocates one byte past the bound, so a journal that grew after its stat fills the extra byte", () => {
    expect(journalReadBuffer().length).toBe(MAX_JOURNAL_BYTES + 1);
  });
});

describe("heldBySession", () => {
  it("is true for a run the session launched and holds", () => {
    expect(heldBySession({ sessionId: MINE, text: heldBy({ sessionId: MINE }) })).toBe(true);
  });

  it("is false once the session released it, and for a neighbour's run", () => {
    expect(heldBySession({ sessionId: MINE, text: releasedBy({ sessionId: MINE }) })).toBe(false);
    expect(heldBySession({ sessionId: MINE, text: heldBy({ sessionId: THEIRS }) })).toBe(false);
  });

  it("proves nothing over a journal with an undecodable line", () => {
    expect(heldBySession({ sessionId: MINE, text: `${heldBy({ sessionId: MINE })}not json\n` })).toBe(false);
  });
});

describe("sessionNeedle", () => {
  it("is the id as a quoted JSON string, closing quote included, so a longer id never matches", () => {
    expect(sessionNeedle({ sessionId: MINE })!.toString("utf8")).toBe(`"${MINE}"`);
    expect(launchedBy({ sessionId: `${MINE}-2` }).includes(`"${MINE}"`)).toBe(false);
  });

  it("is absent for an unidentified session, which nothing can mention", () => {
    expect(sessionNeedle({ sessionId: undefined })).toBe(undefined);
  });
});
