import { describe, expect, it } from "vitest";

import { DoorStoreErrors } from "../../../admit/doorStoreErrors.js";
import { err, ok } from "../../../lib/result.js";
import { collectDevGateFriction, collectPainPointFriction } from "../../../reflect/collect.js";
import { collectDoorHolds, collectFeedbackDrafts } from "../../../reflect/collectArtifacts.js";
import { collectReviewClaimClasses } from "../../../reflect/collectReview.js";
import { collectRunJournalFriction } from "../../../reflect/collectRunJournal.js";
import { EVIDENCE_LINES, inWindow } from "../../../reflect/substrate.js";
import { fakeReader, journalLine, window } from "./substrateFixture.js";

describe("inWindow", () => {
  it("includes both ends", () => {
    expect(inWindow({ tsIso: window.fromIso, window })).toBe(true);
    expect(inWindow({ tsIso: window.toIso, window })).toBe(true);
  });

  it("excludes an instant before the window", () => {
    expect(inWindow({ tsIso: "2026-08-26T23:59:59.999Z", window })).toBe(false);
  });

  it("excludes an instant after the window", () => {
    expect(inWindow({ tsIso: "2026-08-28T00:00:00.001Z", window })).toBe(false);
  });

  it("judges an offset-form instant by the moment it names, not by string order", () => {
    expect(inWindow({ tsIso: "2026-08-27T23:30:00-02:00", window })).toBe(false);
    expect(inWindow({ tsIso: "2026-08-28T01:00:00+02:00", window })).toBe(true);
  });

  it("places a timestamp naming no instant outside every window", () => {
    expect(inWindow({ tsIso: "2026-08-27T12:00:00", window })).toBe(false);
    expect(inWindow({ tsIso: "08/27/2026", window })).toBe(false);
    expect(inWindow({ tsIso: "", window })).toBe(false);
  });

  it("refuses an impossible calendar date that Date.parse would roll into the window", () => {
    const march = { fromIso: "2026-03-02T00:00:00.000Z", toIso: "2026-03-03T00:00:00.000Z" };
    expect(inWindow({ tsIso: "2026-02-30T12:00:00Z", window: march })).toBe(false);
    expect(inWindow({ tsIso: "2026-03-02T24:00:00Z", window: march })).toBe(false);
    expect(inWindow({ tsIso: "2026-03-02T12:00:00Z", window: march })).toBe(true);
  });
});
describe("collectRunJournalFriction", () => {
  const amendment = ({ atIso, why }: { atIso: string; why: string }) => journalLine({ atIso, kind: "amended", why });

  it("merges two differently-worded reports of one defect into a single finding", () => {
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": amendment({
          atIso: "2026-08-27T01:00:00.000Z",
          why: "the doneWhen probe spelled a vitest flag that does not exist (--filter)",
        }),
        "/runs/beta.jsonl": amendment({
          atIso: "2026-08-27T02:00:00.000Z",
          why: "doneWhen probe used vitest's non-existent --filter flag; fixed to the positional form",
        }),
      },
    });
    const reading = collectRunJournalFriction({ reader, runsDir: "/runs", window });
    expect(reading.findings).toHaveLength(1);
    expect(reading.findings[0]!.classKey).toBe("donewhen-probe-named-a-flag-that-does-not-exist");
    expect(reading.findings[0]!.occurrences).toBe(2);
    expect(reading.findings[0]!.source).toBe("run-journal");
    expect(reading.findings[0]!.summary).toBe(
      "2 brief amendments the miner filed under class donewhen-probe-named-a-flag-that-does-not-exist",
    );
  });

  it("counts a duplicate abandonment as a second journal line, never a second run ended", () => {
    const line = ({ atIso }: { atIso: string }) => journalLine({ atIso, kind: "abandoned", why: "superseded" });
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": [
          JSON.stringify({ atIso: "2026-08-27T01:00:00.000Z", branch: "b", docHash: "h", kind: "started" }),
          line({ atIso: "2026-08-27T02:00:00.000Z" }),
          line({ atIso: "2026-08-27T03:00:00.000Z" }),
        ].join("\n"),
      },
    });
    const finding = collectRunJournalFriction({ reader, runsDir: "/runs", window }).findings[0]!;
    expect([finding.summary, finding.consequence]).toStrictEqual([
      "2 journal lines recording handover abandoned the miner filed under class superseded",
      "1 run was abandoned unfinished for a reason the miner filed under this class — that work was dropped",
    ]);
  });

  it("counts a byte-identical question line as a second question to the owner, as the board's fold counts it", () => {
    const ask = JSON.stringify({ atIso: "2026-08-27T01:00:00.000Z", kind: "question", question: "which PR?" });
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": [
          JSON.stringify({ atIso: "2026-08-27T00:30:00.000Z", branch: "b", docHash: "h", kind: "started" }),
          ask,
          ask,
          JSON.stringify({ answer: "the first", atIso: "2026-08-27T02:00:00.000Z", kind: "answered" }),
        ].join("\n"),
      },
    });
    const finding = collectRunJournalFriction({ reader, runsDir: "/runs", window }).findings[0]!;
    expect([finding.occurrences, finding.consequence]).toStrictEqual([
      2,
      "Work sat waiting on your answer for 1.0h across 2 questions; the longest wait was 1.0h",
    ]);
  });

  it("spans the window's own bounds and ignores what fell outside them", () => {
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": [
          amendment({ atIso: "2026-08-26T01:00:00.000Z", why: "doneWhen probe used the --filter flag" }),
          amendment({ atIso: "2026-08-27T03:00:00.000Z", why: "doneWhen probe used the --filter flag" }),
          amendment({ atIso: "2026-08-27T09:00:00.000Z", why: "doneWhen probe used the --filter flag" }),
        ].join("\n"),
      },
    });
    const reading = collectRunJournalFriction({ reader, runsDir: "/runs", window });
    expect(reading.findings[0]!.occurrences).toBe(2);
    expect(reading.findings[0]!.firstSeenIso).toBe("2026-08-27T03:00:00.000Z");
    expect(reading.findings[0]!.lastSeenIso).toBe("2026-08-27T09:00:00.000Z");
  });

  it("keeps an ending in its own locus rather than folding it in with an amendment", () => {
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": journalLine({
          atIso: "2026-08-27T01:00:00.000Z",
          kind: "abandoned",
          why: "the corpus watermark had already advanced past the channel",
        }),
      },
    });
    expect(collectRunJournalFriction({ reader, runsDir: "/runs", window }).findings[0]!.locus).toBe(
      "handover abandoned",
    );
  });

  it("reports a line that did not decode as residue rather than dropping it", () => {
    const reader = fakeReader({ files: { "/runs/alpha.jsonl": "{not json" } });
    const reading = collectRunJournalFriction({ reader, runsDir: "/runs", window });
    expect(reading.residue).toHaveLength(1);
    expect(reading.residue[0]).toContain("did not decode");
  });

  it("finds a run whose probes never passed", () => {
    const probe = ({ atIso }: { atIso: string }) => JSON.stringify({ atIso, failed: 3, kind: "probed", passed: 0 });
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": [
          probe({ atIso: "2026-08-27T01:00:00.000Z" }),
          probe({ atIso: "2026-08-27T05:00:00.000Z" }),
        ].join("\n"),
      },
    });
    const reading = collectRunJournalFriction({ reader, runsDir: "/runs", window });
    expect(reading.findings[0]!.classKey).toBe("probes-never-passed");
    expect(reading.findings[0]!.summary).toBe(
      "1 run journal recorded probe snapshots in this window in which nothing ever passed — the doc's probes may not describe the work",
    );
  });

  it("names two never-passing journals' docs in the plural", () => {
    const probe = ({ atIso }: { atIso: string }) => JSON.stringify({ atIso, failed: 3, kind: "probed", passed: 0 });
    const both = [probe({ atIso: "2026-08-27T01:00:00.000Z" }), probe({ atIso: "2026-08-27T05:00:00.000Z" })].join(
      "\n",
    );
    const reader = fakeReader({ files: { "/runs/alpha.jsonl": both, "/runs/beta.jsonl": both } });
    const reading = collectRunJournalFriction({ reader, runsDir: "/runs", window });
    expect(reading.findings[0]!.summary).toBe(
      "2 run journals recorded probe snapshots in this window in which nothing ever passed — those docs' probes may not describe the work",
    );
  });

  it("does not call a run stuck when one of its snapshots passed", () => {
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": [
          JSON.stringify({ atIso: "2026-08-27T01:00:00.000Z", failed: 3, kind: "probed", passed: 0 }),
          JSON.stringify({ atIso: "2026-08-27T05:00:00.000Z", failed: 0, kind: "probed", passed: 3 }),
        ].join("\n"),
      },
    });
    expect(collectRunJournalFriction({ reader, runsDir: "/runs", window }).findings).toStrictEqual([]);
  });

  it("reads an absent runs directory as a quiet day, not a broken one", () => {
    const reading = collectRunJournalFriction({ reader: fakeReader({ files: {} }), runsDir: "/runs", window });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.rowsRead).toBe(0);
  });

  it("folds two unrelated free-worded amendments into one other class rather than minting a singleton each", () => {
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": amendment({
          atIso: "2026-08-27T01:00:00.000Z",
          why: "wrote the four TLDRs to a durable artifact and linked it, so the deliverable survives",
        }),
        "/runs/beta.jsonl": amendment({
          atIso: "2026-08-27T02:00:00.000Z",
          why: "fixed the plan's landing order after Codex flagged a missing phase boundary",
        }),
      },
    });
    const reading = collectRunJournalFriction({ reader, runsDir: "/runs", window });
    expect(reading.findings).toHaveLength(1);
    expect(reading.findings[0]!.classKey).toBe("other-amendment-reason");
    expect(reading.findings[0]!.occurrences).toBe(2);
  });

  it("keeps a named amendment class apart from the other bucket", () => {
    const reader = fakeReader({
      files: {
        "/runs/alpha.jsonl": [
          amendment({ atIso: "2026-08-27T01:00:00.000Z", why: "owner ruling arrived mid-run, scope unchanged" }),
          amendment({ atIso: "2026-08-27T02:00:00.000Z", why: "wrote the plan, no reusable words here at all" }),
        ].join("\n"),
      },
    });
    const findings = collectRunJournalFriction({ reader, runsDir: "/runs", window }).findings;
    expect(findings.map((one) => one.classKey).toSorted()).toStrictEqual([
      "other-amendment-reason",
      "owner-ruling-arrived-mid-run",
    ]);
  });

  it("bounds the evidence it carries", () => {
    const files = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `/runs/run-${String(index)}.jsonl`,
        amendment({ atIso: "2026-08-27T01:00:00.000Z", why: `doneWhen --filter probe number ${String(index)}` }),
      ]),
    );
    const reading = collectRunJournalFriction({ reader: fakeReader({ files }), runsDir: "/runs", window });
    expect(reading.findings[0]!.occurrences).toBe(9);
    expect(reading.findings[0]!.evidence).toHaveLength(EVIDENCE_LINES);
  });
});

