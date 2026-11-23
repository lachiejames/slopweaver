// The error-tracking supersession cases went out with the predecessor shapes they held.
// deleted-with-code: EARLIER_HOLD_REASON
import { describe, expect, it } from "vitest";

import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { failureFindingSlug, failureHoldReason } from "../../../../live/automation/failureHold.js";
import type { StandingRow } from "../../../../live/automation/standingRow.js";
import { absentStandingRows } from "../../../../live/automation/standingRowAbsence.js";
import {
  sameStoredRow,
  supersededStandingRowLine,
  supersededStandingRows,
} from "../../../../live/automation/standingRowSupersession.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";
import { teamStandingRows } from "../../../../live/automation/teamStandingRows.js";
import { VERB_RUN_KIND } from "../../../../live/automation/verbRun.js";

/** The team rows a registration of the synthetic team repository declares. */
const ACME_ROWS = teamStandingRows({ repository: "acme/acme-admin" });

const DAILY: StandingRow["definition"] = {
  cadence: "0 4 * * *",
  destination: { kind: "local-atlas" },
  effect: "read-write",
  enabled: true,
  kind: VERB_RUN_KIND,
  onMissed: "skip",
  params: { argv: ["worktree", "prune", "--apply"] },
  recipeId: "worktree-prune",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

/** The finding and reason `automation run-due` writes when the daily row's four o'clock firing fails on attempt one. */
const STORE_FINDING = failureFindingSlug({
  attempt: 1,
  recipeId: "worktree-prune",
  slotIso: "2026-11-03T04:00:00.000Z",
});
const STORE_HOLD = {
  askedIso: "2026-11-03T06:58:20.401Z",
  clearedBy: null,
  finding: STORE_FINDING,
  reason: failureHoldReason({
    attempt: 1,
    finding: STORE_FINDING,
    recipeId: "worktree-prune",
    slotIso: "2026-11-03T04:00:00.000Z",
    what: "exit 1",
  }),
};

const HOURLY: StandingRow = {
  definition: { ...DAILY, cadence: "0 * * * *" },
  supersedes: [DAILY],
  why: "nothing else removes a worktree",
};

const DIGEST: StandingRow = {
  definition: { ...DAILY, recipeId: "alerts-digest" },
  why: "nobody sees the overnight alerts",
};

describe("sameStoredRow", () => {
  it("reads a parsed row carrying undefined optional keys as the declaration that never names them", () => {
    expect(sameStoredRow({ declared: DAILY, stored: { ...DAILY, channelApprovals: undefined, hold: undefined } })).toBe(
      true,
    );
  });

  it("tells a paused row from the declaration", () => {
    expect(sameStoredRow({ declared: DAILY, stored: { ...DAILY, enabled: false } })).toBe(false);
  });
});

describe("supersededStandingRows", () => {
  it("rewrites the shipped prune row an install holds, hourly without --if-idle or the daily one", () => {
    const prune = GENERIC_STANDING_ROWS.find((declared) => declared.definition.recipeId === "worktree-prune")!;
    expect(prune.supersedes!.map((shape) => [shape.cadence, shape.params])).toEqual([
      ["0 * * * *", { argv: ["worktree", "prune", "--apply"] }],
      ["0 4 * * *", { argv: ["worktree", "prune", "--apply"] }],
    ]);
  });

  it("reports a row in its one canonical file that is exactly an earlier build's declaration", () => {
    expect(supersededStandingRows({ declared: [HOURLY], existing: [DAILY], files: ["worktree-prune.json"] })).toEqual([
      { ambiguousFiles: [], declaredCadence: "0 * * * *", recipeId: "worktree-prune", storedCadence: "0 4 * * *" },
    ]);
  });

  it("leaves a paused copy of the earlier row alone — an edit is somebody's act, not the build's", () => {
    const paused = { ...DAILY, enabled: false };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [paused], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("reports an earlier row the store held on a FAILURE — run-due placed that hold, nobody edited the row", () => {
    const failed = { ...DAILY, hold: STORE_HOLD };
    expect(
      supersededStandingRows({ declared: [HOURLY], existing: [failed], files: ["worktree-prune.json"] }).map(
        (entry) => entry.recipeId,
      ),
    ).toEqual(["worktree-prune"]);
  });

  it("leaves an earlier row alone when its failure hold carries a key the store never writes", () => {
    const edited = { ...DAILY, hold: { ...STORE_HOLD, manualNote: "owner-added drift" } };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [edited], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row alone when its failure hold's reason is not the store's template", () => {
    const edited = { ...DAILY, hold: { ...STORE_HOLD, reason: "OWNER EDIT: keep this exact wording" } };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [edited], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row alone when its reason spells the slot as the store never does", () => {
    const edited = {
      ...DAILY,
      hold: { ...STORE_HOLD, reason: STORE_HOLD.reason.replace("04:00:00.000Z", "04:00:00.000z") },
    };
    expect(edited.hold.reason).toContain("04:00:00.000z firing");
    expect(supersededStandingRows({ declared: [HOURLY], existing: [edited], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row alone when its hold claims attempt 0 — attempts are 1-based", () => {
    const slotIso = "2026-11-03T04:00:00.000Z";
    const finding = failureFindingSlug({ attempt: 0, recipeId: "worktree-prune", slotIso });
    const reason = failureHoldReason({ attempt: 0, finding, recipeId: "worktree-prune", slotIso, what: "exit 1" });
    const zeroth = { ...DAILY, hold: { ...STORE_HOLD, finding, reason } };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [zeroth], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row alone when its failure hold names a finding the store would not derive for it", () => {
    const edited = { ...DAILY, hold: { ...STORE_HOLD, finding: "recipe-failing-a1" } };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [edited], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row alone when its failure hold's reason names another recipe", () => {
    const otherFinding = failureFindingSlug({ attempt: 1, recipeId: "other", slotIso: "2026-11-03T04:00:00.000Z" });
    const reason = failureHoldReason({
      attempt: 1,
      finding: otherFinding,
      recipeId: "other",
      slotIso: "2026-11-03T04:00:00.000Z",
      what: "exit 1",
    });
    const moved = { ...DAILY, hold: { ...STORE_HOLD, finding: otherFinding, reason } };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [moved], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row alone when the owner cleared its failure hold — the clearance is their word", () => {
    const cleared = {
      ...DAILY,
      hold: { ...STORE_HOLD, clearedBy: { atIso: "2026-11-03T08:00:00.000Z", runSlug: STORE_FINDING } },
    };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [cleared], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("leaves an earlier row the OWNER held alone — an owner hold names no finding", () => {
    const held = { ...DAILY, hold: { askedIso: "2026-11-03T06:58:20.401Z", clearedBy: null, reason: "wait" } };
    expect(supersededStandingRows({ declared: [HOURLY], existing: [held], files: ["worktree-prune.json"] })).toEqual(
      [],
    );
  });

  it("reports nothing once the store already holds the current declaration", () => {
    expect(
      supersededStandingRows({ declared: [HOURLY], existing: [HOURLY.definition], files: ["worktree-prune.json"] }),
    ).toEqual([]);
  });

  it("reports nothing for an absent row, which absentStandingRows reports", () => {
    expect(supersededStandingRows({ declared: [HOURLY], existing: [], files: [] })).toEqual([]);
  });

  it("reports nothing for a row that declares no earlier shape", () => {
    expect(
      supersededStandingRows({ declared: [DIGEST], existing: [DIGEST.definition], files: ["alerts-digest.json"] }),
    ).toEqual([]);
  });

  it("marks the id AMBIGUOUS when a daily copy stands beside an already-hourly canonical file", () => {
    expect(
      supersededStandingRows({
        declared: [HOURLY],
        existing: [HOURLY.definition, DAILY],
        files: ["worktree-prune.json", "zz-copy.json"],
      }),
    ).toEqual([
      {
        ambiguousFiles: ["worktree-prune.json", "zz-copy.json"],
        declaredCadence: "0 * * * *",
        recipeId: "worktree-prune",
        storedCadence: "0 4 * * *",
      },
    ]);
  });

  it("marks the id AMBIGUOUS when an edited copy would otherwise mask the daily canonical file", () => {
    const paused = { ...DAILY, enabled: false };
    const found = supersededStandingRows({
      declared: [HOURLY],
      existing: [DAILY, paused],
      files: ["worktree-prune.json", "zz-copy.json"],
    });
    expect(found.map((entry) => entry.ambiguousFiles)).toEqual([["worktree-prune.json", "zz-copy.json"]]);
  });

  it("marks the id AMBIGUOUS when its one earlier row stands under another file's name", () => {
    const found = supersededStandingRows({ declared: [HOURLY], existing: [DAILY], files: ["zz-copy.json"] });
    expect(found.map((entry) => entry.ambiguousFiles)).toEqual([["zz-copy.json"]]);
  });

  it("names the real daily worktree-prune row an install holds as superseded by the hourly declaration", () => {
    expect(
      supersededStandingRows({ declared: GENERIC_STANDING_ROWS, existing: [DAILY], files: ["worktree-prune.json"] }),
    ).toEqual([
      { ambiguousFiles: [], declaredCadence: "0 * * * *", recipeId: "worktree-prune", storedCadence: "0 4 * * *" },
    ]);
  });

  it("reads an install's existing team rows beside its own top-up definition as neither absent nor superseded", () => {
    const topup = {
      ...ACME_ROWS[0]!.definition,
      params: { argv: ["vulnerability-fix", "topup", "--repo", "acme/acme-admin", "--title-contains", "(CVSS "] },
      recipeId: "vulnerability-fix-topup-acme-admin",
    };
    const installed = [...ACME_ROWS.map((row) => row.definition), topup];
    const files = installed.map((definition) => `${definition.recipeId}.json`);
    expect(absentStandingRows({ declared: ACME_ROWS, existing: installed })).toEqual([]);
    expect(supersededStandingRows({ declared: ACME_ROWS, existing: installed, files })).toEqual([]);
    expect(installed.map((definition) => definition.recipeId)).toEqual([
      "bump-drive-acme-admin",
      "error-tracking-batch-acme-admin",
      "vulnerability-fix-topup-acme-admin",
    ]);
  });
});

describe("supersededStandingRowLine", () => {
  it("names both cadences and the verb that brings the row forward", () => {
    const line = supersededStandingRowLine({
      supersession: {
        ambiguousFiles: [],
        declaredCadence: "0 * * * *",
        recipeId: "worktree-prune",
        storedCadence: "0 4 * * *",
      },
    });
    expect(line).toBe(
      "!! worktree-prune · SUPERSEDED — the store still holds an earlier build's row, untouched, on `0 4 * * *` " +
        "where this build declares `0 * * * *`. Bring it forward with `slopweaver automation register-standing`",
    );
  });

  it("names every file an ambiguous id stands in, and the copy to keep", () => {
    const line = supersededStandingRowLine({
      supersession: {
        ambiguousFiles: ["worktree-prune.json", "zz-copy.json"],
        declaredCadence: "0 * * * *",
        recipeId: "worktree-prune",
        storedCadence: "0 4 * * *",
      },
    });
    expect(line).toBe(
      "!! worktree-prune · SUPERSEDED — the store still holds an earlier build's row, untouched, on `0 4 * * *` " +
        "where this build declares `0 * * * *`. It stands in worktree-prune.json, zz-copy.json, so " +
        "`slopweaver automation register-standing` leaves it: remove every copy but `worktree-prune.json`, then run it",
    );
  });
});
