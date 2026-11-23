/**
 * What a compiled generation says about itself, the one thing it refuses to publish, and what it must never
 * take away from the channel beside it.
 *
 * The control invariant is the load-bearing check: the whole route surface rests on two 404s meaning
 * different things, so a table whose control has stopped grading `not-routed` is measuring nothing — and an
 * atlas that published one anyway would fill itself with routes that do not exist and nothing would notice.
 *
 * The fold is the second one. Built as a whole-generation overwrite, this half emptied the `page` kind on
 * every run that followed a walk, and only `kit/evidenceLoss.ts` stood between it and seventeen real pages —
 * refusing every jam resync after a walk.
 */
import { describe, expect, it } from "vitest";

import type { JamPageObservation } from "../../../../atlas/jam/browserWalk.js";
import { succeededJamCoverageCell } from "../../../../atlas/jam/coverage.js";
import { openJamGap } from "../../../../atlas/jam/gaps.js";
import {
  emptyJamKindFile,
  initialJamManifest,
  JAM_ATLAS_KINDS,
  type JamAtlasKindFile,
  type JamAtlasManifest,
} from "../../../../atlas/jam/model.js";
import { projectJamPage } from "../../../../atlas/jam/projection.js";
import { JAM_WEB_APP_SURFACE } from "../../../../atlas/jam/surfaces.js";
import { buildJamGeneration } from "../../../../atlas/jam/sync.js";
import { compiledRechecks } from "../../../../atlas/jam/syncGaps.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-09-07T00:00:00.000Z";

/** The instant a walk landed, kept distinct from {@link AT} so a carried-forward value cannot look fresh. */
const WALKED_AT = "2026-09-05T00:00:00.000Z";

/** The reason on the stored browser cell, which the sync must not replace with a not-configured one. */
const WALKED_CELL_REASON = "3 of 3 declared pages reached in the owner's own Chrome";

/** One page observation, varied only in the surface that becomes its provider key. */
function observation({ surface }: { surface: string }): JamPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: `https://jam.dev/s/team-0000/${surface}`,
    observedAt: WALKED_AT,
    redirected: false,
    requestedUrl: `https://jam.dev/s/team-0000/${surface}`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 2, eligible: 2, seen: 40 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface,
    title: "Jam",
    unreachableBecause: null,
  };
}

/** The surfaces the fixture walk landed, in the order it landed them. */
const WALKED_SURFACES = ["dashboard", "members", "settings"];

/** The `page` file as a store that HAS been walked holds it: browser entities, cell and gap, no compiled. */
function walkedPageFile(): JamAtlasKindFile {
  return {
    ...emptyJamKindFile({ kind: "page", updatedAt: WALKED_AT }),
    coverage: [
      succeededJamCoverageCell({
        artifacts: [],
        at: WALKED_AT,
        channel: "browser",
        reason: WALKED_CELL_REASON,
        role: "authoritative",
        scope: "jam",
        state: "synced",
        surface: JAM_WEB_APP_SURFACE,
      }),
    ],
    entities: WALKED_SURFACES.map((surface) => projectJamPage({ at: WALKED_AT, page: observation({ surface }) })),
    gaps: [
      openJamGap({
        at: WALKED_AT,
        condition: "web-page-unreachable",
        fields: [],
        kind: "page",
        reason: "the application rendered its own not-found page at this route, so it was never landed",
        scope: "billing",
        surfaces: ["browser"],
      }),
    ],
  };
}

/** The manifest a store that has been walked holds: `page` carries a real success the sync must not drop. */
function walkedManifest(): JamAtlasManifest {
  const initial = initialJamManifest({ updatedAt: WALKED_AT });
  return {
    ...initial,
    kinds: {
      ...initial.kinds,
      page: {
        digest: null,
        entityCount: WALKED_SURFACES.length,
        lastAttempt: { at: WALKED_AT, outcome: "ok", reasons: [] },
        lastSuccessAt: WALKED_AT,
      },
    },
  };
}