describe("collectReviewClaimClasses", () => {
  const verdict = ({ claims, outcome = "broken" }: { claims: readonly string[]; outcome?: string }) =>
    JSON.stringify({
      claims: claims.map((text) => ({ evidence: "looked", impact: "high", support: "unsupported", text })),
      outcome,
    });

  it("names a check that only appeared in a late round", () => {
    const reader = fakeReader({
      files: {
        "/reviews/ask-one/verdict-superseded-A-2026-08-27T01-00-00-000Z.json": verdict({ claims: ["the lead holds"] }),
        "/reviews/ask-one/verdict-superseded-B-2026-08-27T02-00-00-000Z.json": verdict({
          claims: ["the lead holds", "the answer tags the asker"],
        }),
      },
    });
    const reading = collectReviewClaimClasses({ reader, reviewsDir: "/reviews", window });
    const late = reading.findings.find((one) => one.classKey === "a-check-first-performed-in-a-late-review-round")!;
    expect(late.occurrences).toBe(1);
    expect(late.evidence[0]).toContain("the answer tags the asker");
    expect(late.summary).toContain(
      "1 review check was first performed in a later review round rather than in round one — a check the packet does not carry",
    );
  });

  it("collapses many late checks into ONE class rather than one finding each", () => {
    const reader = fakeReader({
      files: {
        "/reviews/ask-one/verdict-superseded-A-2026-08-27T01-00-00-000Z.json": verdict({ claims: ["first"] }),
        "/reviews/ask-one/verdict-superseded-B-2026-08-27T02-00-00-000Z.json": verdict({
          claims: ["alpha check", "beta check", "gamma check"],
        }),
      },
    });
    const late = collectReviewClaimClasses({ reader, reviewsDir: "/reviews", window }).findings.filter(
      (one) => one.classKey === "a-check-first-performed-in-a-late-review-round",
    );
    expect(late).toHaveLength(1);
    expect(late[0]!.occurrences).toBe(3);
    expect(late[0]!.summary).toContain(
      "3 review checks were first performed in a later review round rather than in round one — each is a check the packet does not carry",
    );
  });

  it("finds a claim class left unresolved across two different asks", () => {
    const shared = verdict({ claims: ["the answer obeys every voice rule above"] });
    const reader = fakeReader({
      files: {
        "/reviews/ask-one/verdict-superseded-A-2026-08-27T01-00-00-000Z.json": shared,
        "/reviews/ask-two/verdict-superseded-A-2026-08-27T02-00-00-000Z.json": shared,
      },
    });
    const repeated = collectReviewClaimClasses({ reader, reviewsDir: "/reviews", window }).findings.find(
      (one) => one.locus === "turn review claims",
    )!;
    expect(repeated.occurrences).toBe(1);
    expect(repeated.evidence[0]).toContain("2 asks carried");
  });

  it("ignores a claim the reviewer supported", () => {
    const supported = JSON.stringify({
      claims: [{ evidence: "checked", impact: "high", support: "supported", text: "the answer is fine" }],
      outcome: "clean",
    });
    const reader = fakeReader({
      files: {
        "/reviews/ask-one/verdict-superseded-A-2026-08-27T01-00-00-000Z.json": supported,
        "/reviews/ask-two/verdict-superseded-A-2026-08-27T02-00-00-000Z.json": supported,
      },
    });
    expect(
      collectReviewClaimClasses({ reader, reviewsDir: "/reviews", window }).findings.filter(
        (one) => one.locus === "turn review claims",
      ),
    ).toStrictEqual([]);
  });

  it("names an ask that needed three or more rounds", () => {
    const files = Object.fromEntries(
      ["01", "02", "03"].map((hour) => [
        `/reviews/ask-one/verdict-superseded-${hour}-2026-08-27T${hour}-00-00-000Z.json`,
        verdict({ claims: ["same"] }),
      ]),
    );
    const rounds = collectReviewClaimClasses({
      reader: fakeReader({ files }),
      reviewsDir: "/reviews",
      window,
    }).findings.find((one) => one.classKey === "review-rounds-repeat-on-one-ask")!;
    expect(rounds.evidence[0]).toContain("3 rounds");
  });

  it("dates a current verdict from the ask's own record when the filename carries no instant", () => {
    const reader = fakeReader({
      files: {
        "/reviews/ask-one/record.json": JSON.stringify({ spawnedAt: "2026-08-27T04:00:00.000Z" }),
        "/reviews/ask-one/verdict.json": verdict({ claims: ["one"] }),
      },
    });
    expect(collectReviewClaimClasses({ reader, reviewsDir: "/reviews", window }).rowsRead).toBe(1);
  });

  it("says so when no verdict fell inside the window", () => {
    const reading = collectReviewClaimClasses({ reader: fakeReader({ files: {} }), reviewsDir: "/reviews", window });
    expect(reading.residue[0]).toContain("no review verdict fell inside the window");
  });
});

