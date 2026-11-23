import { describe, expect, it } from "vitest";

import { type FreshnessObservation, freshnessSummary, projectFreshness } from "../../../briefing/freshness.js";
import { ResyncErrors, type ResyncState } from "../../../live/resync/outcome.js";
import { buildResyncPolicies } from "../../../live/resync/policy.js";

const HOUR = 60 * 60 * 1000;
const NOW = "2026-09-12T04:00:00.000Z";

const policies = buildResyncPolicies({
  atlases: [
    { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
    { platform: "trelica", resyncCommand: "slopweaver atlas trelica refresh", seated: true, windowMs: 4 * HOUR },
  ],
  corpus: [{ source: "notion", subject: { kind: "none" }, windowMs: 4 * HOUR }],
}).policies;

const allIds = policies.map((policy) => policy.recipeId);

const fresh: readonly FreshnessObservation[] = [
  { clock: "2026-09-12T03:50:00.000Z", late: false, recipeId: "resync-atlas-airtable" },
  { clock: "2026-09-04T22:58:12.975Z", late: true, recipeId: "resync-atlas-trelica" },
  { clock: "2026-09-12T03:00:00.000Z", late: false, recipeId: "resync-corpus-notion" },
];

const blockedTrelica: ResyncState = {
  blocker: {
    findingSlug: "trelica-atlas-cannot-resync-unattended",
    key: "browser-session-gone",
    reason: "the signed-in session for the Trelica tenant is gone from the recorded Chrome profile",
    steps: ["Open the tenant in the recorded Chrome profile", "Complete the Acme sign-in"],
  },
  lastAttempt: {
    afterClock: "2026-09-04T22:58:12.975Z",
    beforeClock: "2026-09-04T22:58:12.975Z",
    exitCode: 1,
    finishedAtIso: "2026-09-12T03:20:00.000Z",
    outcome: "failed",
    problems: ["`slopweaver atlas trelica refresh` exited 1"],
    recipeId: "resync-atlas-trelica",
    startedAtIso: "2026-09-12T03:19:00.000Z",
  },
  lastSuccessAtIso: "2026-09-04T22:58:12.975Z",
  recipeId: "resync-atlas-trelica",
};

describe("projectFreshness", () => {
  it("builds one row per scheduled target, in roster order", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    expect(projection.rows.map((row) => row.recipeId)).toEqual(allIds);
  });

  it("carries each target's own cadence rather than a shared one", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    expect(projection.rows.map((row) => row.cadence)).toEqual(["0 */4 * * *", "0 */4 * * *", "0 */4 * * *"]);
  });

  it("marks a target with a derived policy and no registered row UNSCHEDULED", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: ["resync-atlas-airtable"],
      states: new Map(),
      unreadable: [],
    });
    expect(projection.rows.filter((row) => row.unscheduled).map((row) => row.recipeId)).toEqual([
      "resync-atlas-trelica",
      "resync-corpus-notion",
    ]);
  });

  it("marks a DISABLED row paused, never scheduled — nothing will run it until somebody re-enables it", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: ["resync-atlas-airtable"],
      policies,
      registered: ["resync-atlas-trelica", "resync-corpus-notion"],
      states: new Map(),
      unreadable: [],
    });
    const airtable = projection.rows.find((row) => row.recipeId === "resync-atlas-airtable")!;
    expect(airtable.paused).toBe(true);
    // Paused is deliberate; unscheduled reads as an oversight. A row is never both.
    expect(airtable.unscheduled).toBe(false);
  });

  it("never reports a paused target as current, however fresh its generation is", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: ["resync-atlas-airtable"],
      policies,
      registered: ["resync-atlas-trelica", "resync-corpus-notion"],
      states: new Map(),
      unreadable: [],
    });
    expect(freshnessSummary({ rows: projection.rows })).toBe(
      "Atlas and corpus freshness — 3 targets · 1 late · 1 paused",
    );
  });

  it("treats a target its judge never observed as late rather than as current", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: [],
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    expect(projection.rows.map((row) => row.late)).toEqual([true, true, true]);
    expect(projection.rows.map((row) => row.clock)).toEqual([null, null, null]);
  });

  it("keeps failing, blocked and late apart on one row", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map([["resync-atlas-trelica", blockedTrelica]]),
      unreadable: [],
    });
    const trelica = projection.rows.find((row) => row.recipeId === "resync-atlas-trelica")!;
    expect(trelica.failing).toBe(true);
    expect(trelica.late).toBe(true);
    expect(trelica.blocker!.steps.length).toBe(2);
    expect(trelica.lastSuccessAtIso).toBe("2026-09-04T22:58:12.975Z");
  });

  it("reports a target whose last attempt succeeded as not failing", () => {
    const succeeded: ResyncState = {
      ...blockedTrelica,
      blocker: null,
      lastAttempt: { ...blockedTrelica.lastAttempt!, exitCode: 0, outcome: "succeeded" },
    };
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map([["resync-atlas-trelica", succeeded]]),
      unreadable: [],
    });
    expect(projection.rows.find((row) => row.recipeId === "resync-atlas-trelica")!.failing).toBe(false);
  });

  it("collapses everything: one summary above the fold, every target inside it", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map([["resync-atlas-trelica", blockedTrelica]]),
      unreadable: [],
    });
    expect(projection.section.id).toBe("freshness");
    expect(projection.section.notes.length).toBe(2);
    expect(projection.section.notes[0]!.detail!.blocks.length).toBe(1);
    expect(projection.section.notes[0]!.headline).toEqual([
      { kind: "text", text: "Every target this build derives, with its cadence — 3 in all" },
    ]);
    expect(projection.section.notes[1]!.detail!.summary).toBe("1 target(s) cannot resync unattended — the exact steps");
  });

  it("names a corpus clock the newest RECORD and an atlas clock a generation, never one word for both", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    const lines = projection.section.notes[0]!.detail!.blocks[0]!;
    const text = JSON.stringify(lines);
    // A cursor is the newest record OBSERVED, not a generation this install published. One word for both is
    // how a reader mistakes a stalled ingest cursor for a merely stale atlas — measured on Slack.
    expect(text).toContain("corpus notion — current; newest record");
    expect(text).toContain("atlas airtable — current; generated");
  });

  it("says 'current, unverified' ON THE ROW when a clock lags its window, never a bare current", () => {
    // Reproduced on the RENDERED page: the caveat lived only in a source comment, so a
    // frozen Slack read plainly "current" to the person reading it. The reader sees the page, not the file.
    const projection = projectFreshness({
      nowIso: NOW,
      observations: [
        { clock: "2026-09-10T04:11:53.000Z", clockLagsWindow: true, late: false, recipeId: "resync-corpus-notion" },
      ],
      paused: [],
      policies,
      registered: allIds,
      states: new Map([
        [
          "resync-corpus-notion",
          { blocker: null, lastAttempt: null, lastSuccessAtIso: NOW, recipeId: "resync-corpus-notion" },
        ],
      ]),
      unreadable: [],
    });
    const notion = projection.rows.find((row) => row.recipeId === "resync-corpus-notion")!;
    expect(notion.unverified).toBe(true);
    expect(JSON.stringify(projection.section)).toContain("corpus notion — current, unverified");
  });

  it("puts the WHY of unverified on the page, not only in the source", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: [
        { clock: "2026-09-10T04:11:53.000Z", clockLagsWindow: true, late: false, recipeId: "resync-corpus-notion" },
      ],
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    const rendered = JSON.stringify(projection.section);
    expect(rendered).toContain("Why a row can read current and still be unverified");
    expect(rendered).toContain(
      "The `--store: <source>: N row(s) stored` line in the resync's own output is the receipt",
    );
  });

  it("prints the STORED cadence when it differs from the one this build derives", () => {
    // Counterexample: a row stored "not-a-cron" — which the due judge calls
    // unschedulable, so it never fires — while the page printed the derived "0 */4 * * *" as if in force.
    const projection = projectFreshness({
      nowIso: NOW,
      observations: [
        {
          clock: "2026-09-12T03:50:00.000Z",
          late: false,
          recipeId: "resync-corpus-notion",
          storedCadence: "not-a-cron",
        },
      ],
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    expect(JSON.stringify(projection.section)).toContain(
      "cadence not-a-cron — STORED, where the roster derives 0 */4 * * *",
    );
  });

  it("prints one cadence, not two, when the stored row already matches", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: [
        {
          clock: "2026-09-12T03:50:00.000Z",
          late: false,
          recipeId: "resync-corpus-notion",
          storedCadence: "0 */4 * * *",
        },
      ],
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    expect(JSON.stringify(projection.section)).toContain(
      "corpus notion — current; newest record 10.0m old; no recorded success; cadence 0 */4 * * *",
    );
    expect(JSON.stringify(projection.section)).not.toContain("STORED, where the roster derives");
  });

  it("carries no blocker note at all when nothing is blocked", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [],
    });
    expect(projection.section.notes.length).toBe(1);
  });
});