describe("buildJamGeneration", () => {
  it("has at least one entry in JAM_ATLAS_KINDS, so the guards below are not vacuously green", () => {
    expect(JAM_ATLAS_KINDS.length).toBeGreaterThan(0);
  });

  it("publishes a file for every declared kind", () => {
    const built = buildJamGeneration({ at: AT });
    expect(built.isOk()).toBe(true);
    const { files } = unwrap(built);
    expect(Object.keys(files).toSorted()).toEqual([...JAM_ATLAS_KINDS].toSorted());
  });

  it("fills the four compiled kinds and deliberately leaves `page` for the walk", () => {
    const { files, manifest } = unwrap(buildJamGeneration({ at: AT }));
    expect(files.operation.entities.length).toBe(14);
    expect(files.scope.entities.length).toBe(4);
    expect(files.route.entities.length).toBe(23);
    expect(files.integration.entities.length).toBe(9);
    expect(files.page.entities.length).toBe(0);
    expect(manifest.kinds.page.lastSuccessAt).toBe(null);
  });

  it("RECORDS an attempt on `page` even though it has no success, so a reader can tell the two apart", () => {
    const { manifest } = unwrap(buildJamGeneration({ at: AT }));
    expect(manifest.kinds.page.lastAttempt?.outcome).toBe("ok");
    expect(manifest.kinds.page.lastSuccessAt).toBe(null);
  });

  it("gives every kind a not-configured cell for both unfilled channels, naming what would unblock each", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    for (const kind of JAM_ATLAS_KINDS) {
      const unconfigured = files[kind].coverage.filter((cell) => cell.state === "not-configured");
      expect(unconfigured.length).toBe(2);
      for (const cell of unconfigured) {
        expect(cell.unblockedBy).toContain("slopweaver");
      }
    }
  });

  it("raises the finding that the published API returns no product noun, on the operation kind", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    const gap = files.operation.gaps.find((row) => row.condition === "published-api-declares-no-product-operation");
    expect(gap?.status).toBe("open");
    expect(gap?.reason).toContain("not one of them returns a jam");
  });

  it("raises the undeclared MCP host on the route kind, naming the host in its fields", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    const gap = files.route.gaps.find((row) => row.condition === "undeclared-resource-host");
    expect(gap?.fields).toEqual(["https://mcp.jam.dev"]);
  });

  it("raises all four scopes as named by no operation, listing them", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    const gap = files.scope.gaps.find((row) => row.condition === "scope-named-by-no-operation");
    expect(gap?.fields).toEqual(["cli:read", "cli:write", "mcp:read", "mcp:write"]);
  });

  it("raises the two documents' disagreement over exactly the scopes only one of them claims", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    const gap = files.scope.gaps.find((row) => row.condition === "discovery-documents-disagree");
    expect(gap?.fields).toEqual(["cli:read", "cli:write"]);
  });

  it("carries the disclosure bound as an OPEN gap on the page kind rather than only in prose", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    const gap = files.page.gaps.find((row) => row.condition === "jam-payload-withheld-on-disclosure");
    expect(gap?.status).toBe("open");
    expect(gap?.reason).toContain("customer-adjacent");
  });

  it("gives every gap on one kind its own identity, so a recheck cannot close another kind's", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT }));
    for (const kind of JAM_ATLAS_KINDS) {
      const ids = files[kind].gaps.map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("writes byte-identical files for two runs given the same instant", () => {
    const first = JSON.stringify(unwrap(buildJamGeneration({ at: AT })));
    const second = JSON.stringify(unwrap(buildJamGeneration({ at: AT })));
    expect(first).toBe(second);
  });
});

