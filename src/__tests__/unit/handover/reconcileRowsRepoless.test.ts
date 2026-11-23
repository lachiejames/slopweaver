/**
 * How `handover reconcile` holds a `RUN NOW` row naming no `repo:` — ranked, but never offered as ready, since
 * `cmux spawn` cannot seat it — and the one line that names those rows with the command that frees each.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  rankedRows,
  repolessLine,
  repolessRowIds,
  repolessUrgentRowIds,
  sharedSlugs,
} from "../../../cli/commands/handover/reconcileRows.js";
import { composeBoardModels } from "../../../handover/boardState.js";
import type { BoardModel } from "../../../handover/boardTypes.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { ordinaryDoc, rowFor } from "./reconcileRowsFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "reconcile-repoless-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** A board of two ordinary never-run docs, one naming a repo and one naming none — both sit in `RUN NOW`. */
function oneRepolessModels(): readonly BoardModel[] {
  const docs = [ordinaryDoc({ slug: "has-repo" }), { ...ordinaryDoc({ slug: "no-repo" }), repo: undefined }];
  return composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: docs, roots: docs });
}

describe("a RUN NOW row naming no repo", () => {
  const nowIso = "2026-09-21T00:00:00.000Z";

  it("is ranked but held as blocked, while its sibling with a repo stays ready", () => {
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: oneRepolessModels(),
      nowIso,
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(),
    });
    expect(rowFor({ id: "no-repo", rows }).standing).toBe("blocked");
    expect(rowFor({ id: "no-repo", rows }).ready).toBe(false);
    expect(rowFor({ id: "has-repo", rows }).ready).toBe(true);
  });

  it("is named by repolessRowIds, and nothing else is", () => {
    expect(repolessRowIds({ models: oneRepolessModels() })).toEqual(["no-repo"]);
  });

  it("is not named once its ask is settled, because a settled ask is not live", () => {
    const open = { ...ordinaryDoc({ slug: "an-ask" }), kind: "ask" as const, repo: undefined };
    const settled = { ...open, settlement: "declined" as const, settlementWitness: "not doing this" };
    const modelsOf = ({ doc }: { doc: HandoverDoc }): readonly BoardModel[] =>
      composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: [doc], roots: [doc] });
    expect(repolessRowIds({ models: modelsOf({ doc: open }) })).toEqual(["an-ask"]);
    expect(repolessRowIds({ models: modelsOf({ doc: settled }) })).toEqual([]);
  });

  it("holds a ready row the trunk-moved read named, at the seam the fill reads, and only that row", () => {
    const docs = [ordinaryDoc({ slug: "answered-on-trunk" }), ordinaryDoc({ slug: "still-open" })];
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: docs, roots: docs }),
      nowIso,
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(["/h/answered-on-trunk.md"]),
    });
    expect([
      rowFor({ id: "answered-on-trunk", rows }).standing,
      rowFor({ id: "answered-on-trunk", rows }).ready,
    ]).toEqual(["blocked", false]);
    expect(rowFor({ id: "still-open", rows }).ready).toBe(true);
  });

  // Keyed by slug, a held finding demoted every other doc claiming the same slug.
  it("holds only the doc whose path was named when two docs share a slug", () => {
    const docs = [ordinaryDoc({ slug: "dup" }), { ...ordinaryDoc({ slug: "dup" }), path: "/h/elsewhere/dup.md" }];
    const rows = rankedRows({
      home,
      deferred: new Map(),
      disconnected: new Set(),
      priorities: [],
      models: composeBoardModels({ journals: new Map(), probeStates: new Map(), resolutionDocs: docs, roots: docs }),
      nowIso,
      supersession: { superseded: new Set(), unresolved: undefined },
      trunkMoved: new Set(["/h/dup.md"]),
    });
    expect(
      rows
        .filter((row) => row.id === "dup")
        .map((row) => row.standing)
        .toSorted(),
    ).toEqual(["blocked", "ready"]);
  });

  it("prints one line naming the count and the fix verb, and nothing at zero", () => {
    expect(repolessLine({ repoless: [], scopeFlags: [], shared: [], urgent: [] })).toBeUndefined();
    expect(repolessLine({ repoless: ["a", "b"], scopeFlags: [], shared: [], urgent: [] })).toBe(
      "(2 RUN NOW row(s) name no `repo:`, so `cmux spawn` cannot seat them — held rather than ready. " +
        "Give one a checkout with: slopweaver handover set-repo <slug> --repo <path>)",
    );
  });

  it("names the p0/p1 and ruled rows among them first, with the fix for the first, capped at five", () => {
    const urgent = ["u1", "u2", "u3", "u4", "u5", "u6"];
    expect(repolessLine({ repoless: [...urgent, "low"], scopeFlags: [], shared: [], urgent })).toBe(
      "(6 p0/p1 or ruled row(s) cannot be seated: u1, u2, u3, u4, u5 and 1 more — slopweaver handover set-repo u1 " +
        "--repo <path>, then slopweaver cmux spawn u1 --model opus. 7 RUN NOW row(s) name no `repo:`, so `cmux spawn` " +
        "cannot seat them — " +
        "held rather than ready. Give one a checkout with: slopweaver handover set-repo <slug> --repo <path>)",
    );
  });

  it("carries the --dir and --home reconcile read into every command it prints", () => {
    expect(
      repolessLine({
        repoless: ["u1"],
        scopeFlags: ["--dir", "/h/docs", "--home", "/tmp/a home"],
        shared: [],
        urgent: ["u1"],
      }),
    ).toBe(
      "(1 p0/p1 or ruled row(s) cannot be seated: u1 — slopweaver handover set-repo u1 --repo <path> --dir /h/docs " +
        "--home '/tmp/a home', then slopweaver cmux spawn u1 --model opus --dir /h/docs --home '/tmp/a home'. " +
        "1 RUN NOW row(s) name no `repo:`, so `cmux spawn` cannot seat them — held rather than ready. Give one a " +
        "checkout with: slopweaver handover set-repo <slug> --repo <path> --dir /h/docs --home '/tmp/a home')",
    );
  });

  it("never names a slug two docs claim in a command, since set-repo and cmux spawn both refuse it", () => {
    const tail =
      "3 RUN NOW row(s) name no `repo:`, so `cmux spawn` cannot seat them — held rather than ready. " +
      "Give one a checkout with: slopweaver handover set-repo <slug> --repo <path>)";
    expect([
      repolessLine({ repoless: ["dup", "dup", "u2"], scopeFlags: [], shared: ["dup"], urgent: ["dup", "dup", "u2"] }),
      repolessLine({ repoless: ["dup", "dup", "low"], scopeFlags: [], shared: ["dup"], urgent: ["dup", "dup"] }),
    ]).toEqual([
      "(3 p0/p1 or ruled row(s) cannot be seated: dup, dup, u2 — slopweaver handover set-repo u2 --repo <path>, then " +
        `slopweaver cmux spawn u2 --model opus; 2 share a slug with another doc. ${tail}`,
      "(2 p0/p1 or ruled row(s) cannot be seated: dup, dup — each shares its slug with another doc or carries one cmux " +
        `spawn refuses, so no command can name one. ${tail}`,
    ]);
  });

  it("never names a slug cmux spawn refuses in a command, and skips to the next it accepts", () => {
    const tail =
      "2 RUN NOW row(s) name no `repo:`, so `cmux spawn` cannot seat them — held rather than ready. " +
      "Give one a checkout with: slopweaver handover set-repo <slug> --repo <path>)";
    expect([
      repolessLine({ repoless: ["bad slug", "u2"], scopeFlags: [], shared: [], urgent: ["bad slug", "u2"] }),
      repolessLine({ repoless: ["bad slug", "../x"], scopeFlags: [], shared: [], urgent: ["bad slug", "../x"] }),
    ]).toEqual([
      "(2 p0/p1 or ruled row(s) cannot be seated: bad slug, u2 — slopweaver handover set-repo u2 --repo <path>, then " +
        `slopweaver cmux spawn u2 --model opus. ${tail}`,
      "(2 p0/p1 or ruled row(s) cannot be seated: bad slug, ../x — each shares its slug with another doc or carries one " +
        `cmux spawn refuses, so no command can name one. ${tail}`,
    ]);
  });

  it("never names a doc that will not parse, which set-repo refuses — the board puts it in CONTRADICTION", () => {
    const docs = [
      { ...ordinaryDoc({ slug: "bad" }), problems: ["duplicate key: summary"], repo: undefined },
      { ...ordinaryDoc({ slug: "good" }), repo: undefined },
    ];
    const models = composeBoardModels({
      journals: new Map(),
      probeStates: new Map(),
      resolutionDocs: docs,
      roots: docs,
    });

    expect(models.map((model) => [model.doc.slug, model.section])).toEqual([
      ["bad", "CONTRADICTION"],
      ["good", "RUN NOW"],
    ]);
    expect(repolessRowIds({ models })).toEqual(["good"]);
  });

  it("finds each slug more than one doc claims, once", () => {
    const docs = [ordinaryDoc({ slug: "a" }), ordinaryDoc({ slug: "b" }), ordinaryDoc({ slug: "a" })];
    expect([sharedSlugs({ docs }), sharedSlugs({ docs: [...docs, ordinaryDoc({ slug: "a" })] })]).toEqual([
      ["a"],
      ["a"],
    ]);
  });

  it("orders the urgent repoless rows p0 before p1 and leaves p2, and a row with a repo, out", () => {
    // MEASURED: the p1 notion recipe-failing finding was one unnamed row of 1666.
    const docs = [
      { ...ordinaryDoc({ slug: "z-p0" }), priority: "p0" as const, repo: undefined },
      { ...ordinaryDoc({ slug: "a-p1" }), priority: "p1" as const, repo: undefined },
      { ...ordinaryDoc({ slug: "b-p2" }), priority: "p2" as const, repo: undefined },
      { ...ordinaryDoc({ slug: "c-p0-with-repo" }), priority: "p0" as const },
    ];
    const models = composeBoardModels({
      journals: new Map(),
      probeStates: new Map(),
      resolutionDocs: docs,
      roots: docs,
    });
    expect(repolessUrgentRowIds({ models })).toEqual(["z-p0", "a-p1"]);
  });
});
