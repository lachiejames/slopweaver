/**
 * A question asked after its ask row was settled: the refusal `handover ask` gives, and the board-wide finding over
 * rows composed the way `handover list` composes them.
 */
import { describe, expect, it } from "vitest";

import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import {
  askOnSettledRowRefusal,
  SETTLED_ASK_CHECK,
  settleCanLandOn,
  settledThenAskedLines,
  settledThenAskedOf,
} from "../../../handover/settledAsk.js";

const SETTLED_ISO = "2026-10-08T02:00:00.000Z";
const STARTED: RunEvent = { atIso: "2026-10-08T00:00:00.000Z", branch: "b", docHash: "h", kind: "started" };

/** An ask row, parsed as the board scan would, with any extra front-matter lines. */
function askRow({ slug, extra = [] }: { slug: string; extra?: readonly string[] }): HandoverDoc {
  const text = ["---", `slug: ${slug}`, "kind: ask", `summary: ${slug} row`, "status: ready", ...extra, "---", ""];
  return parseHandoverDoc({ path: `/h/${slug}.md`, text: text.join("\n") });
}

/** The settlement lines `handover settle` writes; `settledIso` is the line's value, `null` to omit the line. */
function settledLines({ settledIso = SETTLED_ISO }: { settledIso?: string | null } = {}): readonly string[] {
  const at = settledIso === null ? [] : [`settledIso: ${settledIso}`];
  return ["settlement: answered", "settlementWitness: https://example.test/pr/1", ...at];
}

/** One row composed over a journal that asked one question at `askedIso`, then any `after` events. */
function modelOf({
  doc,
  askedIso,
  after = [],
}: {
  doc: HandoverDoc;
  askedIso: string;
  after?: readonly RunEvent[];
}): BoardModel {
  const asked: RunEvent = { atIso: askedIso, kind: "question", question: "Ship it?" };
  return composeBoardModels({
    journals: new Map([[doc.slug, { events: [STARTED, asked, ...after], unreadableLines: [] }]]),
    probeStates: new Map(),
    resolutionDocs: [doc],
    roots: [doc],
  })[0]!;
}

describe("askOnSettledRowRefusal", () => {
  it("refuses an ask on a settled row, naming the settlement and its witness", () => {
    const lines = askOnSettledRowRefusal({ doc: askRow({ extra: settledLines(), slug: "done-ask" }) })!;

    expect(lines[0]).toBe(
      "done-ask is an ask row already settled answered (witness: https://example.test/pr/1), so a question recorded on",
    );
    expect(lines.join("\n")).toContain("Nothing was\n  recorded.");
    expect(lines.at(-1)).toContain("slopweaver handover register --ask");
  });

  it("lets an ask on an unsettled row through", () => {
    expect(askOnSettledRowRefusal({ doc: askRow({ slug: "open-ask" }) })).toBeUndefined();
  });

  it("lets an ask on a doc row through, whatever it carries", () => {
    const text = ["---", "slug: a-doc", "kind: doc", "summary: a doc", "status: ready", ...settledLines(), "---", ""];
    const doc = parseHandoverDoc({ path: "/h/a-doc.md", text: text.join("\n") });

    expect(askOnSettledRowRefusal({ doc })).toBeUndefined();
  });
});

describe("settleCanLandOn", () => {
  it("holds for an ask row, the one kind a settle can land on mid-ask", () => {
    expect(settleCanLandOn({ doc: askRow({ slug: "open-ask" }) })).toBe(true);
  });

  it("does not hold for a doc row, so its ask takes no lock", () => {
    const text = ["---", "slug: a-doc", "kind: doc", "summary: a doc", "status: ready", "---", ""];
    const doc = parseHandoverDoc({ path: "/h/a-doc.md", text: text.join("\n") });

    expect(settleCanLandOn({ doc })).toBe(false);
  });

  it("is the lock condition of the check `handover ask` makes, beside the settled-row refusal", () => {
    expect(SETTLED_ASK_CHECK).toEqual({ lockWhen: settleCanLandOn, refusal: askOnSettledRowRefusal });
  });
});

