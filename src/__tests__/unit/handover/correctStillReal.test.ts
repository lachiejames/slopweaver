/**
 * The still-real line a card publishes, across the two events `handover correct --still-real` writes — read
 * through `publishedStillRealOf`, the one projection both the row and the verb's requirement call.
 *
 * The journal fixture is a real row's shape: a question whose stakes say draft sd-7bb49482 is
 * held, corrected to name sd-695c4598. A correction alone keeps the old check, which is why the verb requires the
 * flag; the reconfirm it writes after the correction, bound to the corrected text, is what moves the line.
 */
import { describe, expect, it } from "vitest";

import { publishedStillRealOf } from "../../../cli/commands/handover/listJsonAsk.js";
import { runDisposition } from "../../../handover/boardTypes.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";

const ASKED_TEXT = "Send the post? The post is draft sd-7bb49482.";
const CORRECTED_TEXT = "Send the post? The post is draft sd-695c4598.";

const STARTED: RunEvent = { atIso: "2026-10-01T09:35:14.203Z", branch: "a-branch", docHash: "h1", kind: "started" };

const ASKED: RunEvent = {
  atIso: "2026-10-01T13:00:47.079Z",
  kind: "question",
  lean: "A",
  options: [
    { letter: "A", option: "close the PR", tradeoff: "rebuilt later" },
    { letter: "B", option: "keep the PR", tradeoff: "sits open" },
  ],
  problem: "the post is parked for your send",
  question: ASKED_TEXT,
  stakes: {
    blastRadius: "one draft PR and one post",
    risk: "a stale draft lingers",
    stillReal: "draft sd-7bb49482 is held and unsent, read at 12:58Z",
  },
};

const CORRECTED: RunEvent = {
  atIso: "2026-10-01T13:25:23.379Z",
  kind: "question-corrected",
  question: CORRECTED_TEXT,
  why: "the draft was re-cut as sd-695c4598",
};

const RECONFIRMED: RunEvent = {
  atIso: "2026-10-01T13:25:23.379Z",
  kind: "question-reconfirmed",
  question: CORRECTED_TEXT,
  stillReal: "draft sd-695c4598 is held and unsent, read at 13:25Z",
};

/** A doc with no registered shape — the run's journal is the only source of a check. */
const BARE_DOC = parseHandoverDoc({
  path: "/h/row.md",
  text: "---\nslug: row\nkind: ask\nstatus: ready\nsummary: a row\n---\n\n# a row\n",
});

/** A doc registered with a full shape and stakes — the fields `handover register` writes into the front matter. */
const STAKED_DOC: typeof BARE_DOC = {
  ...BARE_DOC,
  blastRadius: "one doc",
  lean: "main",
  options: [
    { letter: "A", option: "main", tradeoff: "every other run is on it" },
    { letter: "B", option: "the release branch", tradeoff: "this doc cites it once" },
  ],
  problem: "the doc names two bases",
  risk: "a run starts on the wrong base",
  stillReal: "the doc still cites both branches",
  stillRealIso: "2026-09-22T09:00:00.000Z",
};

/** What the card publishes for a doc and a journal. */
function published({ doc, events }: { doc: typeof BARE_DOC; events: readonly RunEvent[] }) {
  return publishedStillRealOf({ doc, run: runDisposition({ events, unreadableLines: [] }) });
}

describe("publishedStillRealOf over a correction", () => {
  it("publishes the stakes' own check on a question nothing has restated", () => {
    expect(published({ doc: BARE_DOC, events: [STARTED, ASKED] })).toEqual({
      stillReal: "draft sd-7bb49482 is held and unsent, read at 12:58Z",
      stillRealIso: "2026-10-01T13:00:47.079Z",
    });
  });

  it("still publishes the OLD check after a bare correction — the defect the verb's required flag closes", () => {
    expect(published({ doc: BARE_DOC, events: [STARTED, ASKED, CORRECTED] }).stillReal).toBe(
      "draft sd-7bb49482 is held and unsent, read at 12:58Z",
    );
  });

  it("publishes the restated check, at its instant, once the reconfirm bound to the corrected text lands", () => {
    expect(published({ doc: BARE_DOC, events: [STARTED, ASKED, CORRECTED, RECONFIRMED] })).toEqual({
      stillReal: "draft sd-695c4598 is held and unsent, read at 13:25Z",
      stillRealIso: "2026-10-01T13:25:23.379Z",
    });
  });

  it("publishes the DOC's check for a waiting run whose question carries no shape — so correct requires one there too", () => {
    const unshaped: RunEvent = { atIso: "2026-10-01T13:00:00.000Z", kind: "question", question: "Ship it?" };

    expect(published({ doc: STAKED_DOC, events: [STARTED, unshaped] }).stillReal).toBe(
      "the doc still cites both branches",
    );
  });

  it("publishes nothing when neither the run nor the doc carries a check", () => {
    const unshaped: RunEvent = { atIso: "2026-10-01T13:00:00.000Z", kind: "question", question: "Ship it?" };

    expect(published({ doc: BARE_DOC, events: [STARTED, unshaped] })).toEqual({
      stillReal: undefined,
      stillRealIso: undefined,
    });
  });
});
