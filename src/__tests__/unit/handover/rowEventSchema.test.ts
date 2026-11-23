/**
 * The write path's FIRST enforcement layer: one Zod schema per event kind, checked before anything reaches a
 * journal.
 *
 * The two things worth asserting are not "does Zod work". They are that the schema set COVERS every kind the
 * ledger can decode — a validator silently passing an unknown kind is worse than none, because every caller
 * believes the write was checked — and that it refuses exactly the field shapes `parseLedger` would otherwise
 * coerce into `""` or `0` on the way back out.
 */
import { describe, expect, it } from "vitest";

import { ROW_EVENT_SCHEMAS, rowEventIssues } from "../../../handover/rowEventSchema.js";

const AT = "2026-09-07T10:00:00.000Z";

/** A scene told from outside and closing on no question — two sentences, so exactly those two rules fire. */
const OUTSIDE = "The fleet hit a Datadog error and merged its own fix. It was fine.";

describe("ROW_EVENT_SCHEMAS", () => {
  it("covers every kind the ledger decodes, so no write is silently unchecked", () => {
    // The mapped type already fails to COMPILE on a missing kind; this is the runtime half, and it is what
    // catches a key present with an undefined value.
    const missing = Object.entries(ROW_EVENT_SCHEMAS).filter(([, schema]) => schema === undefined);
    expect(missing).toEqual([]);
    expect(Object.keys(ROW_EVENT_SCHEMAS).length).toBe(35);
  });

  it("accepts a steer-risk naming its standing and why, and refuses another standing or a blank reason", () => {
    const good = {
      atIso: AT,
      kind: "steer-risk",
      standing: "at-risk",
      why: "the deploy needs the owner's GCP sign-in",
    };
    expect(rowEventIssues({ event: good })).toEqual([]);
    expect(rowEventIssues({ event: { ...good, standing: "cleared" } })).toEqual([]);
    expect(rowEventIssues({ event: { ...good, standing: "late" } })).toHaveLength(1);
    expect(rowEventIssues({ event: { ...good, why: " " } })).toHaveLength(1);
  });

  it("accepts a park-cleared naming a whole position and a reason, and refuses a fractional or blank one", () => {
    const good = { atIso: AT, kind: "park-cleared", parkIndex: 2, why: "the ask is settled answered" };
    expect(rowEventIssues({ event: good })).toEqual([]);
    expect(rowEventIssues({ event: { ...good, parkIndex: 1.5 } })).toHaveLength(1);
    expect(rowEventIssues({ event: { ...good, parkIndex: -1 } })).toHaveLength(1);
    expect(rowEventIssues({ event: { ...good, why: " " } })).toHaveLength(1);
  });

  // The schema refuses a scene that breaks the shape rather than journalling it.
  it("accepts a question-examples line with one second-person scene, and refuses one told from outside", () => {
    const good = {
      atIso: AT,
      examples: ["You open the card and see the fleet merged its own fix. Was that right?"],
      kind: "question-examples",
      question: "which base?",
    };
    expect(rowEventIssues({ event: good })).toEqual([]);
    const outside = { ...good, examples: [OUTSIDE] };
    expect(rowEventIssues({ event: outside })).toHaveLength(2);
  });

  // the scene rides the asking line itself, so the same shape binds it there.
  it("accepts a question line carrying its scene, and refuses one whose scene is told from outside", () => {
    const asked = {
      atIso: AT,
      examples: ["You open the card and see the fleet merged its own fix. Was that right?"],
      kind: "question",
      question: "which base?",
    };
    expect(rowEventIssues({ event: asked })).toEqual([]);
    expect(rowEventIssues({ event: { ...asked, examples: [OUTSIDE] } })).toHaveLength(2);
    expect(rowEventIssues({ event: { ...asked, examples: undefined, exampleGap: "a\nb" } })).toHaveLength(1);
    // An explicit empty list declared examples and carried none — the verb's own refusal, not a legacy ask.
    expect(rowEventIssues({ event: { ...asked, examples: [] } })).toHaveLength(1);
  });

  // a correction restates wording and its decoder reads no scene, so it may carry none.
  it("refuses a scene or a gap on a question line that never carries one", () => {
    const corrected = { atIso: AT, kind: "question-corrected", question: "which base?", why: "typo" };
    expect(rowEventIssues({ event: corrected })).toEqual([]);
    expect(rowEventIssues({ event: { ...corrected, examples: [OUTSIDE] } })).toEqual([
      "question-corrected: this line carries no scenes — they ride the asking line itself, or `handover example`",
    ]);
    expect(rowEventIssues({ event: { ...corrected, exampleGap: "no row" } })).toHaveLength(1);
  });

  it("refuses a kind it has never heard of rather than passing it through", () => {
    expect(rowEventIssues({ event: { atIso: AT, kind: "shipped-ish" } })).toEqual([
      '"shipped-ish" is not an event kind this register knows how to write',
    ]);
  });

  it("refuses a value with no kind at all", () => {
    expect(rowEventIssues({ event: { atIso: AT } })).toEqual([
      "the event declares no `kind`, so there is no schema to check it against",
    ]);
  });
});

