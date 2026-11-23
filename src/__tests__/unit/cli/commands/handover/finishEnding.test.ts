/**
 * What `handover finish` writes and prints once its gates have passed, over a real journal in a temp runs
 * directory and a logger whose two sinks feed one ordered transcript: a finish appends exactly the `finished`
 * row and prints the close line, the merge reminder and the sign-off line in that order, naming the second
 * party when there is one and the absence when there is not; a second ending on the same cycle is refused in
 * the row writer's own words and appends nothing; and a dry run prints the exact event it would journal and
 * writes nothing at all.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { journalFinished, reportFinishDryRun } from "../../../../../cli/commands/handover/finishEnding.js";
import type { RunContext } from "../../../../../cli/commands/handover/runContextTypes.js";
import { parseHandoverDoc } from "../../../../../handover/doc.js";
import { ledgerLine, parseLedger, type RunEvent, runStateOf } from "../../../../../handover/ledger.js";
import { RowWriteErrors } from "../../../../../handover/rowEventErrors.js";
import { createLogger, type Logger } from "../../../../../lib/logger.js";

const SLUG = "a-row";
const STARTED_AT = "2026-10-01T09:00:00.000Z";
const NOW = "2026-10-01T10:00:00.000Z";
const STARTED: RunEvent = { atIso: STARTED_AT, branch: "feat/a-row", docHash: "abc123", kind: "started" };

let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), "finish-ending-"));
});

afterEach(() => {
  rmSync(runsDir, { force: true, recursive: true });
});

/** A logger whose stderr and stdout lines land in one transcript, each tagged with its stream. */
function transcriptLogger({ lines }: { lines: string[] }): Logger {
  return createLogger({
    outSink: (line) => {
      lines.push(`out: ${line}`);
    },
    sink: (line) => {
      lines.push(`err: ${line}`);
    },
  });
}

/** Seed the journal and resolve the context a finish reads, from the same events. */
function contextOver({ events }: { events: readonly RunEvent[] }): RunContext {
  const journal = events.map((event) => ledgerLine({ event })).join("");
  writeFileSync(join(runsDir, `${SLUG}.jsonl`), journal, "utf8");
  const text = ["---", `slug: ${SLUG}`, "kind: ask", "summary: a row", "status: ready", "---", "", "# a row", ""].join(
    "\n",
  );
  const parsed = parseLedger({ text: journal });
  return {
    commitsAhead: 0,
    computed: undefined,
    doc: parseHandoverDoc({ path: join(runsDir, `${SLUG}.md`), text }),
    events: parsed.events,
    journal,
    results: [],
    run: runStateOf({ events: parsed.events }),
    text,
    unknownKind: parsed.unknownKind,
    unreadable: parsed.unreadable,
  };
}

/** The journal's events as they now stand on disk. */
function journalled(): readonly RunEvent[] {
  return parseLedger({ text: readFileSync(join(runsDir, `${SLUG}.jsonl`), "utf8") }).events;
}

describe("journalFinished", () => {
  it("appends the finished row and prints the close, the merge reminder and the absent sign-off, in order", () => {
    const lines: string[] = [];

    const code = journalFinished({
      context: contextOver({ events: [STARTED] }),
      log: transcriptLogger({ lines }),
      nowIso: NOW,
      residue: [],
      runsDir,
    });

    expect(code).toBe(0);
    expect(journalled()).toEqual([STARTED, { atIso: NOW, kind: "finished", residue: [] }]);
    expect(lines).toEqual([
      "out: handover finish: closed the run for a-row",
      'out:   when the PR merges: slopweaver handover close a-row --summary "<what shipped>"',
      "out:   NOT SIGNED OFF — nobody but this session has vouched for it; `slopweaver handover sign-off` records a second party",
    ]);
  });

  it("names the last second party to sign off, and carries the residue onto the row", () => {
    const lines: string[] = [];
    const signOffs: RunEvent[] = [
      { atIso: "2026-10-01T09:10:00.000Z", by: "reviewer-one", kind: "signed-off", note: "looked" },
      { atIso: "2026-10-01T09:20:00.000Z", by: "reviewer-two", kind: "signed-off", note: "looked again" },
    ];

    const code = journalFinished({
      context: contextOver({ events: [STARTED, ...signOffs] }),
      log: transcriptLogger({ lines }),
      nowIso: NOW,
      residue: ["probe-a"],
      runsDir,
    });

    expect(code).toBe(0);
    expect(journalled()).toEqual([STARTED, ...signOffs, { atIso: NOW, kind: "finished", residue: ["probe-a"] }]);
    expect(lines).toEqual([
      "out: handover finish: closed the run for a-row",
      'out:   when the PR merges: slopweaver handover close a-row --summary "<what shipped>"',
      "out:   signed off by reviewer-two at 2026-10-01T09:20:00.000Z",
    ]);
  });

  it("refuses a second ending on the same cycle with exit 1 and one stderr line, appending nothing", () => {
    const lines: string[] = [];
    const finished: RunEvent = { atIso: "2026-10-01T09:30:00.000Z", kind: "finished", residue: [] };
    const why = `this cycle already ended "finished" at 2026-10-01T09:30:00.000Z; start a new run rather than recording a second ending`;

    const code = journalFinished({
      context: contextOver({ events: [STARTED, finished] }),
      log: transcriptLogger({ lines }),
      nowIso: NOW,
      residue: [],
      runsDir,
    });

    expect(code).toBe(1);
    expect(journalled()).toEqual([STARTED, finished]);
    expect(lines).toEqual([`err: handover finish: refusing to record "finished" on a run that is closed — ${why}`]);
    expect(lines).toEqual([
      `err: handover finish: ${RowWriteErrors.forbiddenTransition({ kind: "finished", phase: "closed", why }).message}`,
    ]);
  });
});

describe("reportFinishDryRun", () => {
  it("prints the exact event a finish would journal and what the dry run did, writing nothing", () => {
    const lines: string[] = [];

    const code = reportFinishDryRun({ log: transcriptLogger({ lines }), nowIso: NOW, residue: [], slug: SLUG });

    expect(code).toBe(0);
    expect(lines).toEqual([
      `out: {\n  "atIso": "${NOW}",\n  "kind": "finished",\n  "residue": []\n}`,
      "out: dry run — nothing was written. every gate passed for a-row; `handover finish` without --dry-run would close the run.",
    ]);
    expect(readdirSync(runsDir, { recursive: true })).toEqual([]);
  });
});
