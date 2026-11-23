/*
 * The chair's report of the cards stopping the owner's work (P0): the registers the Queue reads, through the same
 * readers, `rowsOf` and `withStopping`, so the card the page leads with is the one the chat update names — and a
 * register the route could not read is named too, never counted as "nothing stops".
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { err, ok } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { LiveResult } from "../../lib/liveVerbRun";
import { PlacementOrganisationErrors } from "../../lib/placementOrganisation";
import { queueStoppingReport, type StoppingResults } from "../../lib/queueStoppingReport";
import { ACME_PLACEMENT } from "../organisationFixture";

import { documentWith, linked, withDetail } from "./workstreamTilesFixture";

const AT = "2026-10-19T12:00:00.000Z";

/** The organisation read, as the route hands it over when the row is written. */
const ORGANISATION = ok(ACME_PLACEMENT);

/** The sentence `org show` fails with when no row is written, as the live runner carries it. */
const NO_ORGANISATION =
  "slopweaver org show --json exited 3: no organisation is configured — write it once with `slopweaver org set`";
const FIXTURE = fileURLToPath(new URL("../../fixtures/hand-steps/recipe-stopped.json", import.meta.url));

/** A register the runner read, carrying `payload`. */
function read({ payload }: { payload: unknown }): LiveResult {
  return { observedAtIso: AT, ok: true, payload, stampedByRoute: true };
}

/** A register the runner could not read, for `why`. */
function unread({ why }: { why: string }): LiveResult {
  return { notMeasured: why, observedAtIso: AT, ok: false };
}

/**
 * One ask waiting on the owner, as `handover list --json` publishes it. No anchor: one into a Claude session with no quote
 * stored is withheld by its gate (`queueWithholding.ts`), which is not what these cases are about.
 */
function ask({
  slug,
  blockedBy,
  workstream,
}: {
  slug: string;
  blockedBy?: readonly string[];
  workstream?: string;
}): Record<string, unknown> {
  return {
    kind: "ask",
    ownerWait: "owner",
    priority: "p1",
    question: `Which way on ${slug}?`,
    questionAskedIso: "2026-10-18T08:00:00.000Z",
    reason: "waiting on the owner",
    repo: "/Users/someone/dev/personal/slopweaver",
    section: "WAITING ON OWNER",
    slug,
    status: "waiting-on-owner",
    workspace: "team",
    ...(blockedBy === undefined ? {} : { blockedBy }),
    ...(workstream === undefined ? {} : { tags: [{ key: "workstream", source: "declared", value: workstream }] }),
  };
}

const ISO = withDetail({
  detail: {
    priority: { anchor: "talk-call:a0000024#turn_EXx", because: "the owner's ISO week", level: "urgent" },
    queueWorkstream: "iso-certification",
  },
  row: linked,
});

const RESULTS: StoppingResults = {
  board: read({
    payload: {
      rows: [
        ask({ blockedBy: ["iso-blocker"], slug: "iso-policy", workstream: "iso-certification" }),
        ask({ slug: "iso-blocker" }),
        ask({ slug: "a-colleague-waits" }),
      ],
      unresolved: 0,
    },
  }),
  hands: read({ payload: [JSON.parse(readFileSync(FIXTURE, "utf8")) as unknown] }),
  workstreams: read({ payload: documentWith({ workstreams: [ISO] }) }),
};

describe("queueStoppingReport", () => {
  it("names the focus blocker, then the marked step, in the order the Queue draws them", () => {
    const report = queueStoppingReport({ observedAtIso: AT, organisation: ORGANISATION, results: RESULTS });
    expect([report.complete, report.unread]).toEqual([true, []]);
    expect(report.stopping.map((card) => [card.key.split("-")[0], card.reason, card.kind])).toEqual([
      ["ask:iso", "blocks-focus", "ask"],
      ["hand:mon", "marked", "hand"],
    ]);
    expect(report.stopping[0].question).toBe("Which way on iso-blocker?");
  });

  it("is incomplete, naming the organisation unread with the verb's sentence, and names no card when it did not read", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: err(PlacementOrganisationErrors.readFailed({ notMeasured: NO_ORGANISATION })),
      results: RESULTS,
    });
    expect([report.complete, report.unread, report.stopping]).toEqual([
      false,
      [{ source: "organisation", why: NO_ORGANISATION }],
      [],
    ]);
  });

  it("is incomplete, naming the register, when the outcomes register did not read — and names no focus blocker", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: { ...RESULTS, workstreams: unread({ why: "workstreams list exited 1" }) },
    });
    expect([report.complete, report.unread]).toEqual([
      false,
      [{ source: "workstreams", why: "workstreams list exited 1" }],
    ]);
    expect(report.stopping.map((card) => card.reason)).toEqual(["marked"]);
  });

  it("is complete, with no focus blocker, when the store holds no workstream yet — an answer, not an unread one", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: {
        ...RESULTS,
        workstreams: read({
          payload: { code: "NO_WORKSTREAMS", kind: "expected-empty", why: "no workstreams yet" },
        }),
      },
    });
    expect([report.complete, report.unread]).toEqual([true, []]);
    expect(report.stopping.map((card) => card.reason)).toEqual(["marked"]);
  });

  it("is incomplete when a hand step did not read whole, never 'nothing stops'", () => {
    const malformed = {
      id: "x",
      postedIso: "2026-10-20T00:00:00.000Z",
      stopsWork: false,
      what: "Decide on held automation",
    };
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: { ...RESULTS, hands: read({ payload: [malformed] }) },
    });
    expect([report.complete, report.unread]).toEqual([
      false,
      [
        {
          source: "hands",
          why: "1 step(s) did not read whole (stopsWork), so whether they stop the owner's work is unknown",
        },
      ],
    ]);
  });

  it("is incomplete when a hand line carried no step at all, which the reader drops", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: { ...RESULTS, hands: read({ payload: ["a line"] }) },
    });
    expect([report.complete, report.unread]).toEqual([
      false,
      [{ source: "hands", why: "1 line(s) carried no step to read, so whether they stop the owner's work is unknown" }],
    ]);
  });

  it("is incomplete when the board names a file its scan could not read", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: { ...RESULTS, board: read({ payload: { rows: [], unreadable: ["broken-focus.md"], unresolved: 0 } }) },
    });
    expect([report.complete, report.unread]).toEqual([
      false,
      [
        {
          source: "board",
          why: "1 file(s) did not read (broken-focus.md), so whether they hold a card stopping the owner's work is unknown",
        },
      ],
    ]);
  });

  it("is incomplete when the board's scan left a document unresolved at its deadline", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: { ...RESULTS, board: read({ payload: { rows: [], unresolved: 1 } }) },
    });
    expect([report.complete, report.unread]).toEqual([
      false,
      [
        {
          source: "board",
          why:
            "1 document(s) were not resolved before the scan's deadline, so whether they hold a card stopping the owner's " +
            "work is unknown",
        },
      ],
    ]);
  });

  it("is incomplete and lists nothing when the hands and the board both did not read", () => {
    const report = queueStoppingReport({
      observedAtIso: AT,
      organisation: ORGANISATION,
      results: { ...RESULTS, board: unread({ why: "board timed out" }), hands: unread({ why: "hands exited 1" }) },
    });
    expect([report.complete, report.unread.map((one) => one.source), report.stopping]).toEqual([
      false,
      ["hands", "board"],
      [],
    ]);
  });
});
