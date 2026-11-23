/**
 * The unseated-recipe-failure gate over plain documents: a `recipe-failing-*` row a tick read with no seat, no
 * completed spawn and no hold-rationale is refused by name, whatever its standing or repo, and each way out clears it.
 *
 * The incident row is a Notion finding exactly as the board held it: repoless, so `blocked`, in `held`.
 */
import { describe, expect, it } from "vitest";

import { judgeRecipeFailures } from "../../../supervisor/recipeFailureGate.js";

const NOTION = "recipe-failing-resync-corpus-notion-2026-10-12t13-00-00.000z-a1";
const VANTA = "recipe-failing-resync-atlas-vanta-2026-10-12t02-00-00.000z-a1";

/** One board row as the reconciliation lists it. */
function row({ id, standing }: { id: string; standing: string }): Record<string, unknown> {
  return { groomed: true, id, kind: "ask", priority: "p1", ready: standing === "ready", standing };
}

/** One placement entry seating a session on a row. */
function placed({ id }: { id: string }): Record<string, unknown> {
  return { row: { id }, session: "workspace:7" };
}

/** A reconciliation carrying the given lists over an observed fleet, with nobody seated unless a placement says so. */
function reconciliation({
  ready = [],
  held = [],
  aligned = [],
  misaligned = [],
  unprioritised = [],
  repolessRows = [],
  fleet = "observed",
  duplicateRecipeFailures = [],
}: {
  ready?: readonly Record<string, unknown>[];
  held?: readonly Record<string, unknown>[];
  aligned?: readonly string[];
  misaligned?: readonly string[];
  unprioritised?: readonly string[];
  repolessRows?: readonly string[];
  fleet?: string;
  duplicateRecipeFailures?: readonly string[];
}): Record<string, unknown> {
  return {
    aligned: aligned.map((id) => placed({ id })),
    duplicateRecipeFailures,
    fleet,
    held,
    misaligned: misaligned.map((id) => placed({ id })),
    ready,
    repolessRows,
    unprioritised: unprioritised.map((id) => placed({ id })),
  };
}

/** The board: the Notion finding repoless and blocked, nobody on it. */
const INCIDENT = reconciliation({ held: [row({ id: NOTION, standing: "blocked" })], repolessRows: [NOTION] });