describe("a stored record that is there but corrupt", () => {
  const corrupt = ResyncErrors.stateCorrupt({
    detail: "not JSON: Unexpected end of JSON input",
    path: "/state/resync/resync-atlas-trelica.json",
    recipeId: "resync-atlas-trelica",
  });

  it("marks that one row unreadable, claims no success for it, and counts it in the summary", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [corrupt],
    });
    expect(projection.rows.map((row) => row.recordUnreadable)).toEqual([null, corrupt.message, null]);
    expect(freshnessSummary({ rows: projection.rows })).toBe(
      "Atlas and corpus freshness — 3 targets · 1 late · 1 RECORD UNREADABLE",
    );
    const text = JSON.stringify(projection.section);
    expect(text).toContain("trelica — RECORD UNREADABLE, late;");
    expect(text).toContain(`last success unknown: ${corrupt.message}`);
  });

  it("marks every row unreadable when the directory holding the records cannot be listed", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map(),
      unreadable: [ResyncErrors.stateDirUnreadable({ detail: "EACCES", stateDir: "/state/resync" })],
    });
    expect(projection.rows.map((row) => row.recordUnreadable)).toEqual([
      "the resync state directory /state/resync is there but cannot be listed (EACCES) — restore its permissions or the target of its link so its records read again; moving it aside starts every target's history over",
      "the resync state directory /state/resync is there but cannot be listed (EACCES) — restore its permissions or the target of its link so its records read again; moving it aside starts every target's history over",
      "the resync state directory /state/resync is there but cannot be listed (EACCES) — restore its permissions or the target of its link so its records read again; moving it aside starts every target's history over",
    ]);
  });
});

