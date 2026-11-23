/**
 * What the done-chat sweep counts as done: a run journal's own ending, a settled ask, or a terminal doc — and
 * never any of those while the run is still open or its journal could not be read. Pure; every input is inline.
 */
import { describe, expect, it } from "vitest";

import { parseHandoverDoc } from "../../../../handover/doc.js";
import { type RunEvent, runStateOf } from "../../../../handover/ledger.js";
import { doneEvidenceOf } from "../../../../sessions/closeDone.js";
import { NOW } from "../dispatchFixtures.js";

/** A doc with the given front-matter lines after `slug`/`summary`. */
function doc({ lines }: { lines: readonly string[] }): ReturnType<typeof parseHandoverDoc> {
  const text = ["---", "slug: a-doc", "summary: a thing", ...lines, "---", "", "body"].join("\n");
  return parseHandoverDoc({ path: "/board/a-doc.md", text });
}

const STARTED: RunEvent = { atIso: "2026-09-03T08:00:00.000Z", branch: "a-doc", docHash: "h", kind: "started" };

describe("doneEvidenceOf", () => {
  it("reads a finished run as run-closed", () => {
    const run = runStateOf({
      events: [STARTED, { atIso: "2026-09-03T09:00:00.000Z", kind: "finished", residue: [] }],
    });
    expect(doneEvidenceOf({ doc: undefined, events: [], run })).toEqual({ kind: "run-closed" });
  });

  it("reads an abandoned run as run-closed", () => {
    const run = runStateOf({ events: [STARTED, { atIso: "2026-09-03T09:00:00.000Z", kind: "abandoned", why: "no" }] });
    expect(doneEvidenceOf({ doc: undefined, events: [], run })).toEqual({ kind: "run-closed" });
  });

  it("does NOT read a never-started journal as done, even though its phase is closed", () => {
    const run = runStateOf({ events: [] });
    expect(run.phase).toBe("closed");
    expect(doneEvidenceOf({ doc: doc({ lines: ["status: ready"] }), events: [], run })).toBeUndefined();
  });

  it("keeps an open run open, and one waiting on the owner too", () => {
    expect(doneEvidenceOf({ doc: undefined, events: [], run: runStateOf({ events: [STARTED] }) })).toBeUndefined();
    const waiting = runStateOf({ events: [STARTED, { atIso: NOW, kind: "question", question: "which?" }] });
    expect(doneEvidenceOf({ doc: undefined, events: [], run: waiting })).toBeUndefined();
  });

  it("reads a settled ask with no run as ask-settled", () => {
    const settled = doc({
      lines: ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: https://x/p"],
    });
    expect(doneEvidenceOf({ doc: settled, events: [], run: runStateOf({ events: [] }) })).toEqual({
      kind: "ask-settled",
      settlement: "answered",
    });
  });

  it("never reads a settled ask as done while its run is still open — the workspace:69 defect", () => {
    const settled = doc({
      lines: ["kind: ask", "status: ready", "settlement: answered", "settlementWitness: https://x/p"],
    });
    const open = runStateOf({
      events: [
        STARTED,
        {
          atIso: NOW,
          host: "claude-code",
          kind: "claimed",
          pid: undefined,
          sessionId: "s1",
          worktree: undefined,
          why: "",
        },
      ],
    });
    expect(open.phase).toBe("open");
    expect(doneEvidenceOf({ doc: settled, events: [], run: open })).toBeUndefined();
  });

  it("reads a terminal doc with no run as doc-terminal, and never one with an open run", () => {
    const cancelled = doc({ lines: ["status: cancelled", "statusSummary: not worth it"] });
    expect(doneEvidenceOf({ doc: cancelled, events: [], run: runStateOf({ events: [] }) })).toEqual({
      kind: "doc-terminal",
      status: "cancelled",
    });
    expect(doneEvidenceOf({ doc: cancelled, events: [], run: runStateOf({ events: [STARTED] }) })).toBeUndefined();
  });

  it("answers nothing when the journal could not be read, whatever the doc says", () => {
    const cancelled = doc({ lines: ["status: cancelled", "statusSummary: not worth it"] });
    expect(doneEvidenceOf({ doc: cancelled, events: [], run: undefined })).toBeUndefined();
  });

  it("prefers the run journal's own ending over the doc's settlement", () => {
    const settled = doc({ lines: ["kind: ask", "settlement: filed", "settlementWitness: other-doc"] });
    const run = runStateOf({ events: [STARTED, { atIso: NOW, kind: "finished", residue: [] }] });
    expect(doneEvidenceOf({ doc: settled, events: [], run })).toEqual({ kind: "run-closed" });
  });
});
