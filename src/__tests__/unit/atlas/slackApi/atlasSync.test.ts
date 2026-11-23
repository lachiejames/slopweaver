import { describe, expect, it } from "vitest";

import {
  assembleSlackApiGeneration,
  carriedBrowserCoverage,
  staleSlackApiChannel,
} from "../../../../atlas/slackApi/atlasApiSync.js";
import { walkTally } from "../../../../atlas/slackApi/atlasCoverage.js";
import type { SlackAtlasEntity, SlackAtlasKindFile } from "../../../../atlas/slackApi/atlasModel.js";
import { slackAtlasKindFileSchema, slackAtlasManifestSchema } from "../../../../atlas/slackApi/atlasModel.js";
import { projectApiMethods } from "../../../../atlas/slackApi/atlasProjection.js";
import { assembleSlackGeneration, screenshotRefusedBecause } from "../../../../atlas/slackApi/atlasSync.js";
import type { DrivenSession } from "../../../../atlas/slackApi/drivenSession.js";
import { foldSlackEntity, staleSlackEntity } from "../../../../atlas/slackApi/entityFold.js";
import { SLACK_SURFACE_PAGES } from "../../../../atlas/slackApi/surfacePages.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { capturedCall, drivenPage, sdkMethod, TEST_ROOTS, walkedPage } from "./slackAtlasFixtures.js";

const AT = "2026-08-31T09:00:00.000Z";
const EARLIER = "2026-08-30T09:00:00.000Z";
const EMPTY_STORE: Record<"method" | "page", SlackAtlasKindFile | null> = { method: null, page: null };

function session(over: Partial<DrivenSession> = {}): DrivenSession {
  return { pages: [walkedPage()], unreachable: [], workspaceId: "T0SYN1ABCDEFGH", ...over };
}

describe("foldSlackEntity", () => {
  const observed = projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!;

  it("takes a brand-new entity as-is", () => {
    expect(unwrap(foldSlackEntity({ observed, stored: undefined }))).toEqual(observed);
  });

  it("preserves the stored channel's original first-seen stamp", () => {
    const stored: SlackAtlasEntity = {
      ...observed,
      channels: { api: { ...observed.channels.api!, firstSeenAt: EARLIER }, browser: null },
    };
    expect(unwrap(foldSlackEntity({ observed, stored })).channels.api!.firstSeenAt).toBe(EARLIER);
  });

  it("stamps a channel the stored entity never held with this run's own first sight", () => {
    const browserChannel = { ...observed.channels.api!, channel: "browser" as const, firstSeenAt: EARLIER };
    const stored: SlackAtlasEntity = { ...observed, channels: { api: null, browser: browserChannel } };
    const folded = unwrap(foldSlackEntity({ observed, stored }));
    expect(folded.channels.api).toEqual(observed.channels.api);
    expect(folded.channels.api!.firstSeenAt).toBe(AT);
  });

  it("leaves the OTHER channel untouched — one surface never erases what the other knew", () => {
    const browserChannel = { ...observed.channels.api!, channel: "browser" as const, firstSeenAt: EARLIER };
    const stored: SlackAtlasEntity = { ...observed, channels: { api: null, browser: browserChannel } };
    expect(unwrap(foldSlackEntity({ observed, stored })).channels.browser).toEqual(browserChannel);
  });

  it("refuses two different things sharing one identity", () => {
    const stored: SlackAtlasEntity = { ...observed, kind: "page", providerId: "/client/<team>" };
    const refused = unwrapErr(foldSlackEntity({ observed, stored }));
    expect(refused[0]).toContain("is stored as page//client/<team> and this run saw method/conversations.history");
    expect(refused[1]).toContain("refusing to merge");
  });

  it("names the id and both identities in the refusal, then why it will not merge them", () => {
    const seen: SlackAtlasEntity = { ...observed, id: "e-1" };
    const stored: SlackAtlasEntity = { ...observed, id: "e-1", kind: "page", providerId: "/client/<team>" };
    expect(unwrapErr(foldSlackEntity({ observed: seen, stored }))).toEqual([
      "entity e-1 is stored as page//client/<team> and this run saw method/conversations.history",
      "refusing to merge — two different things sharing one identity is how an atlas starts reporting a thing that never existed",
    ]);
  });
});

describe("staleSlackEntity", () => {
  const observed = projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!;

  it("marks every populated channel stale", () => {
    expect(staleSlackEntity({ stored: observed })!.channels.api!.state).toBe("stale");
  });

  it("returns null for an entity already wholly stale, so its bytes do not churn", () => {
    const already: SlackAtlasEntity = {
      ...observed,
      channels: { api: { ...observed.channels.api!, state: "stale" }, browser: null },
    };
    expect(staleSlackEntity({ stored: already })).toBe(null);
  });
});