describe("collectDevGateFriction", () => {
  const gate = ({ check, status, summary, tsIso }: { check: string; status: string; summary: string; tsIso: string }) =>
    JSON.stringify({ check, status, summary, tsIso });

  it("groups repeated failures of one check into one finding", () => {
    const text = [
      gate({ check: "pr-format", status: "fail", summary: "no PR body provided", tsIso: "2026-08-27T01:00:00.000Z" }),
      gate({ check: "pr-format", status: "fail", summary: "no PR body provided", tsIso: "2026-08-27T02:00:00.000Z" }),
      gate({ check: "pr-format", status: "pass", summary: "fine", tsIso: "2026-08-27T03:00:00.000Z" }),
    ].join("\n");
    const reading = collectDevGateFriction({
      ledgerPath: "/ledgers/dev-gate.jsonl",
      reader: fakeReader({ files: { "/ledgers/dev-gate.jsonl": text } }),
      window,
    });
    expect(reading.findings).toHaveLength(1);
    expect(reading.findings[0]!.occurrences).toBe(2);
    expect(reading.findings[0]!.locus).toBe("dev-gate pr-format");
  });

  it("reads an absent ledger as unknown, not clean", () => {
    const reading = collectDevGateFriction({
      ledgerPath: "/ledgers/dev-gate.jsonl",
      reader: fakeReader({ files: {} }),
      window,
    });
    expect(reading.residue[0]).toContain("unknown, not clean");
  });
});

