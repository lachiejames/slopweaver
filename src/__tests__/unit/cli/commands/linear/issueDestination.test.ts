/** The destination gates of `linear issue`: which writes meet the retired-team gate, and that it joins the rest. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "neverthrow";
import { afterEach, describe, expect, it } from "vitest";

import { destinationRefusals, issueRetiredTeamRefusals } from "../../../../../cli/commands/linear/issueDestination.js";
import type { LinearWriteDeps } from "../../../../../cli/commands/linear/writeDeps.js";
import type { AssigneeResolution } from "../../../../../outbound/linear/assigneeIndex.js";
import type { LinearIssueArtifact, LinearIssueFields } from "../../../../../outbound/linear/types.js";
import { IdentityRosterErrors } from "../../../../../silver/identityRosterErrors.js";
import { stateHomePaths } from "../../../../../stateHome.js";
import { memoryAutonomyLedgerPort } from "../../../../autonomyLedgerFixture.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { emptyMentionResolution } from "../../../../linearMentionFixtures.js";

const SUP_ID = "26397148-cb19-4cd5-bf02-60964b2c2a78";
const SOPS_ID = "5fd296ef-baa7-4bc4-ab3d-3afbc6202759";

const homes: string[] = [];

/** A state home whose retired-teams list names SUP. */
function retiringHome(): string {
  const home = mkdtempSync(join(tmpdir(), "issue-destination-"));
  homes.push(home);
  const list = { teams: [{ fileInstead: "SOPS", teamId: SUP_ID, teamKey: "SUP", why: "they left SUP" }] };
  writeFileSync(stateHomePaths({ home }).linearRetiredTeamsJson, JSON.stringify(list));
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

const ARTIFACT: LinearIssueArtifact = {
  aiPrompt: [{ kind: "para", text: "**Goal.** Do it." }],
  kind: "structured",
  problem: [{ kind: "para", text: "It is broken." }],
  solution: [{ kind: "para", text: "Unbreak it." }],
};

const EMPTY_RESOLUTION: AssigneeResolution = {
  held: false,
  roster: { addressableKeys: 0, collisions: [], derivedPeople: 0, freshness: { kind: "fresh" }, heldPeople: 0 },
  target: undefined,
};

const NOT_THIS_GATE = (): never => {
  throw new Error("the destination gates never reach this edge");
};

const DEPS: LinearWriteDeps = {
  autonomy: memoryAutonomyLedgerPort(),
  bareRefContext: () => ({ repos: [] }),
  doorLedger: memoryDoorLedger().port,
  env: () => undefined,
  err: NOT_THIS_GATE,
  makeApi: NOT_THIS_GATE,
  nowIso: () => "2026-10-24T03:00:00.000Z",
  out: NOT_THIS_GATE,
  previewAssignee: async () => ok(EMPTY_RESOLUTION),
  previewMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
  readForm: NOT_THIS_GATE,
  resolveAssignee: async () => ok(EMPTY_RESOLUTION),
  resolveMentions: async ({ keys }) => ok(emptyMentionResolution({ keys })),
  resolveToken: NOT_THIS_GATE,
  stateCatalog: () => undefined,
};

/** The refusal lines for one write into `teamId`. */
async function refusalsFor({
  deps = DEPS,
  fields,
  moveTeam,
  verb,
}: {
  deps?: LinearWriteDeps;
  fields: LinearIssueFields;
  moveTeam: boolean;
  verb: "create" | "update";
}): Promise<readonly string[]> {
  const gated = await destinationRefusals({
    artifact: ARTIFACT,
    deps,
    fields,
    fieldsOnly: true,
    home: retiringHome(),
    moveTeam,
    verb,
    verified: new Map(),
  });
  return gated.refusals;
}

const STORE_DOWN = IdentityRosterErrors.storeUnavailable({ doing: "read the roster", reason: "disk full" });

describe("destinationRefusals", () => {
  it("refuses a create into a retired team, naming the team to file into instead", async () => {
    const lines = await refusalsFor({ fields: { teamId: SUP_ID, title: "t" }, moveTeam: false, verb: "create" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("slopweaver linear issue create files into SUP");
    expect(lines[0]).toContain("file into SOPS instead");
  });

  it("refuses a --move-team update into a retired team", async () => {
    const lines = await refusalsFor({ fields: { teamId: SUP_ID, title: "t" }, moveTeam: true, verb: "update" });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("slopweaver linear issue update files into SUP");
  });

  it("passes an update without --move-team, which sends no team and so files nothing anywhere new", async () => {
    expect(await refusalsFor({ fields: { teamId: SUP_ID, title: "t" }, moveTeam: false, verb: "update" })).toEqual([]);
  });

  it("still refuses when the form clears the assignee, the branch that skips the roster", async () => {
    const lines = await refusalsFor({
      fields: { assignee: null, teamId: SUP_ID, title: "t" },
      moveTeam: false,
      verb: "create",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("which this install retired");
  });

  it("passes a create into a team the install did not retire", async () => {
    expect(await refusalsFor({ fields: { teamId: SOPS_ID, title: "t" }, moveTeam: false, verb: "create" })).toEqual([]);
  });

  it("refuses with the roster's own message when the store cannot answer who the assignee names", async () => {
    const lines = await refusalsFor({
      deps: { ...DEPS, resolveAssignee: async () => err(STORE_DOWN) },
      fields: { assignee: "ada", teamId: SOPS_ID, title: "t" },
      moveTeam: false,
      verb: "create",
    });

    expect(lines).toEqual([STORE_DOWN.message]);
  });

  it("refuses with the roster's own message when the store cannot resolve the body's mentions", async () => {
    const lines = await refusalsFor({
      deps: { ...DEPS, resolveMentions: async () => err(STORE_DOWN) },
      fields: { teamId: SOPS_ID, title: "t" },
      moveTeam: false,
      verb: "create",
    });

    expect(lines).toEqual([STORE_DOWN.message]);
  });
});

describe("issueRetiredTeamRefusals", () => {
  it("refuses a create into a retired team on its own, which is what the dry run previews", async () => {
    const lines = issueRetiredTeamRefusals({
      deps: DEPS,
      home: retiringHome(),
      moveTeam: false,
      teamId: SUP_ID,
      verb: "create",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("slopweaver linear issue create files into SUP");
  });

  it("passes an update without --move-team even when its form names a retired team", async () => {
    const lines = issueRetiredTeamRefusals({
      deps: DEPS,
      home: retiringHome(),
      moveTeam: false,
      teamId: SUP_ID,
      verb: "update",
    });

    expect(lines).toEqual([]);
  });
});