describe("settledThenAskedOf", () => {
  it("finds a settled row whose question was asked after the settlement", () => {
    const doc = askRow({ extra: settledLines(), slug: "late-ask" });

    expect(settledThenAskedOf({ models: [modelOf({ askedIso: "2026-10-08T03:00:00.000Z", doc })] })).toEqual([
      {
        askedIso: "2026-10-08T03:00:00.000Z",
        order: "after",
        question: "Ship it?",
        settledIso: SETTLED_ISO,
        settlement: "answered",
        slug: "late-ask",
      },
    ]);
  });

  it("leaves out a question asked before the settlement, which the settlement answered", () => {
    const doc = askRow({ extra: settledLines(), slug: "early-ask" });

    expect(settledThenAskedOf({ models: [modelOf({ askedIso: "2026-10-08T01:00:00.000Z", doc })] })).toEqual([]);
  });

  it("names a question asked at the settlement's own instant as unordered, since either write may have come first", () => {
    const doc = askRow({ extra: settledLines(), slug: "same-instant" });
    const rows = settledThenAskedOf({ models: [modelOf({ askedIso: SETTLED_ISO, doc })] });

    expect(rows.map((row) => [row.slug, row.order])).toEqual([["same-instant", "unordered"]]);
    expect(settledThenAskedLines({ rows })[4]).toBe(
      `  same-instant — settled answered ${SETTLED_ISO}, asked at that same instant, which cannot be ordered against it`,
    );
  });

  it("names a row settled before settledIso existed as unordered, since nothing shows its ask came first", () => {
    const doc = askRow({ extra: settledLines({ settledIso: null }), slug: "undated" });

    expect(settledThenAskedOf({ models: [modelOf({ askedIso: "2026-10-08T03:00:00.000Z", doc })] })).toEqual([
      {
        askedIso: "2026-10-08T03:00:00.000Z",
        order: "unordered",
        question: "Ship it?",
        settledIso: undefined,
        settlement: "answered",
        slug: "undated",
      },
    ]);
  });

  it("names a row whose settledIso does not parse as unordered, carrying the value as written", () => {
    const doc = askRow({ extra: settledLines({ settledIso: "yesterday" }), slug: "garbled" });

    expect(
      settledThenAskedOf({ models: [modelOf({ askedIso: "2026-10-08T03:00:00.000Z", doc })] }).map((row) => [
        row.order,
        row.settledIso,
      ]),
    ).toEqual([["unordered", "yesterday"]]);
  });

  it("names a row settled on an impossible calendar date as unordered, never as the day Date.parse rolls it to", () => {
    const doc = askRow({ extra: settledLines({ settledIso: "2026-02-30T00:00:00.000Z" }), slug: "feb-thirtieth" });

    expect(
      settledThenAskedOf({ models: [modelOf({ askedIso: "2026-03-01T00:00:00.000Z", doc })] }).map((row) => [
        row.order,
        row.settledIso,
      ]),
    ).toEqual([["unordered", "2026-02-30T00:00:00.000Z"]]);
  });

  it("names nothing for an undated settled row whose run no longer waits on the owner", () => {
    const doc = askRow({ extra: settledLines({ settledIso: null }), slug: "undated-answered" });
    const answered: RunEvent = { answer: "main", atIso: "2026-10-08T04:00:00.000Z", kind: "answered" };

    expect(
      settledThenAskedOf({ models: [modelOf({ after: [answered], askedIso: "2026-10-08T03:00:00.000Z", doc })] }),
    ).toEqual([]);
  });

  it("orders a corrected question by its ORIGINAL ask, publishing the corrected words", () => {
    const doc = askRow({ extra: settledLines(), slug: "corrected" });
    const corrected: RunEvent = {
      atIso: "2026-10-08T04:00:00.000Z",
      kind: "question-corrected",
      question: "Ship it on main?",
      why: "named the base",
    };
    const early = modelOf({ after: [corrected], askedIso: "2026-10-08T01:00:00.000Z", doc });
    const late = modelOf({ after: [corrected], askedIso: "2026-10-08T03:00:00.000Z", doc });

    expect(settledThenAskedOf({ models: [early] })).toEqual([]);
    expect(settledThenAskedOf({ models: [late] }).map((row) => [row.askedIso, row.question])).toEqual([
      ["2026-10-08T03:00:00.000Z", "Ship it on main?"],
    ]);
  });

  it("leaves out a settled row whose question was answered, so its run no longer waits on the owner", () => {
    const doc = askRow({ extra: settledLines(), slug: "answered-run" });
    const answered: RunEvent = { answer: "main", atIso: "2026-10-08T04:00:00.000Z", kind: "answered" };

    expect(
      settledThenAskedOf({ models: [modelOf({ after: [answered], askedIso: "2026-10-08T03:00:00.000Z", doc })] }),
    ).toEqual([]);
  });

  it("leaves out an unsettled row waiting on the owner, which the board already shows", () => {
    const doc = askRow({ slug: "live-ask" });

    expect(settledThenAskedOf({ models: [modelOf({ askedIso: "2026-10-08T03:00:00.000Z", doc })] })).toEqual([]);
  });
});