describe("judgeRecipeFailures", () => {
  it("refuses the incident: a repoless failure finding held off RUN NOW with nobody on it", () => {
    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: INCIDENT })).toEqual({
      kind: "refused",
      rows: [{ id: NOTION, repoless: true, standing: "blocked" }],
    });
  });

  it("owes no seat to a finding held for an integration this install is not connected to, and still owes its sibling", () => {
    const read = {
      ...reconciliation({
        held: [row({ id: NOTION, standing: "blocked" }), row({ id: VANTA, standing: "blocked" })],
      }),
      disconnectedRows: [{ needs: ["calendar"], path: `/h/${NOTION}.md`, slug: NOTION }],
      disconnectedUnread: null,
    };

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "refused",
      rows: [{ id: VANTA, repoless: false, standing: "blocked" }],
    });
  });

  it("refuses to read a malformed `disconnectedRows` entry, even one naming the slug, rather than clear a row on a guess", () => {
    const malformed = [
      [{ needs: ["calendar"] }],
      [{ needs: "calendar", path: 7, slug: NOTION }],
      [{ needs: [], path: `/h/${NOTION}.md`, slug: NOTION }],
      [{ needs: ["not-an-integration"], path: `/h/${NOTION}.md`, slug: NOTION }],
      [{ needs: ["calendar"], path: "", slug: NOTION }],
      { slug: NOTION },
    ];

    expect(
      malformed.map((disconnectedRows) =>
        judgeRecipeFailures({ actions: [], judgements: [], reconciliation: { ...INCIDENT, disconnectedRows } }),
      ),
    ).toEqual(
      malformed.map(() => ({
        kind: "unreadable",
        why: "the reconciliation's `disconnectedRows` is not a list of `{ needs, path, slug }` rows",
      })),
    );
  });

  it("refuses to exempt a finding the same reading lists as ready, since the hold always blocks one", () => {
    const read = {
      ...reconciliation({ ready: [row({ id: VANTA, standing: "ready" })] }),
      disconnectedRows: [{ needs: ["vanta"], path: `/h/${VANTA}.md`, slug: VANTA }],
      disconnectedUnread: null,
    };

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "unreadable",
      why:
        `the reconciliation holds ${VANTA} for a disconnected integration but lists it as ready — re-run ` +
        "`slopweaver handover reconcile --json` with this checkout",
    });
  });

  it("refuses to exempt a finding beside an unread, absent or malformed store reading", () => {
    const disconnectedRows = [{ needs: ["calendar"], path: `/h/${NOTION}.md`, slug: NOTION }];
    const reads = [
      { ...INCIDENT, disconnectedRows, disconnectedUnread: "EACCES" },
      { ...INCIDENT, disconnectedRows },
      { ...INCIDENT, disconnectedRows, disconnectedUnread: 7 },
    ];
    const notAReason = {
      kind: "unreadable",
      why: "the reconciliation's `disconnectedUnread` is neither null nor a reason",
    };

    expect(reads.map((read) => judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read }))).toEqual([
      {
        kind: "unreadable",
        why: "the reconciliation holds rows for a disconnected integration while saying the secrets store did not list",
      },
      notAReason,
      notAReason,
    ]);
  });

  it("refuses a ready failure finding however the machine stands — capacity is not a condition", () => {
    const read = reconciliation({ ready: [row({ id: VANTA, standing: "ready" })] });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "refused",
      rows: [{ id: VANTA, repoless: false, standing: "ready" }],
    });
  });

  it("is clean when a live seat is on the finding, from any of the three placement lists", () => {
    const open = [row({ id: VANTA, standing: "in-flight" })];
    const seatedBy = [
      reconciliation({ aligned: [VANTA], held: open }),
      reconciliation({ held: open, misaligned: [VANTA] }),
      reconciliation({ held: open, unprioritised: [VANTA] }),
    ];

    expect(seatedBy.map((read) => judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read }))).toEqual([
      { kind: "clean" },
      { kind: "clean" },
      { kind: "clean" },
    ]);
  });

  it("refuses a placed finding when the fleet was unavailable — an open journal is not a live seat", () => {
    const read = reconciliation({
      aligned: [VANTA],
      fleet: "unavailable",
      held: [row({ id: VANTA, standing: "in-flight" })],
    });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "refused",
      rows: [{ id: VANTA, repoless: false, standing: "in-flight" }],
    });
  });

  it("is unreadable when a finding is owed and the reconciliation does not say whether its fleet was observed", () => {
    const { fleet: _fleet, ...unsaid } = INCIDENT;

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: unsaid })).toEqual({
      kind: "unreadable",
      why: "the reconciliation does not say whether its fleet was observed, so no placement can be read as a live seat",
    });
  });

  it("will not judge a board where two docs claim one finding slug, even with a seat on it", () => {
    const read = reconciliation({ aligned: [VANTA], duplicateRecipeFailures: [VANTA] });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "unreadable",
      why:
        `two live docs claim the recipe failure finding slug ${VANTA}, so no seat on it can be told from the other ` +
        "doc's — rename one doc's `slug:` or archive the stale one, then re-run `slopweaver handover reconcile --json`",
    });
  });

  it("is unreadable when a finding is owed and the reconciliation predates the duplicate-slug list", () => {
    const { duplicateRecipeFailures: _duplicates, ...unsaid } = INCIDENT;

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: unsaid })).toEqual({
      kind: "unreadable",
      why:
        "the reconciliation carries no `duplicateRecipeFailures` list, so a finding slug two docs claim could be " +
        "hiding one — re-run `slopweaver handover reconcile --json` with this checkout",
    });
  });

  it("is clean over a reading that predates the duplicate-slug list when no finding is owed", () => {
    const { duplicateRecipeFailures: _duplicates, ...unsaid } = reconciliation({});

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: unsaid })).toEqual({ kind: "clean" });
  });

  it("names every owed finding in the reconciliation's order, each with its own repo flag", () => {
    const read = reconciliation({
      held: [row({ id: NOTION, standing: "blocked" })],
      ready: [row({ id: VANTA, standing: "ready" })],
      repolessRows: [NOTION],
    });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "refused",
      rows: [
        { id: VANTA, repoless: false, standing: "ready" },
        { id: NOTION, repoless: true, standing: "blocked" },
      ],
    });
  });

  it("is clean when this tick completed a spawn onto the finding, and not when the spawn failed or named a workspace", () => {
    const spawn = ({ outcome, subject }: { outcome: string; subject: unknown }): unknown => ({
      kind: "spawned",
      outcome,
      subject,
    });
    const onRow = { id: NOTION, kind: "handover" };
    const judged = [
      spawn({ outcome: "completed", subject: onRow }),
      spawn({ outcome: "failed", subject: onRow }),
      spawn({ outcome: "completed", subject: { id: "workspace:9", kind: "session" } }),
    ].map((action) => judgeRecipeFailures({ actions: [action], judgements: [], reconciliation: INCIDENT }).kind);

    expect(judged).toEqual(["clean", "refused", "refused"]);
  });

  it("is clean when a hold-rationale names the finding, and not when it names another row", () => {
    const rationale = ({ id }: { id: string }): unknown => ({
      kind: "hold-rationale",
      subject: { id, kind: "handover" },
    });

    expect(
      judgeRecipeFailures({ actions: [], judgements: [rationale({ id: NOTION })], reconciliation: INCIDENT }),
    ).toEqual({ kind: "clean" });
    expect(
      judgeRecipeFailures({ actions: [], judgements: [rationale({ id: VANTA })], reconciliation: INCIDENT }).kind,
    ).toBe("refused");
  });

  it("passes a finding parked on the owner's word or on a named person — each already carries its reason", () => {
    const read = reconciliation({
      held: [row({ id: NOTION, standing: "waiting-on-owner" }), row({ id: VANTA, standing: "paused" })],
    });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({ kind: "clean" });
  });

  it("owes a finding listed once in a reasoned standing and once not, whichever list comes first", () => {
    const read = reconciliation({
      held: [row({ id: NOTION, standing: "blocked" })],
      ready: [row({ id: NOTION, standing: "waiting-on-owner" })],
    });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "refused",
      rows: [{ id: NOTION, repoless: false, standing: "blocked" }],
    });
  });

  it("names only the failure findings, never another unseated row", () => {
    const read = reconciliation({
      held: [row({ id: NOTION, standing: "blocked" })],
      ready: [row({ id: "some-other-ready-ask", standing: "ready" })],
    });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "refused",
      rows: [{ id: NOTION, repoless: false, standing: "blocked" }],
    });
  });

  it("is unreadable on a reconciliation with no held list, rather than calling it clean", () => {
    const read = { aligned: [], misaligned: [], ready: [], unprioritised: [] };

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "unreadable",
      why: "the reconciliation carries no `held` list — re-run `slopweaver handover reconcile --json` with this checkout",
    });
  });

  it("is unreadable on a malformed entry anywhere in the open lists", () => {
    const read = reconciliation({ ready: [{ id: VANTA }] });

    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: read })).toEqual({
      kind: "unreadable",
      why: "the reconciliation's ready[0] is not a board row with a string id and standing",
    });
  });

  it("is clean on a board carrying no failure finding at all", () => {
    expect(judgeRecipeFailures({ actions: [], judgements: [], reconciliation: reconciliation({}) })).toEqual({
      kind: "clean",
    });
  });
});
