/**
 * Unit: the pure pieces under a Make publish — the projections that cut an answer to its allowlist, the
 * coverage cells a fill earns, and the generation built in memory from a fill and what the store held.
 */
import { describe, expect, it } from "vitest";

import { kindCells } from "../../../../atlas/make/cells.js";
import { MAKE_ATLAS_DESCRIPTOR } from "../../../../atlas/make/descriptor.js";
import { hookDetail } from "../../../../atlas/make/details.js";
import {
  projectBlueprintOutline,
  projectExecutions,
  projectFolders,
  projectList,
} from "../../../../atlas/make/fill/project.js";
import type { MakeFillObservation } from "../../../../atlas/make/fill/run.js";
import { emptyMakeKindFiles, MAKE_ATLAS_KINDS } from "../../../../atlas/make/model.js";
import { buildMakeGeneration, type MakePriorGeneration } from "../../../../atlas/make/sync.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-10-15T00:00:00.000Z";
const LATER = "2026-10-16T00:00:00.000Z";

/** A fill that read one organisation and found no team under it. */
function teamlessFill({ at }: { at: string }): MakeFillObservation {
  return {
    filledAtIso: at,
    items: {
      connection: [],
      execution: [],
      folder: [],
      hook: [],
      organization: [{ detail: { id: 1, name: "Org", zone: "eu2.make.com" }, providerId: "1" }],
      scenario: [],
      team: [],
    },
    reached: ["organizations.list", "teams.list"],
  };
}

/** A store that held nothing before this run. */
const NOTHING_PRIOR: MakePriorGeneration = {
  files: {
    connection: null,
    execution: null,
    folder: null,
    hook: null,
    organization: null,
    scenario: null,
    team: null,
  },
  manifest: null,
};

describe("the Make model", () => {
  it("declares the seven kinds the descriptor carries, each with an empty file to start from", () => {
    expect([...MAKE_ATLAS_KINDS]).toStrictEqual(MAKE_ATLAS_DESCRIPTOR.kinds);
    expect(Object.keys(emptyMakeKindFiles({ at: AT })).toSorted()).toStrictEqual([...MAKE_ATLAS_KINDS].toSorted());
  });
});

describe("the projections", () => {
  it("strips every key a schema does not name, so a hook's URL never survives the cut", () => {
    const hook = {
      enabled: true,
      id: 1,
      name: "h",
      packageName: null,
      queueCount: 0,
      teamId: 2,
      type: "web",
      url: "u",
    };
    expect(Object.keys(hookDetail.parse(hook))).not.toContain("url");
    expect(Object.keys(hook)).toContain("url");
  });

  it("tags a list's items with the parent they were read under", () => {
    const items = unwrap(
      projectList({ body: [{ id: 10, name: "Ops", organizationId: 1 }], extra: { seenUnder: 1 }, what: "teams.list" }),
    );
    expect(items).toStrictEqual([
      { detail: { id: 10, name: "Ops", organizationId: 1, seenUnder: 1 }, providerId: "10" },
    ]);
  });

  it("refuses an executions page that is not a list, naming the read", () => {
    expect(unwrapErr(projectExecutions({ body: { nope: true }, scenarioId: 1 }))[0]).toContain("executions.list: ");
  });

  it("walks a folder tree to every depth", () => {
    const body = [
      {
        children: [{ children: [{ id: 3, name: "c", path: "a/b/c" }], id: 2, name: "b", path: "a/b" }],
        id: 1,
        name: "a",
        path: "a",
      },
    ];
    expect(unwrap(projectFolders({ body, teamId: 9 })).map((item) => item.detail["path"])).toStrictEqual([
      "a",
      "a/b",
      "a/b/c",
    ]);
  });

  it("outlines a blueprint depth-first through every route, keeping each app once", () => {
    const body = {
      flow: [
        { module: "slack:Watch" },
        {
          module: "builtin:BasicRouter",
          routes: [{ flow: [{ module: "slack:Post" }] }, { flow: [{ module: "jira:Create" }] }],
        },
      ],
    };
    expect(unwrap(projectBlueprintOutline({ body }))).toStrictEqual({
      appPrefixes: ["slack", "builtin", "jira"],
      moduleCount: 4,
      modules: ["slack:Watch", "builtin:BasicRouter", "slack:Post", "jira:Create"],
    });
  });
});

describe("kindCells", () => {
  it("says a read was never called because nothing above it was there, rather than calling it unread", () => {
    const cells = kindCells({ fill: teamlessFill({ at: AT }), kind: "hook" });
    expect(cells.map((cell) => `${cell.scope}:${cell.state}`)).toStrictEqual(["hooks.list:synced"]);
    expect(cells[0]!.reason).toBe("hooks.list (hooks_list) was not called: the token sees no team to read it under");
  });
});

describe("buildMakeGeneration", () => {
  it("publishes every kind as succeeded, with the organisation alone carrying the strict-boundary gap", () => {
    const generation = unwrap(buildMakeGeneration({ fill: teamlessFill({ at: AT }), prior: NOTHING_PRIOR }));
    expect(
      MAKE_ATLAS_KINDS.map((kind) => `${kind}:${String(generation.manifest.kinds[kind].entityCount)}`),
    ).toStrictEqual(["connection:0", "execution:0", "folder:0", "hook:0", "organization:1", "scenario:0", "team:0"]);
    expect(MAKE_ATLAS_KINDS.filter((kind) => generation.files[kind].gaps.length > 0)).toStrictEqual(["organization"]);
  });

  it("keeps an entity's first sighting from the prior generation", () => {
    const first = unwrap(buildMakeGeneration({ fill: teamlessFill({ at: AT }), prior: NOTHING_PRIOR }));
    const second = unwrap(buildMakeGeneration({ fill: teamlessFill({ at: LATER }), prior: first }));
    const api = second.files.organization.entities[0]!.channels.api!;
    expect([api.firstSeenAt, api.lastSeenAt]).toStrictEqual([AT, LATER]);
  });

  it("cuts a detail handed to it with secrets back to its kind's allowlist before anything is stored", () => {
    const leaky = { enabled: true, id: 55, name: "h", packageName: null, queueCount: 0, teamId: 10, type: "web" };
    const secrets = { data: { token: "SECRET-TOKEN" }, udid: "SECRET-UDID", url: "https://hook.make.com/SECRET" };
    const fill = teamlessFill({ at: AT });
    const handed = {
      ...fill,
      items: { ...fill.items, hook: [{ detail: { ...leaky, ...secrets }, providerId: "55" }] },
    };
    expect(JSON.stringify(handed.items.hook)).toContain("SECRET");
    const stored = unwrap(buildMakeGeneration({ fill: handed, prior: NOTHING_PRIOR })).files.hook.entities[0]!;
    expect(stored.channels.api!.detail).toStrictEqual(leaky);
  });

  it("refuses the whole generation when a detail fails its kind's allowlist, rather than storing it raw", () => {
    const fill = teamlessFill({ at: AT });
    const handed = {
      ...fill,
      items: { ...fill.items, hook: [{ detail: { url: "https://hook.make.com/SECRET" }, providerId: "55" }] },
    };
    const failure = unwrapErr(buildMakeGeneration({ fill: handed, prior: NOTHING_PRIOR }));
    expect(failure[0]).toContain("make hook 55: its detail fails the hook allowlist, nothing published");
    expect(failure.join("\n")).not.toContain("SECRET");
  });
});