describe("collectPainPointFriction", () => {
  it("groups repeats of one voice rule under its lane", () => {
    const line = ({ tsIso }: { tsIso: string }) =>
      JSON.stringify({
        fieldPath: "body.line[1]",
        kind: "voice",
        lane: "as-me",
        reason: 'matched the word "honestly"',
        tsIso,
      });
    const reading = collectPainPointFriction({
      ledgerPath: "/ledgers/pain-points.jsonl",
      reader: fakeReader({
        files: {
          "/ledgers/pain-points.jsonl": [
            line({ tsIso: "2026-08-27T01:00:00.000Z" }),
            line({ tsIso: "2026-08-27T02:00:00.000Z" }),
          ].join("\n"),
        },
      }),
      window,
    });
    expect(reading.findings).toHaveLength(1);
    expect(reading.findings[0]!.locus).toBe("compose as-me");
    expect(reading.findings[0]!.occurrences).toBe(2);
  });
});

describe("collectFeedbackDrafts", () => {
  const draft = ({ created, title, type = "bug" }: { created: string; title: string; type?: string }) =>
    JSON.stringify({ created_at: created, title, type });

  it("collapses every fresh draft into one finding, with the titles as evidence", () => {
    const reading = collectFeedbackDrafts({
      draftsDir: "/drafts",
      reader: fakeReader({
        files: {
          "/drafts/a.json": draft({ created: "2026-08-27T01:00:00.000Z", title: "first thing" }),
          "/drafts/b.json": draft({ created: "2026-08-27T02:00:00.000Z", title: "second thing" }),
        },
      }),
      window,
    });
    expect(reading.findings).toHaveLength(1);
    expect(reading.findings[0]!.occurrences).toBe(2);
    expect(reading.findings[0]!.evidence).toHaveLength(2);
    // Only what the files show: on disk, never "nothing reads them".
    expect(reading.findings[0]!.summary).toContain(
      "2 SendFeedback drafts were written in this window and are still on disk",
    );
  });

  it("names an older pile separately, because it is a standing finding rather than today's", () => {
    const reading = collectFeedbackDrafts({
      draftsDir: "/drafts",
      reader: fakeReader({
        files: {
          "/drafts/a.json": draft({ created: "2026-08-01T01:00:00.000Z", title: "an old one" }),
          "/drafts/b.json": draft({ created: "2026-08-27T02:00:00.000Z", title: "a new one" }),
        },
      }),
      window,
    });
    expect(reading.findings.map((one) => one.classKey).toSorted()).toStrictEqual([
      "feedback-drafts-older-than-the-window-and-unread",
      "feedback-drafts-written-and-unread",
    ]);
  });

  it("never calls a draft dated after the window older than it", () => {
    const reading = collectFeedbackDrafts({
      draftsDir: "/drafts",
      reader: fakeReader({
        files: { "/drafts/a.json": draft({ created: "2026-08-29T00:00:00.000Z", title: "later" }) },
      }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
  });

  it("says an undated draft's age is unknown rather than calling it older than the window", () => {
    const reading = collectFeedbackDrafts({
      draftsDir: "/drafts",
      reader: fakeReader({ files: { "/drafts/a.json": draft({ created: "", title: "undated" }) } }),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([
      "feedback draft a.json carries no readable created_at, so whether it predates this window is unknown",
    ]);
  });

  it("says one older draft in the singular", () => {
    const reading = collectFeedbackDrafts({
      draftsDir: "/drafts",
      reader: fakeReader({ files: { "/drafts/a.json": draft({ created: "2026-08-01T01:00:00.000Z", title: "old" }) } }),
      window,
    });
    expect(reading.findings[0]!.summary).toBe("1 SendFeedback draft older than this window is still on disk");
  });

  it("reports a draft that is not valid JSON rather than skipping it silently", () => {
    const reading = collectFeedbackDrafts({
      draftsDir: "/drafts",
      reader: fakeReader({ files: { "/drafts/a.json": "{half" } }),
      window,
    });
    expect(reading.residue[0]).toContain("not valid JSON");
  });
});
describe("collectDoorHolds", () => {
  it("reads an empty window as no findings and no residue", () => {
    const reading = collectDoorHolds({ friction: ok([]), window });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toStrictEqual([]);
    expect(reading.rowsRead).toBe(0);
  });

  it("folds a hold into a finding", () => {
    const reading = collectDoorHolds({
      friction: ok([{ action: "verb:slack.send", overridden: [], status: "hold", tsIso: "2026-08-27T01:00:00.000Z" }]),
      window,
    });
    expect(reading.findings.map((one) => one.locus)).toStrictEqual(["door verb:slack.send"]);
    expect(reading.rowsRead).toBe(1);
  });

  it("names an override even when the row otherwise passed", () => {
    const reading = collectDoorHolds({
      friction: ok([
        { action: "verb:github.merge", overridden: ["voice"], status: "pass", tsIso: "2026-08-27T01:00:00.000Z" },
      ]),
      window,
    });
    expect(reading.findings[0]!.evidence[0]).toContain("overridden: voice");
  });

  it("drops a row outside the window and a plain pass the store should not have answered", () => {
    const reading = collectDoorHolds({
      friction: ok([
        { action: "a", overridden: [], status: "hold", tsIso: "2026-08-29T01:00:00.000Z" },
        { action: "b", overridden: [], status: "pass", tsIso: "2026-08-27T02:00:00.000Z" },
      ]),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
  });

  it("names a store that could not be read as residue, never an empty reading", () => {
    const reading = collectDoorHolds({
      friction: err(DoorStoreErrors.storeUnavailable({ doing: "be opened", reason: "fixture: down" })),
      window,
    });
    expect(reading.findings).toStrictEqual([]);
    expect(reading.residue).toHaveLength(1);
    expect(reading.residue[0]).toContain("the door's holds and overrides could not be read");
  });
});