describe("assembleSlackGeneration", () => {
  const built = unwrap(
    assembleSlackGeneration({
      at: AT,
      roots: TEST_ROOTS,
      screenshots: new Map(),
      methods: [sdkMethod()],
      sdkVersion: "7.9.3",
      session: session(),
      stored: EMPTY_STORE,
    }),
  );

  it("writes both kind files in a shape the store will accept", () => {
    expect(slackAtlasKindFileSchema.safeParse(built.files.method).success).toBe(true);
    expect(slackAtlasKindFileSchema.safeParse(built.files.page).success).toBe(true);
  });

  it("writes a manifest in a shape the store will accept", () => {
    expect(slackAtlasManifestSchema.safeParse(built.manifest).success).toBe(true);
  });

  it("puts a FILLED browser channel on a real entity — the thing no atlas here has ever had", () => {
    const entity = built.files.method.entities.find((row) => row.providerId === "conversations.history")!;
    expect(entity.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("gives the method file one coverage cell per surface", () => {
    expect(built.files.method.coverage.map((cell) => cell.channel)).toEqual(["api", "browser"]);
  });

  it("reports the browser surface DEFERRED when one page of a whole declared map was walked", () => {
    // The denominator is the declared surface map, not what this walk attempted — which is the point of
    // declaring it. One page reached out of the whole declared map is `deferred`, and the old cell called it `synced`.
    expect(built.files.method.coverage[1]!.state).toBe("deferred");
    expect(built.files.method.coverage[1]!.reason).toContain("addressable declared page(s) reached");
  });

  it("names the corpus as the holder of the page contents this atlas deliberately does not keep", () => {
    const held = built.files.page.coverage.find((cell) => cell.state === "held-elsewhere")!;
    expect(held.scope).toBe("page-contents");
    expect(held.reason).toContain("slopweaver refresh --source slack");
  });

  it("declares every page in the surface map, whether or not the walk reached it", () => {
    expect(built.files.page.entities.length).toBe(SLACK_SURFACE_PAGES.length);
    const today = built.files.page.entities.find((page) => page.providerId === "/client/<team>/today")!;
    expect(today.channels.api!.source!.deepLink).toBe("https://app.slack.com/client/E0SYN1ABCDEFGH/today");
    expect(today.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("publishes a pane with no address as declared-and-unlinkable rather than as a failure", () => {
    const pane = built.files.page.entities.find((page) => page.providerId === "/client/<team>#threads")!;
    expect(pane.channels.api!.source!.deepLink).toBe(null);
    expect(pane.channels.api!.source!.deepLinkStatus).toBe("unavailable");
  });

  it("raises an admin-entitlement gap for an admin page the walk did not reach", () => {
    const admin = built.files.page.gaps.find((gap) => gap.scope === "/<workspace>/admin")!;
    expect(admin.condition).toBe("admin-entitlement-missing");
    expect(admin.reason).toContain("admin role, and the walk's signed-in session did not reach it");
  });

  it("raises a required-screenshot gap for a settings page the walk photographed nothing of", () => {
    const owed = built.files.page.gaps.find(
      (gap) => gap.scope === "/<workspace>/account/settings" && gap.condition === "required-screenshot-missing",
    )!;
    expect(owed.reason).toContain("this run did not stand on");
  });

  /** The required-screenshot gap a walk that stood on the settings page leaves, given what it says of its picture. */
  function settingsShotGap({ walkReason }: { walkReason: string | null }): string {
    const settings = "/<workspace>/account/settings";
    const generation = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({
          pages: [walkedPage({ path: settings, screenshotMissingBecause: walkReason, screenshotPath: "shot.png" })],
        }),
        stored: EMPTY_STORE,
      }),
    );
    return generation.files.page.gaps.find(
      (gap) => gap.scope === settings && gap.condition === "required-screenshot-missing",
    )!.reason;
  }

  it("says this run holds no picture of a required page the walk photographed but sync stored none of", () => {
    expect(settingsShotGap({ walkReason: null })).toBe(
      "/<workspace>/account/settings is a page the owner asked to be photographed, and this run holds no " +
        "picture of /<workspace>/account/settings",
    );
  });

  it("carries the walk's own reason onto a required page it could not photograph", () => {
    expect(settingsShotGap({ walkReason: "the capture timed out" })).toBe(
      "/<workspace>/account/settings is a page the owner asked to be photographed, and the capture timed out",
    );
  });

  it("reports the browser surface unreadable when the walk reached nothing", () => {
    const empty = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({ pages: [], unreachable: [{ path: "/client/<team>", reason: "timed out" }] }),
        stored: EMPTY_STORE,
      }),
    );
    expect(empty.files.method.coverage[1]!.state).toBe("unreadable");
  });

  it("raises a page gap for every destination the walk could not reach", () => {
    const partial = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({ unreachable: [{ path: "/client/<team>/browse-lists", reason: "404" }] }),
        stored: EMPTY_STORE,
      }),
    );
    expect(partial.files.page.gaps.filter((gap) => gap.condition === "browser-surface-unreadable")).toEqual([
      expect.objectContaining({ reason: "404", scope: "/client/<team>/browse-lists" }),
    ]);
  });

  it("raises a disagreement gap when the web client sent a parameter the SDK does not declare", () => {
    const disagreeing = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({ pages: [walkedPage({ calls: [capturedCall({ paramNames: ["channel", "x_undoc"] })] })] }),
        stored: EMPTY_STORE,
      }),
    );
    expect(disagreeing.files.method.gaps.map((gap) => gap.condition)).toEqual(["api-browser-disagreement"]);
  });

  it("closes a stored disagreement once the two surfaces agree again", () => {
    const first = unwrap(
      assembleSlackGeneration({
        at: EARLIER,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({ pages: [walkedPage({ calls: [capturedCall({ paramNames: ["channel", "x_undoc"] })] })] }),
        stored: EMPTY_STORE,
      }),
    );
    const second = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [
          sdkMethod({
            params: [
              { name: "channel", optional: false, type: "string" },
              { name: "x_undoc", optional: true, type: "string" },
            ],
          }),
        ],
        sdkVersion: "7.9.3",
        session: session({ pages: [walkedPage({ calls: [capturedCall({ paramNames: ["channel", "x_undoc"] })] })] }),
        stored: { method: first.files.method, page: first.files.page },
      }),
    );
    expect(second.files.method.gaps.map((gap) => gap.status)).toEqual(["closed"]);
  });

  it("accumulates: a method a later run did not see is staled, never dropped", () => {
    const first = unwrap(
      assembleSlackGeneration({
        at: EARLIER,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({ pages: [walkedPage({ calls: [capturedCall({ name: "client.counts" })] })] }),
        stored: EMPTY_STORE,
      }),
    );
    const second = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session({ pages: [walkedPage({ calls: [capturedCall()] })] }),
        stored: { method: first.files.method, page: first.files.page },
      }),
    );
    const dropped = second.files.method.entities.find((row) => row.providerId === "client.counts")!;
    expect(dropped.channels.browser!.state).toBe("stale");
  });

  it("summarises what the comparison found", () => {
    expect(built.summary).toMatchObject({ apiOnly: 0, both: 1, browserOnly: 0, methods: 1 });
  });

  it("is idempotent — two runs over the same data produce the same entities", () => {
    const again = unwrap(
      assembleSlackGeneration({
        at: AT,
        roots: TEST_ROOTS,
        screenshots: new Map(),
        methods: [sdkMethod()],
        sdkVersion: "7.9.3",
        session: session(),
        stored: { method: built.files.method, page: built.files.page },
      }),
    );
    expect(again.files.method.entities).toEqual(built.files.method.entities);
  });
});