describe("freshnessSummary", () => {
  it("derives every count from the rows rather than taking one", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: allIds,
      states: new Map([["resync-atlas-trelica", blockedTrelica]]),
      unreadable: [],
    });
    expect(freshnessSummary({ rows: projection.rows })).toBe(
      "Atlas and corpus freshness — 3 targets · 1 late · 1 failing · 1 blocked on you",
    );
  });

  it("omits a count that is zero, and shouts an unscheduled target", () => {
    const projection = projectFreshness({
      nowIso: NOW,
      observations: fresh,
      paused: [],
      policies,
      registered: ["resync-atlas-airtable"],
      states: new Map(),
      unreadable: [],
    });
    expect(freshnessSummary({ rows: projection.rows })).toBe(
      "Atlas and corpus freshness — 3 targets · 1 late · 2 UNSCHEDULED",
    );
  });

  it("never calls a paused or unregistered target scheduled — the lead figure counts DERIVED targets", () => {
    const one = buildResyncPolicies({
      atlases: [
        { platform: "airtable", resyncCommand: "slopweaver atlas airtable sync", seated: true, windowMs: 4 * HOUR },
      ],
      corpus: [],
    }).policies;
    const projection = projectFreshness({
      nowIso: NOW,
      observations: [{ clock: "2026-09-12T03:50:00.000Z", late: false, recipeId: "resync-atlas-airtable" }],
      paused: ["resync-atlas-airtable"],
      policies: one,
      registered: [],
      states: new Map(),
      unreadable: [],
    });
    expect(freshnessSummary({ rows: projection.rows })).toBe(
      "Atlas and corpus freshness — 1 targets · 0 late · 1 paused",
    );
  });

  it("says so plainly when nothing is scheduled at all", () => {
    expect(freshnessSummary({ rows: [] })).toBe("Atlas and corpus freshness — 0 targets · 0 late");
  });
});