describe("buildJamGeneration folded onto a store the walk has already filled", () => {
  /** The whole held generation a walked store presents. */
  const held = { files: { page: walkedPageFile() }, manifest: walkedManifest() };

  it("has a fixture that actually carries walked pages, so every assertion below can fail", () => {
    expect(walkedPageFile().entities.length).toBe(3);
    expect(
      walkedPageFile()
        .entities.map((entity) => entity.providerId)
        .toSorted(),
    ).toEqual(WALKED_SURFACES);
  });

  it("carries every walked page forward, where a whole-generation publish emptied the kind", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT, held }));
    expect(files.page.entities.length).toBe(3);
    expect(files.page.entities.map((entity) => entity.providerId).toSorted()).toEqual(WALKED_SURFACES);
  });

  it("leaves a carried page's browser channel exactly as the walk observed it", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT, held }));
    const settings = files.page.entities.find((entity) => entity.providerId === "settings")!;
    expect(settings.channels.browser?.lastSeenAt).toBe(WALKED_AT);
    expect(settings.channels.browser?.state).toBe("observed");
    expect(settings.channels.compiled).toBe(null);
  });

  it("still rebuilds the compiled kinds from the committed table, so the fold is not carry-everything", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT, held }));
    expect(files.operation.entities.length).toBe(14);
    expect(files.scope.entities.length).toBe(4);
    expect(files.route.entities.length).toBe(23);
    expect(files.integration.entities.length).toBe(9);
  });

  it("keeps the cell the walk earned instead of claiming the browser is not configured", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT, held }));
    const reasons = files.page.coverage.map((cell) => cell.reason);
    expect(reasons).toContain(WALKED_CELL_REASON);
    expect(reasons).not.toContain("no page has been visited or witnessed in the owner's own Chrome");
  });

  it("still writes a not-configured cell for the channel nothing HAS reached", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT, held }));
    const unconfigured = files.page.coverage.filter((cell) => cell.state === "not-configured");
    expect(unconfigured.length).toBe(1);
    expect(unconfigured[0]!.channel).toBe("api");
  });

  it("keeps a gap only the walk could have opened, because a sync rechecks nothing the browser saw", () => {
    const { files } = unwrap(buildJamGeneration({ at: AT, held }));
    const carried = files.page.gaps.find((gap) => gap.condition === "web-page-unreachable");
    expect(carried?.status).toBe("open");
    expect(carried?.scope).toBe("billing");
  });

  it("leaves a gap the walk opened untouched, because no recheck of the compiled channel names it", () => {
    const rechecked = new Set(compiledRechecks({ kind: "page" }).map((recheck) => recheck.condition));
    expect(rechecked.has("web-page-unreachable")).toBe(false);
    expect(rechecked.size).toBeGreaterThan(0);
  });

  it("keeps the walk's own success in the manifest, and records this run as the latest attempt", () => {
    const { manifest } = unwrap(buildJamGeneration({ at: AT, held }));
    expect(manifest.kinds.page.lastSuccessAt).toBe(WALKED_AT);
    expect(manifest.kinds.page.entityCount).toBe(3);
    expect(manifest.kinds.page.lastAttempt?.at).toBe(AT);
  });

  it("leaves a DEFERRED kind's file clock where the channel that filled it put it", () => {
    const { files, manifest } = unwrap(buildJamGeneration({ at: AT, held }));
    expect(files.page.updatedAt).toBe(manifest.kinds.page.lastSuccessAt);
    expect(files.page.updatedAt).toBe(WALKED_AT);
  });

  it("moves a FILLED kind's file clock to this run, in step with the success stamped beside it", () => {
    const { files, manifest } = unwrap(buildJamGeneration({ at: AT, held }));
    expect(files.operation.updatedAt).toBe(manifest.kinds.operation.lastSuccessAt);
    expect(files.operation.updatedAt).toBe(AT);
  });
});

describe("compiledRechecks", () => {
  /** The two conditions the compiled channel raises only when the committed table still carries them. */
  const CONDITIONAL_SCOPE_CONDITIONS = ["discovery-documents-disagree", "scope-named-by-no-operation"];

  it("names every condition the compiled channel can raise on a kind, so none can be stuck open", () => {
    for (const kind of JAM_ATLAS_KINDS) {
      const { files } = unwrap(buildJamGeneration({ at: AT }));
      const rechecked = new Set(
        compiledRechecks({ kind }).map((recheck) => `${recheck.condition} on ${recheck.scope}`),
      );
      const raised = files[kind].gaps.map((gap) => `${gap.condition} on ${gap.scope}`);
      expect(raised.length).toBeGreaterThan(0);
      expect(raised.filter((pair) => !rechecked.has(pair))).toEqual([]);
    }
  });

  it("marks every recheck resolved, so a condition this run did not raise is the one that closes", () => {
    const unresolved = JAM_ATLAS_KINDS.flatMap((kind) =>
      compiledRechecks({ kind }).filter((recheck) => !recheck.resolved),
    );
    expect(unresolved).toEqual([]);
  });

  it("covers the two conditions that can genuinely stop being raised, which is why the list exists", () => {
    const conditions = compiledRechecks({ kind: "scope" })
      .map((recheck) => recheck.condition)
      .toSorted();
    expect(conditions).toContain(CONDITIONAL_SCOPE_CONDITIONS[0]);
    expect(conditions).toContain(CONDITIONAL_SCOPE_CONDITIONS[1]);
  });
});
