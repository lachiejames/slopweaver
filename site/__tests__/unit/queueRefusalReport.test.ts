/*
 * The chair's report of the Queue cards a gate withheld: the registers the Queue reads, through the same
 * readers, `rowsOf` and the withholding split, so a card the page holds back is a card the report names — and a
 * register the route could not read is named too, never counted as zero.
 */

import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { LiveResult } from "../../lib/liveVerbRun";
import { PlacementOrganisationErrors } from "../../lib/placementOrganisation";
import { queueRefusalReport, queueRefusalsOf, type RefusalResults } from "../../lib/queueRefusalReport";
import { ACME_PLACEMENT } from "../organisationFixture";

const AT = "2026-10-09T06:00:00.000Z";

/** The organisation read, as the route hands it over when the row is written. */
const ORGANISATION = ok(ACME_PLACEMENT);

/** The sentence `org show` fails with when no row is written, as the live runner carries it. */
const NO_ORGANISATION =
  "slopweaver org show --json exited 3: no organisation is configured — write it once with `slopweaver org set`";

/** A register the runner read, carrying `payload`. */
function read({ payload }: { payload: unknown }): LiveResult {
  return { observedAtIso: AT, ok: true, payload, stampedByRoute: true };
}

/** A register the runner could not read, for `why`. */
function unread({ why }: { why: string }): LiveResult {
  return { notMeasured: why, observedAtIso: AT, ok: false };
}

/** One held as-me post in a listed document, under `id`, parked for `why` — `queueWithholding.test.ts`'s shape. */
function held({ id, why }: { id: string; why: string }): unknown {
  return {
    draft: {
      advisory: [],
      authorId: "U0SYN000001",
      channel: "C0SYN000001",
      channelName: "ask-product-help",
      digest: "3f2a9c11d4e5b6a7",
      mentions: [],
      payload: { text: "hey team, a few customers might still be getting charged full price while holding a credit" },
      shape: "top-level",
      tsIso: "2026-10-09T01:29:37.485Z",
      why,
    },
    id,
    release: { command: `slopweaver slack post --as me --draft ${id} --approve 3f2a9c11d4e5b6a7`, kind: "send" },
    state: "held",
  };
}

/** The incident's post: its why names its source call by id, which the machine-id gate refuses. */
const INCIDENT = held({ id: "sd-e523766e", why: "recut on the owner's word (talk-call efe7b241): a top-level ask" });
const CLEAN = held({
  id: "sd-39f8a0e2",
  why: "the payments team's intake channel, owner unknown so the team is tagged",
});

const POSTS = {
  items: [INCIDENT, CLEAN],
  people: [{ bot: false, handle: "ada", name: "Ada Owner", nativeId: "U0SYN000001" }],
};

/** The machine-id gate's own sentence for the incident's post. */
const MACHINE_ID_WHY =
  "This card's what names a session, call, talk, turn or run by its machine id, so it is refused rather than " +
  "drawn. A card names it by what it was doing, with the id behind a link or a hover at most.";

/** Every register read, each empty but the posts. */
const ALL_READ: RefusalResults = {
  board: read({ payload: { rows: [], unresolved: 0 } }),
  drafts: read({ payload: { items: [] } }),
  hands: read({ payload: [] }),
  landing: read({
    payload: {
      by: "tick-4",
      document: { residue: [], rows: [], tally: { byAction: [], ready: 0, total: 0 } },
      observedAtIso: AT,
      readingId: "rd-1",
      recordedAtIso: AT,
    },
  }),
  posts: read({ payload: POSTS }),
  reviewers: read({ payload: { observedAtIso: AT, people: {}, readingId: "rd-1", registerAsks: 0, rows: [] } }),
  reviews: read({ payload: { items: [] } }),
  imports: read({ payload: { observedAtIso: AT, questions: [] } }),
};

/**
 * One staged conflict as `store import-questions --json` publishes it, its imported line carrying `imported`.
 *
 * @returns the published question
 */
function conflict({ imported }: { imported: string }): Record<string, unknown> {
  return {
    actions: ["keep-current", "take-imported"],
    batchId: "00000000-0000-4000-8000-0000000000b2",
    current: "acme-ask-7: review ABC-1 before Friday",
    imported,
    key: "acme-ask-7",
    kind: "conflict",
    part: "standing-asks",
    questionId: "import-q-00000000000000b2",
    stagedAtIso: "2026-10-09T05:00:00.000Z",
  };
}