describe("settledThenAskedLines", () => {
  it("prints nothing when no row was settled before its question", () => {
    expect(settledThenAskedLines({ rows: [] })).toEqual([]);
  });

  it("names each row, its two instants, its question and both routes", () => {
    const rows = [
      {
        askedIso: "2026-10-08T03:00:00.000Z",
        order: "after" as const,
        question: "Ship it?",
        settledIso: SETTLED_ISO,
        settlement: "answered" as const,
        slug: "late-ask",
      },
    ];

    expect(settledThenAskedLines({ rows })).toEqual([
      "",
      "⚠ ASKED AFTER ITS ROW WAS SETTLED, ON NO SURFACE (1)",
      "  Each row's ask is settled, so the board, reconcile and the Queue skip it, while its run still waits on the owner.",
      "  late-ask — settled answered 2026-10-08T02:00:00.000Z, asked 2026-10-08T03:00:00.000Z",
      "    Ship it?",
      '    moot: slopweaver handover withdraw late-ask --why "<the check that shows it>"',
      '    still open for the owner: withdraw it there, then slopweaver handover register --ask "<the question>" … on a new row',
    ]);
  });

  it("says when a row cannot be ordered, and why, for an undated and an unparseable settlement", () => {
    const base = { askedIso: "2026-10-08T03:00:00.000Z", question: "Ship it?", settlement: "declined" as const };
    const rows = [
      { ...base, order: "unordered" as const, settledIso: undefined, slug: "undated" },
      { ...base, order: "unordered" as const, settledIso: "yesterday", slug: "garbled" },
    ];

    const lines = settledThenAskedLines({ rows });

    expect(lines[3]).toBe(
      "  A row no instant orders is named too: its question may be one the settlement already answered.",
    );
    expect(lines[4]).toBe(
      "  undated — settled declined with no settledIso, asked 2026-10-08T03:00:00.000Z, which cannot be ordered against it",
    );
    expect(lines[8]).toBe(
      "  garbled — settled declined yesterday, asked 2026-10-08T03:00:00.000Z, which cannot be ordered: one does not parse",
    );
  });

  it("never calls two instants that both fail to parse the same instant", () => {
    const rows = [
      {
        askedIso: "tomorrow",
        order: "unordered" as const,
        question: "Ship it?",
        settledIso: "yesterday",
        settlement: "answered" as const,
        slug: "both-garbled",
      },
    ];

    expect(settledThenAskedLines({ rows })[4]).toBe(
      "  both-garbled — settled answered yesterday, asked tomorrow, which cannot be ordered: one does not parse",
    );
  });
});