describe("screenshotRefusedBecause", () => {
  it("refuses a picture of a page the surface map marks refused", () => {
    expect(screenshotRefusedBecause({ path: "/client/<team>/dms" })).toContain("the surface map refuses a picture");
  });

  it("permits a picture of a settings page the owner asked to be photographed", () => {
    expect(screenshotRefusedBecause({ path: "/<workspace>/account/settings" })).toBe(null);
  });

  it("refuses a picture of a page nobody declared, rather than defaulting to yes", () => {
    // The direction matters: defaulting to "photograph it" is what publishes something nobody asked for.
    expect(screenshotRefusedBecause({ path: "/<workspace>/whatever" })).toContain("not in the declared surface map");
  });
});

describe("walkTally", () => {
  it("counts a reached page against the DECLARED map, not against what the walk attempted", () => {
    const tally = walkTally({ walked: [drivenPage()] });
    expect(tally.reached).toBe(1);
    expect(tally.declared).toBe(SLACK_SURFACE_PAGES.filter((page) => page.notNavigableBecause === null).length);
  });

  it("counts every required picture still owed, so a run that photographed nothing cannot read complete", () => {
    const owed = SLACK_SURFACE_PAGES.filter(
      (page) => page.notNavigableBecause === null && page.screenshot === "required",
    ).length;
    expect(walkTally({ walked: [] }).shotsOwed).toBe(owed);
  });

  it("credits a picture only against the page it was taken of", () => {
    expect(walkTally({ walked: [drivenPage()] }).photographed).toBe(1);
    expect(walkTally({ walked: [drivenPage({ screenshot: null })] }).photographed).toBe(0);
  });

  it("counts the rows no walk may address separately from the ones it failed to reach", () => {
    const unaddressable = SLACK_SURFACE_PAGES.filter((page) => page.notNavigableBecause !== null).length;
    expect(walkTally({ walked: [] }).unaddressable).toBe(unaddressable);
  });
});