describe("queueRefusalsOf", () => {
  it("names the incident's post, withheld by the machine-id gate, and reads every register", () => {
    const { unread: missing, withheld } = queueRefusalsOf({ organisation: ORGANISATION, results: ALL_READ });
    expect(missing).toEqual([]);
    expect(withheld.map((row) => [row.key, row.kind, row.title, row.why])).toEqual([
      ["post:sd-e523766e", "post", "Post this as you?", MACHINE_ID_WHY],
    ]);
  });

  it("names the organisation unread, with the verb's own sentence, and places no card against a stand-in", () => {
    const { unread: missing, withheld } = queueRefusalsOf({
      organisation: err(PlacementOrganisationErrors.readFailed({ notMeasured: NO_ORGANISATION })),
      results: ALL_READ,
    });
    // The posts register read and holds the incident's post, so an empty list here is the organisation's doing.
    expect(queueRefusalsOf({ organisation: ORGANISATION, results: ALL_READ }).withheld.length).toBe(1);
    expect(missing).toEqual([{ source: "organisation", why: NO_ORGANISATION }]);
    expect(withheld).toEqual([]);
  });

  it("names each register that did not read, why, and still lists what the rest yielded as a lower bound", () => {
    const { unread: missing, withheld } = queueRefusalsOf({
      organisation: ORGANISATION,
      results: {
        ...ALL_READ,
        board: unread({ why: "slopweaver handover list --json timed out after 90000ms" }),
        landing: read({ payload: { by: "tick-4" } }),
      },
    });
    expect(missing).toEqual([
      { source: "board", why: "slopweaver handover list --json timed out after 90000ms" },
      { source: "landing-reading", why: "landing-reading answered in a shape the Queue does not read" },
    ]);
    expect(withheld.map((row) => row.key)).toEqual(["post:sd-e523766e"]);
  });

  it("never reads an unread register as zero: every one is named when none read", () => {
    const down = unread({ why: "the console server did not answer" });
    const { unread: missing, withheld } = queueRefusalsOf({
      organisation: ORGANISATION,
      results: {
        board: down,
        drafts: down,
        hands: down,
        landing: down,
        posts: down,
        reviewers: down,
        reviews: down,
        imports: down,
      },
    });
    expect(missing.map((one) => one.source)).toEqual([
      "hands",
      "board",
      "drafts",
      "slack-drafts",
      "review-drafts",
      "import-questions",
      "landing-reading",
      "reviewers",
    ]);
    expect(withheld).toEqual([]);
  });

  it("names the import questions unread when one question will not read, never as zero", () => {
    const malformed = { ...conflict({ imported: "acme-ask-7: review ABC-1 before Thursday" }), part: "x" };
    const { unread: missing } = queueRefusalsOf({
      organisation: ORGANISATION,
      results: { ...ALL_READ, imports: read({ payload: { observedAtIso: AT, questions: [malformed] } }) },
    });
    expect(missing).toEqual([
      { source: "import-questions", why: "import-questions answered in a shape the Queue does not read" },
    ]);
  });

  it("never withholds an import question whose staged line carries a machine id: the card hides the id and draws", () => {
    const carrying = conflict({ imported: "acme-ask-7: as agreed on talk 0a1b2c3d" });
    expect(carrying["imported"]).toBe("acme-ask-7: as agreed on talk 0a1b2c3d");
    const { unread: missing, withheld } = queueRefusalsOf({
      organisation: ORGANISATION,
      results: { ...ALL_READ, imports: read({ payload: { observedAtIso: AT, questions: [carrying] } }) },
    });
    expect(missing).toEqual([]);
    expect(withheld.map((row) => [row.key, row.kind, row.why])).toEqual([["post:sd-e523766e", "post", MACHINE_ID_WHY]]);
  });
});

describe("queueRefusalReport", () => {
  it("is complete when every register read, naming each withheld card by key, kind, title and the gate's sentence", () => {
    const { unread: missing, withheld } = queueRefusalsOf({ organisation: ORGANISATION, results: ALL_READ });
    expect(queueRefusalReport({ observedAtIso: AT, unread: missing, withheld })).toEqual({
      complete: true,
      observedAtIso: AT,
      unread: [],
      withheld: [{ key: "post:sd-e523766e", kind: "post", title: "Post this as you?", why: MACHINE_ID_WHY }],
    });
  });

  it("is incomplete whenever a register went unread, keeping the known withheld cards", () => {
    const missing = [{ source: "board", why: "timed out" }];
    const { withheld } = queueRefusalsOf({ organisation: ORGANISATION, results: ALL_READ });
    const report = queueRefusalReport({ observedAtIso: AT, unread: missing, withheld });
    expect([report.complete, report.unread, report.withheld.map((row) => row.key)]).toEqual([
      false,
      [{ source: "board", why: "timed out" }],
      ["post:sd-e523766e"],
    ]);
  });

  it("is a complete zero only when every register read and nothing was withheld", () => {
    expect(queueRefusalReport({ observedAtIso: AT, unread: [], withheld: [] })).toEqual({
      complete: true,
      observedAtIso: AT,
      unread: [],
      withheld: [],
    });
  });
});
