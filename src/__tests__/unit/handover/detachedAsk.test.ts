/**
 * The pure half of `handover list`'s journal sweep: which journals no board doc claims, whether one holds a question
 * for the owner, and what is known about its doc.
 */
import { describe, expect, it } from "vitest";

import { detachedDocOf, unclaimedJournalSlugs, waitingAskOf } from "../../../handover/detachedAsk.js";
import type { RunEvent } from "../../../handover/ledger.js";

const STARTED: RunEvent = { atIso: "2026-10-08T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" };
const ASKED: RunEvent = { atIso: "2026-10-08T01:00:00.000Z", kind: "question", question: "Ship it?" };

describe("unclaimedJournalSlugs", () => {
  it("keeps only unclaimed journals, in name order, and sets aside names no slug could have", () => {
    const result = unclaimedJournalSlugs({
      claimed: new Set(["claimed"]),
      names: ["zeta.jsonl", "claimed.jsonl", "notes.txt", "alpha.jsonl", "Bad Name.jsonl"],
    });

    expect(result).toEqual({ slugs: ["alpha", "zeta"], unusable: ["Bad Name.jsonl"] });
  });

  it("leaves a journal a live doc claims alone even when its name is no safe slug", () => {
    expect(unclaimedJournalSlugs({ claimed: new Set(["Bad Name"]), names: ["Bad Name.jsonl"] })).toEqual({
      slugs: [],
      unusable: [],
    });
  });

  it("finds nothing in an empty listing", () => {
    expect(unclaimedJournalSlugs({ claimed: new Set(), names: [] })).toEqual({ slugs: [], unusable: [] });
  });
});

describe("waitingAskOf", () => {
  it("reads the question and its instant off a run waiting on the owner", () => {
    expect(waitingAskOf({ evidence: { events: [STARTED, ASKED], unreadableLines: [] } })).toEqual({
      askedIso: "2026-10-08T01:00:00.000Z",
      kind: "waiting",
      question: "Ship it?",
    });
  });

  it("is not waiting once the question is answered or the run has ended", () => {
    const answered: RunEvent = { answer: "yes", atIso: "2026-10-08T02:00:00.000Z", kind: "answered" };
    const abandoned: RunEvent = { atIso: "2026-10-08T02:00:00.000Z", kind: "abandoned", why: "superseded" };

    expect(waitingAskOf({ evidence: { events: [STARTED, ASKED, answered], unreadableLines: [] } })).toEqual({
      kind: "not-waiting",
    });
    expect(waitingAskOf({ evidence: { events: [STARTED, ASKED, abandoned], unreadableLines: [] } })).toEqual({
      kind: "not-waiting",
    });
  });

  it("refuses to classify a journal with an undecodable line, even one whose readable lines ask", () => {
    const result = waitingAskOf({ evidence: { events: [STARTED, ASKED], unreadableLines: [3] } });

    expect(result.kind).toBe("unreadable");
  });
});

describe("detachedDocOf", () => {
  it("is missing only when no lookup failed and every board and archived doc read", () => {
    expect(detachedDocOf({ lookupError: undefined, unreadableDocs: [] })).toEqual({ kind: "missing" });
  });

  it("carries the lookup's own error when a file or the archive listing would not read", () => {
    expect(detachedDocOf({ lookupError: "front matter will not parse", unreadableDocs: [] })).toEqual({
      kind: "unreadable",
      why: "front matter will not parse",
    });
  });

  it("is unreadable when any board or archived doc would not read, since that doc could carry this slug", () => {
    expect(detachedDocOf({ lookupError: undefined, unreadableDocs: ["a.md", "archive/b.md"] })).toEqual({
      kind: "unreadable",
      why:
        "2 doc(s) on the board or in its archive would not read (a.md, archive/b.md), so none can be shown not " +
        "to carry this slug",
    });
  });
});