describe("rowEventIssues", () => {
  it("accepts a parked checkpoint, and refuses one whose screen tail would not fit the row", () => {
    const parked = {
      atIso: AT,
      branch: "card-provenance",
      kind: "parked",
      question: "Which label?",
      screenTail: "❯ ",
      sessionId: "s-1",
      workspaceRef: "workspace:238",
      worktree: "/wt/card-provenance",
    };
    expect(rowEventIssues({ event: parked })).toEqual([]);
    expect(rowEventIssues({ event: { ...parked, screenTail: "x".repeat(10_001) } }).length).toBe(1);
  });

  it("accepts a posted handle with no permalink, and refuses an empty one", () => {
    const posted = {
      atIso: AT,
      channel: "D1",
      kind: "question-posted",
      question: "which base?",
      ts: "1700000000.000100",
    };
    expect(rowEventIssues({ event: posted })).toEqual([]);
    expect(rowEventIssues({ event: { ...posted, permalink: "" } }).length).toBe(1);
  });

  it("accepts a well-formed closed event", () => {
    expect(rowEventIssues({ event: { atIso: AT, kind: "closed", residue: [], summary: "landed in #445" } })).toEqual(
      [],
    );
  });

  it("refuses a closed event whose summary is blank — the statusSummary nobody wrote, one register later", () => {
    const issues = rowEventIssues({ event: { atIso: AT, kind: "closed", residue: [], summary: "   " } });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("summary");
  });

  it("refuses an atIso that does not parse, which orders a journal by nothing", () => {
    const issues = rowEventIssues({ event: { atIso: "last tuesday", kind: "artifact", url: "https://e.invalid/p" } });
    expect(issues).toEqual(["atIso: is not an instant Date.parse can read"]);
  });

  it("refuses an artifact event with a blank url, because a blank would SUPERSEDE a good pointer", () => {
    const issues = rowEventIssues({ event: { atIso: AT, kind: "artifact", url: "" } });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("url");
  });

  it("refuses a launched event that names no session, the field ownership turns on", () => {
    const issues = rowEventIssues({
      event: { atIso: AT, kind: "launched", pid: 42, sessionId: "", worktree: "/w" },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("sessionId");
  });

  it("accepts the absent-but-declared optionals a journal legitimately carries", () => {
    expect(
      rowEventIssues({
        event: { atIso: AT, kind: "launched", pid: undefined, sessionId: "s-1", worktree: undefined },
      }),
    ).toEqual([]);
  });

  it("refuses pid 0, which is a claim about a process rather than an absence", () => {
    const issues = rowEventIssues({
      event: { atIso: AT, kind: "launched", pid: 0, sessionId: "s-1", worktree: undefined },
    });
    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("pid");
  });

  it("keeps an extra field a newer build might write, rather than failing a forward-compatible event", () => {
    expect(
      rowEventIssues({ event: { atIso: AT, futureField: 7, kind: "closed", residue: [], summary: "shipped" } }),
    ).toEqual([]);
  });

  it("reports every broken rule at once rather than the first", () => {
    const issues = rowEventIssues({ event: { atIso: "nope", kind: "closed", residue: [], summary: "" } });
    expect(issues.length).toBe(2);
  });

  it("accepts a live ruling with the owner's words, an anchor and the instant they decided it", () => {
    expect(
      rowEventIssues({ event: { anchor: "p9", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "yes" } }),
    ).toEqual([]);
  });

  it("refuses a NEW ruling with no decidedIso, though the decoder still reads an old line that has none", () => {
    const issues = rowEventIssues({ event: { anchor: "p9", atIso: AT, kind: "ruling", ruling: "yes" } });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("decidedIso");
  });

  it("refuses a ruling with blank words, and one with a blank anchor", () => {
    expect(
      rowEventIssues({ event: { anchor: "p9", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "  " } }).length,
    ).toBe(1);
    expect(
      rowEventIssues({ event: { anchor: "", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "yes" } }).length,
    ).toBe(1);
  });

  it("accepts a reconstruction whose decision instant is its source answer's own", () => {
    expect(
      rowEventIssues({
        event: {
          anchor: "journal:runs/a.jsonl#2026-09-04T12:38:57.414Z",
          atIso: AT,
          backfilledFrom: "2026-09-04T12:38:57.414Z",
          decidedIso: "2026-09-04T12:38:57.414Z",
          kind: "ruling",
          ruling: "OWNER RULED: ship it",
        },
      }),
    ).toEqual([]);
  });

  it("refuses a reconstruction decided at any instant but its source's — that is how one outranks a newer ruling", () => {
    const issues = rowEventIssues({
      event: {
        anchor: "a",
        atIso: AT,
        backfilledFrom: "2026-09-04T12:38:57.414Z",
        decidedIso: AT,
        kind: "ruling",
        ruling: "OWNER RULED: ship it",
      },
    });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("source answer's own instant");
  });

  // An explicit steer overrides the standing rules for its instance, so nothing but the owner's own
  // live word may carry one.
  it("accepts a live explicit steer with or without an instant, and refuses an extra field or a backfilled one", () => {
    const steer = {
      anchor: "p9",
      atIso: AT,
      decidedIso: AT,
      kind: "ruling",
      ruling: "overriding the previous guidance",
    };
    const backfilled = rowEventIssues({
      event: { ...steer, backfilledFrom: AT, explicitSteer: {} },
    });
    expect([
      rowEventIssues({ event: { ...steer, explicitSteer: {} } }),
      rowEventIssues({ event: { ...steer, explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" } } }),
      rowEventIssues({ event: { ...steer, explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z", why: "x" } } })
        .length,
      backfilled,
    ]).toEqual([[], [], 1, [expect.stringContaining("a reconstruction cannot be an explicit steer")]]);
  });

  // A standing session keeps a seat open between the owner's turns, so nothing but the owner's own live word
  // may carry one.
  it("accepts a live standing session with or without a bound, and refuses an extra field or a backfilled one", () => {
    const ruling = { anchor: "talk:p9", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "keep it open for me" };
    const until = "2026-11-17T13:00:00.000Z";
    expect([
      rowEventIssues({ event: { ...ruling, standingSession: {} } }),
      rowEventIssues({ event: { ...ruling, standingSession: { untilIso: until } } }),
      rowEventIssues({ event: { ...ruling, standingSession: { untilIso: until, why: "x" } } }).length,
      rowEventIssues({ event: { ...ruling, backfilledFrom: AT, standingSession: {} } }),
    ]).toEqual([[], [], 1, [expect.stringContaining("a reconstruction cannot make a standing session")]]);
  });

  it("refuses an unparseable decidedIso — a decision time nothing can order is worse than none", () => {
    const issues = rowEventIssues({
      event: { anchor: "p9", atIso: AT, decidedIso: "last tuesday", kind: "ruling", ruling: "yes" },
    });

    expect(issues.length).toBe(1);
    expect(issues[0]).toContain("decidedIso");
  });
});

const SHAPED_QUESTION = {
  atIso: AT,
  kind: "question",
  lean: "main",
  options: [
    { letter: "A", option: "main", tradeoff: "none" },
    { letter: "B", option: "the release branch", tradeoff: "one more rebase" },
  ],
  problem: "the doc names two",
  question: "which base?",
};
const STAKES = {
  blastRadius: "one doc",
  risk: "a run starts on the wrong base",
  stillReal: "the doc still names both",
};

describe("rowEventIssues — the stakes travel whole or not at all", () => {
  it("accepts a shaped question carrying all three stakes", () => {
    expect(rowEventIssues({ event: { ...SHAPED_QUESTION, stakes: STAKES } })).toEqual([]);
  });

  it("refuses stakes missing one field, which the reader would otherwise drop without a word", () => {
    const { stillReal: _dropped, ...partial } = STAKES;
    expect(rowEventIssues({ event: { ...SHAPED_QUESTION, stakes: partial } })).toEqual([
      "stakes.stillReal: Invalid input: expected string, received undefined",
    ]);
  });

  it("refuses stakes on a question with no shape beside them — they describe a decision the line never states", () => {
    expect(rowEventIssues({ event: { atIso: AT, kind: "question", question: "which base?", stakes: STAKES } })).toEqual(
      [
        "question: an ask carries the whole shape or none of it — a problem, two to four options with their " +
          "trade-offs, and a lean",
      ],
    );
  });
});