describe("staleSlackApiChannel", () => {
  const observed = projectApiMethods({ at: AT, methods: [sdkMethod()] })[0]!;
  const browserChannel = { ...observed.channels.api!, channel: "browser" as const, firstSeenAt: EARLIER };

  it("stales the api channel and leaves the browser channel byte-identical", () => {
    const stored: SlackAtlasEntity = { ...observed, channels: { api: observed.channels.api, browser: browserChannel } };
    const staled = staleSlackApiChannel({ stored })!;
    expect(staled.channels.api!.state).toBe("stale");
    expect(staled.channels.browser).toEqual(browserChannel);
  });

  it("returns null for a browser-only method — not looked for is not gone", () => {
    const stored: SlackAtlasEntity = { ...observed, channels: { api: null, browser: browserChannel } };
    expect(staleSlackApiChannel({ stored })).toBe(null);
  });

  it("returns null when the api channel is already stale, so its bytes do not churn", () => {
    const stored: SlackAtlasEntity = {
      ...observed,
      channels: { api: { ...observed.channels.api!, state: "stale" }, browser: null },
    };
    expect(staleSlackApiChannel({ stored })).toBe(null);
  });
});

describe("assembleSlackApiGeneration", () => {
  /** A walked generation to stand on, so the API-only run has a browser surface to carry forward. */
  const walked = unwrap(
    assembleSlackGeneration({
      at: EARLIER,
      roots: TEST_ROOTS,
      screenshots: new Map(),
      methods: [sdkMethod()],
      sdkVersion: "7.9.3",
      session: session({
        pages: [walkedPage({ calls: [capturedCall(), capturedCall({ name: "client.boot", paramNames: [] })] })],
      }),
      stored: EMPTY_STORE,
    }),
  );
  const LATER_SDK = "7.9.4";
  const refreshed = unwrap(
    assembleSlackApiGeneration({
      at: AT,
      methods: [sdkMethod({ name: "conversations.info" })],
      priorManifest: walked.manifest,
      sdkVersion: LATER_SDK,
      stored: walked.files.method,
    }),
  );

  it("writes the method kind alone, in a shape the store will accept", () => {
    expect(Object.keys(refreshed.files)).toEqual(["method"]);
    expect(slackAtlasKindFileSchema.safeParse(refreshed.files.method).success).toBe(true);
    expect(slackAtlasManifestSchema.safeParse(refreshed.manifest).success).toBe(true);
  });

  it("keeps a browser-only method the SDK never declared exactly as the walk left it", () => {
    const boot = refreshed.files.method.entities.find((row) => row.providerId === "client.boot")!;
    expect(boot).toEqual(walked.files.method.entities.find((row) => row.providerId === "client.boot")!);
  });

  it("stales only the api channel of a method this SDK read dropped, keeping what the browser saw", () => {
    const history = refreshed.files.method.entities.find((row) => row.providerId === "conversations.history")!;
    expect(history.channels.api!.state).toBe("stale");
    expect(history.channels.browser!.state).toBe("observed");
    expect(history.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("adds a method the newer SDK declares, with an empty browser channel", () => {
    const info = refreshed.files.method.entities.find((row) => row.providerId === "conversations.info")!;
    expect(info.channels.api!.state).toBe("observed");
    expect(info.channels.browser).toBe(null);
  });

  it("rebuilds the api cell from this read and carries the browser cell forward verbatim", () => {
    expect(refreshed.files.method.coverage[0]!.reason).toBe(`1 method(s) declared by @slack/web-api ${LATER_SDK}`);
    expect(refreshed.files.method.coverage[1]).toEqual(walked.files.method.coverage[1]);
  });

  it("stamps the method kind now and carries the page kind's status from the prior manifest", () => {
    expect(refreshed.manifest.kinds.method.lastSuccessAt).toBe(AT);
    expect(refreshed.manifest.kinds.page).toEqual(walked.manifest.kinds.page);
    expect(refreshed.manifest.sdkVersion).toBe(LATER_SDK);
  });

  it("on an install that has never walked, says so with no success stamp rather than claiming a failed walk", () => {
    const fresh = unwrap(
      assembleSlackApiGeneration({
        at: AT,
        methods: [sdkMethod()],
        priorManifest: null,
        sdkVersion: "7.9.3",
        stored: null,
      }),
    );
    const cell = carriedBrowserCoverage({ stored: null });
    expect(fresh.files.method.coverage[1]).toEqual(cell);
    expect(cell.state).toBe("deferred");
    expect(cell.lastSuccessAt).toBe(null);
    expect(cell.latestAttemptFailed).toBe(false);
    expect(cell.reason).toContain("slopweaver atlas slack-drive plan");
    expect(fresh.manifest.kinds.page).toEqual({ digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null });
  });
});
