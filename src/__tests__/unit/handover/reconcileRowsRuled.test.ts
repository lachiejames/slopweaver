/**
 * How `handover reconcile` ranks and names a row the owner RULED on, and how a row needing a disconnected integration
 * reaches the ranked board — split from `reconcileRows.test.ts` by scenario.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rankedRows, repolessRowIds, repolessUrgentRowIds } from "../../../cli/commands/handover/reconcileRows.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import type { BoardRow } from "../../../handover/rank.js";
import { ordinaryDoc } from "./reconcileRowsFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "reconcile-rows-ruled-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The board over these docs, each slug's journal holding the events given for it. */
function modelsOf({
  docs,
  events = {},
}: {
  docs: readonly HandoverDoc[];
  events?: Readonly<Record<string, readonly RunEvent[]>>;
}): readonly BoardModel[] {
  const journals = new Map(
    Object.entries(events).map(([slug, journal]) => [slug, { events: journal, unreadableLines: [] }]),
  );
  return composeBoardModels({ journals, probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

/** The ranked board, with the given doc paths held for a disconnected integration. */
function ranked({
  models,
  nowIso,
  disconnected = new Set(),
}: {
  models: readonly BoardModel[];
  nowIso: string;
  disconnected?: ReadonlySet<string>;
}): readonly BoardRow[] {
  return rankedRows({
    deferred: new Map(),
    disconnected,
    home,
    models,
    nowIso,
    priorities: [],
    supersession: { superseded: new Set(), unresolved: undefined },
    trunkMoved: new Set(),
  });
}

describe("a row needing an integration this install is not connected to", () => {
  const nowIso = "2026-11-04T12:00:00.000Z";

  it("stays on the ranked board, NOT ready, while its sibling stays ready", () => {
    const models = modelsOf({ docs: [ordinaryDoc({ slug: "fathom-notes" }), ordinaryDoc({ slug: "code-fix" })] });
    const rows = ranked({ disconnected: new Set(["/h/fathom-notes.md"]), models, nowIso });

    expect(rows.map((row) => [row.id, row.ready, row.standing])).toEqual([
      ["code-fix", true, "ready"],
      ["fathom-notes", false, "blocked"],
    ]);
  });
});

describe("a row the owner ruled on", () => {
  const nowIso = "2026-10-20T00:00:00.000Z";
  const AT = "2026-09-30T01:10:00.000Z";

  /** The owner's ruling as `handover rule` journals it. */
  const live: RunEvent = { anchor: "talk-call:abc#turn_1", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "yes" };

  /** A ready p3 ask, the band the owner parked most of the board in. */
  function askDoc({ slug }: { slug: string }): HandoverDoc {
    return { ...ordinaryDoc({ slug }), askedIso: "2026-09-28T09:02:20.000Z", kind: "ask", priority: "p3" };
  }

  it("reaches the ranked row as ruled from a journal event, an authored pair and a backfill alike", () => {
    const docs = [
      askDoc({ slug: "by-event" }),
      { ...askDoc({ slug: "by-pair" }), ruling: "yes", rulingAnchor: "talk-call:abc#turn_2" },
      askDoc({ slug: "by-backfill" }),
      askDoc({ slug: "never-ruled" }),
    ];
    const rows = ranked({
      models: modelsOf({ docs, events: { "by-backfill": [{ ...live, backfilledFrom: AT }], "by-event": [live] } }),
      nowIso,
    });

    expect(rows.map((row) => [row.id, row.ruled])).toEqual([
      ["by-backfill", true],
      ["by-event", true],
      ["by-pair", true],
      ["never-ruled", false],
    ]);
  });

  it("ranks a ruled ordinary doc ahead of an older unruled ask in its band, and leaves it ungroomed", () => {
    const docs = [
      { ...askDoc({ slug: "older-ask" }), priority: "p2" as const },
      { ...ordinaryDoc({ slug: "ruled-doc" }), priority: undefined },
    ];
    const rows = ranked({ models: modelsOf({ docs, events: { "ruled-doc": [live] } }), nowIso });

    expect(rows.map((row) => [row.id, row.ruled, row.groomed])).toEqual([
      ["ruled-doc", true, false],
      ["older-ask", false, true],
    ]);
  });

  it("never ranks a SETTLED ruled ask, nor names it repoless", () => {
    const settled = { ...askDoc({ slug: "settled" }), repo: undefined, settlement: "answered" as const };
    const models = modelsOf({ docs: [settled], events: { settled: [live] } });

    expect([ranked({ models, nowIso }).map((row) => row.id), repolessUrgentRowIds({ models })]).toEqual([[], []]);
  });

  it("names a ruled repoless row of any band after every p0 and p1 one, once, and leaves an unruled p3 out", () => {
    const docs = [
      { ...askDoc({ slug: "b-ruled-p3" }), repo: undefined },
      { ...askDoc({ slug: "a-ruled-p2" }), priority: "p2" as const, repo: undefined },
      { ...askDoc({ slug: "z-ruled-p1" }), priority: "p1" as const, repo: undefined },
      { ...askDoc({ slug: "y-p0" }), priority: "p0" as const, repo: undefined },
      { ...askDoc({ slug: "c-unruled-p3" }), repo: undefined },
      askDoc({ slug: "d-ruled-with-repo" }),
    ];
    const models = modelsOf({
      docs,
      events: { "a-ruled-p2": [live], "b-ruled-p3": [live], "d-ruled-with-repo": [live], "z-ruled-p1": [live] },
    });

    expect(repolessUrgentRowIds({ models })).toEqual(["y-p0", "z-ruled-p1", "a-ruled-p2", "b-ruled-p3"]);
  });

  it("never names a ruled row that names a repo because an unruled doc sharing its slug names none", () => {
    const docs = [
      { ...askDoc({ slug: "dup" }), priority: "p2" as const, repo: undefined },
      { ...askDoc({ slug: "dup" }), priority: "p2" as const, ruling: "yes", rulingAnchor: "talk-call:abc#turn_3" },
    ];
    const models = modelsOf({ docs });

    expect([repolessRowIds({ models }), repolessUrgentRowIds({ models })]).toEqual([["dup"], []]);
  });

  it("never lifts a ruled repoless p3 into the p1 group because a doc sharing its slug names a repo at p1", () => {
    const docs = [
      { ...askDoc({ slug: "z" }), repo: undefined, ruling: "yes", rulingAnchor: "talk-call:abc#turn_4" },
      { ...askDoc({ slug: "z" }), priority: "p1" as const },
      {
        ...askDoc({ slug: "a" }),
        priority: "p2" as const,
        repo: undefined,
        ruling: "yes",
        rulingAnchor: "talk-call:abc#turn_5",
      },
    ];
    const models = modelsOf({ docs });

    expect([repolessRowIds({ models }), repolessUrgentRowIds({ models })]).toEqual([
      ["a", "z"],
      ["a", "z"],
    ]);
  });

  it("names an ask declaring no priority in p1, where rank.ts ranks it, and the ruled tail band by band", () => {
    const docs = [
      { ...askDoc({ slug: "z-default-p1" }), priority: undefined, repo: undefined },
      { ...askDoc({ slug: "c-p2" }), priority: "p2" as const, repo: undefined },
      { ...askDoc({ slug: "b-p3" }), repo: undefined },
    ];
    const models = modelsOf({ docs, events: { "b-p3": [live], "c-p2": [live], "z-default-p1": [live] } });

    expect(repolessUrgentRowIds({ models })).toEqual(["z-default-p1", "c-p2", "b-p3"]);
  });
});
