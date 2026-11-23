import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { refuseUndeclaredWalk, verifyArtifactsOnDisk } from "../../../../atlas/kit/walkPublish.js";
import { NOTION_BROWSER_PAGES } from "../../../../atlas/notion/browserPages.js";
import { publishNotionBrowserWalk } from "../../../../atlas/notion/browserSurface.js";
import type { NotionBrowserWalkResult, NotionPageObservation } from "../../../../atlas/notion/browserWalk.js";
import { initialNotionManifest } from "../../../../atlas/notion/model.js";
import {
  type NotionAtlasPaths,
  notionAtlasPaths,
  publishNotionAtlas,
  readNotionKindFile,
  readNotionManifest,
  withNotionPublishLock,
} from "../../../../atlas/notion/store.js";
import { syncNotionApiSurface } from "../../../../atlas/notion/sync.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-05T00:00:00.000Z";

let home: string;
let paths: NotionAtlasPaths;

/** The bytes every fixture screenshot is, and the digest they address it by. */
const SHOT_BYTES = new Uint8Array([137, 80, 78, 71]);
const SHOT_SHA = createHash("sha256").update(SHOT_BYTES).digest("hex");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-notion-atlas-"));
  paths = notionAtlasPaths({ home });
  // A held page's screenshot must be ON DISK: the publisher re-checks every reference against the bytes,
  // because a reference a caller fabricated is exactly the counterexample a Codex pass found.
  mkdirSync(paths.pageArtifacts, { recursive: true });
  writeFileSync(join(paths.directory, `artifacts/pages/${SHOT_SHA}.png`), SHOT_BYTES);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One observation, with every field set so a test states only what it is about. */
function observation(over: Partial<NotionPageObservation> = {}): NotionPageObservation {
  return {
    // A held page carries the artifact that proves it. Building these EMPTY is exactly the counterexample a
    // Codex pass found: the rows looked complete, `isPageHeld` said so, and no screenshot existed anywhere.
    artifacts: [
      {
        byteLength: SHOT_BYTES.byteLength,
        kind: "page-png",
        mediaType: "image/png",
        relativePath: `artifacts/pages/${SHOT_SHA}.png`,
        sha256: SHOT_SHA,
      },
    ],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: "https://app.notion.com/space/my-account",
    observedAt: AT,
    redirected: false,
    requestedUrl: "https://app.notion.com/space/my-account",
    responseAccounting: { bodyFailed: 0, bodySucceeded: 3, eligible: 3, seen: 9 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "account-profile",
    title: "Notion",
    unreachableBecause: null,
    ...over,
  };
}

/** A walk result over exactly the observations a test names. */
function walk({
  pages,
  sessionLost = false,
}: {
  pages: readonly NotionPageObservation[];
  sessionLost?: boolean;
}): NotionBrowserWalkResult {
  return { pages, sessionLost, workspaceRootFound: true };
}

/** Every declared page, held and photographed — the shape of a complete run. */
function everyPageHeld(): readonly NotionPageObservation[] {
  return NOTION_BROWSER_PAGES.map((page) => observation({ surface: page.surface }));
}

describe("publishNotionBrowserWalk", () => {
  it("publishes one page entity per declared page", () => {
    const outcome = unwrap(publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) }));
    expect(outcome.declaredCount).toBe(NOTION_BROWSER_PAGES.length);
  });

  it("counts a page reached and photographed in both tallies", () => {
    const outcome = unwrap(publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) }));
    expect(outcome.photographedCount).toBe(NOTION_BROWSER_PAGES.length);
  });

  it("grades a complete run synced", () => {
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) });
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "browser-walk")!.state).toBe("synced");
  });

  it("REFUSES to grade a run synced when it reached every page and photographed none", () => {
    const pages = everyPageHeld().map((page) => ({ ...page, screenshotMissingBecause: "no PNG came back" }));
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages }) });
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "browser-walk")!.state).toBe("deferred");
  });

  it("puts both fractions in the deferred cell's reason, so the shortfall is a number", () => {
    const pages = everyPageHeld().map((page) => ({ ...page, screenshotMissingBecause: "no PNG came back" }));
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages }) });
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "browser-walk")!.reason).toBe(
      `${String(NOTION_BROWSER_PAGES.length)} of ${String(NOTION_BROWSER_PAGES.length)} declared page(s) reached, 0 of those also photographed`,
    );
  });

  it("opens the standing gap that says the denominator is a hand list", () => {
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) });
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.gaps.map((gap) => gap.condition)).toContain("provider-publishes-no-browser-inventory");
  });

  it("raises a surface-unreadable gap when the session was lost", () => {
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld(), sessionLost: true }) });
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.gaps.map((gap) => gap.condition)).toContain("browser-surface-unreadable");
  });

  it("grades the observed operations as discovery, never as corroboration", () => {
    const pages = everyPageHeld().map((page) => ({
      ...page,
      calls: [
        {
          method: "POST",
          operation: "getSpaces",
          pathShape: "/api/v3/getSpaces",
          responseFields: ["spaces"],
          statusCode: 200,
        },
      ],
    }));
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages }) });
    const file = unwrap(readNotionKindFile({ kind: "method", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "web-client")!.role).toBe("discovery");
  });

  it("does not blank the api channel a sync already published", () => {
    const synced = unwrap(syncNotionApiSurface({ at: AT, paths }));
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) });
    const file = unwrap(readNotionKindFile({ kind: "method", paths }))!;
    // Asserted against the sync's own route count rather than a literal: the literal was 48 and became 75
    // when `@notionhq/client` went 5.23.2 → 5.26.0, so it was measuring the vendor's release cadence. What
    // this test is actually for is that a walk does not blank the api channel, and `> 0` is not enough —
    // every route the sync published must still carry one.
    expect(file.entities.filter((row) => row.channels.api !== null).length).toBe(synced.routeCount);
  });

  it("does not blank the browser channel when a sync runs after a walk", () => {
    const pages = everyPageHeld().map((page) => ({
      ...page,
      calls: [
        {
          method: "POST",
          operation: "getSpaces",
          pathShape: "/api/v3/getSpaces",
          responseFields: ["spaces"],
          statusCode: 200,
        },
      ],
    }));
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages }) });
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "method", paths }))!;
    expect(file.entities.filter((row) => row.channels.browser !== null).length).toBe(1);
  });

  it("leaves the page kind untouched when a sync runs", () => {
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) });
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.entities.length).toBe(NOTION_BROWSER_PAGES.length);
  });

  it("publishes a LATER sync over an earlier walk, leaving the page file on the walk's own clock", () => {
    // Every other case here syncs at the walk's instant, which is why this never fired in a test: on the
    // installed generation the sync ran ten days after the walk, and every sync was refused with "page
    // carries two clocks" because the page file was restamped while its status kept the walk's success time.
    const LATER = "2026-09-16T12:00:00.000Z";
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) });
    unwrap(syncNotionApiSurface({ at: LATER, paths }));
    const page = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    const manifest = unwrap(readNotionManifest({ paths }))!;
    expect(page.updatedAt).toBe(AT);
    expect(manifest.kinds.page.lastSuccessAt).toBe(AT);
    expect(manifest.kinds.method.lastSuccessAt).toBe(LATER);
    expect(manifest.updatedAt).toBe(LATER);
  });
});

// Each of these is a Codex counterexample, kept as a test so the class cannot come back silently. The guards
// are the kit's now (`kit/walkPublish.test.ts` owns their unit cases); these keep them anchored to THIS
// atlas's declared inventory, which is the denominator the counterexample was about.
const DECLARED_SURFACES = NOTION_BROWSER_PAGES.map((page) => page.surface);

describe("refuseUndeclaredWalk", () => {
  it("REFUSES an empty walk, which would otherwise report nought of nought as full coverage", () => {
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED_SURFACES, pages: [] });
    expect(unwrapErr(refused)).toEqual([
      `this walk does not cover the declared page list: ${String(DECLARED_SURFACES.length)} declared page(s) absent, 0 row(s) for a page that is not declared, 0 duplicated row(s)`,
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    ]);
  });

  it("refuses a walk that is short of the declared list", () => {
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED_SURFACES, pages: [observation()] });
    expect(unwrapErr(refused)).toEqual([
      `this walk does not cover the declared page list: ${String(DECLARED_SURFACES.length - 1)} declared page(s) absent, 0 row(s) for a page that is not declared, 0 duplicated row(s)`,
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    ]);
  });

  it("refuses a walk carrying a row for a page that is not declared", () => {
    const pages = [...everyPageHeld(), observation({ surface: "a-page-nobody-declared" })];
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED_SURFACES, pages });
    expect(unwrapErr(refused)).toEqual([
      "this walk does not cover the declared page list: 0 declared page(s) absent, 1 row(s) for a page that is not declared, 0 duplicated row(s)",
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    ]);
  });

  it("refuses a walk carrying the same declared page twice", () => {
    const pages = [...everyPageHeld(), observation({ surface: NOTION_BROWSER_PAGES[0]!.surface })];
    const refused = refuseUndeclaredWalk({ declaredSurfaces: DECLARED_SURFACES, pages });
    expect(unwrapErr(refused)).toEqual([
      "this walk does not cover the declared page list: 0 declared page(s) absent, 0 row(s) for a page that is not declared, 1 duplicated row(s)",
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    ]);
  });

  it("accepts a walk that covers the declared list exactly", () => {
    expect(refuseUndeclaredWalk({ declaredSurfaces: DECLARED_SURFACES, pages: everyPageHeld() }).isOk()).toBe(true);
  });

  it("stops an empty walk being PUBLISHED at all, not merely graded", () => {
    const published = publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: [] }) });
    expect(unwrapErr(published)).toEqual([
      `this walk does not cover the declared page list: ${String(DECLARED_SURFACES.length)} declared page(s) absent, 0 row(s) for a page that is not declared, 0 duplicated row(s)`,
      "nothing was published — a publisher that graded this against its own array would report full coverage over whatever it was handed",
    ]);
  });
});

describe("verifyArtifactsOnDisk", () => {
  it("keeps a page whose screenshot is on disk and still hashes to its digest", () => {
    const checked = verifyArtifactsOnDisk({ directory: paths.directory, pages: [observation()] });
    expect(checked[0]!.screenshotMissingBecause).toBeNull();
  });

  // The Codex counterexample: a reference with no file behind it, which graded as photographed.
  it("REFUSES a fabricated artifact reference with no bytes behind it", () => {
    const fabricated = observation({
      artifacts: [
        {
          byteLength: 3,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: `artifacts/pages/${"b".repeat(64)}.png`,
          sha256: "b".repeat(64),
        },
      ],
    });
    expect(
      verifyArtifactsOnDisk({ directory: paths.directory, pages: [fabricated] })[0]!.screenshotMissingBecause,
    ).toContain("absent");
  });

  it("drops the unproven reference, so it cannot be cited as proof of anything", () => {
    const fabricated = observation({
      artifacts: [
        {
          byteLength: 3,
          kind: "page-png",
          mediaType: "image/png",
          relativePath: `artifacts/pages/${"b".repeat(64)}.png`,
          sha256: "b".repeat(64),
        },
      ],
    });
    expect(verifyArtifactsOnDisk({ directory: paths.directory, pages: [fabricated] })[0]!.artifacts).toEqual([]);
  });

  it("REFUSES a reference whose file no longer hashes to the digest it is addressed by", () => {
    writeFileSync(join(paths.directory, `artifacts/pages/${SHOT_SHA}.png`), new Uint8Array([1, 2, 3, 4, 5]));
    expect(
      verifyArtifactsOnDisk({ directory: paths.directory, pages: [observation()] })[0]!.screenshotMissingBecause,
    ).toContain("no longer hash");
  });

  it("stops a fabricated walk reaching synced coverage at all", () => {
    const pages = everyPageHeld().map((page) => ({ ...page, artifacts: [] }));
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages }) });
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "browser-walk")!.state).toBe("deferred");
  });
});

describe("withNotionPublishLock", () => {
  it("runs the publish and hands back its result when nothing else holds the lock", () => {
    const ran = withNotionPublishLock({ nowIso: AT, paths, publish: () => ok("published") });
    expect(unwrap(ran)).toBe("published");
  });

  // The Codex counterexample the compare-and-swap alone could not stop: two publishers both pass the check,
  // one writes, and the other then replaces it. Only mutual exclusion closes that.
  it("REFUSES a second publisher while the first still holds the lock", () => {
    const outer = withNotionPublishLock({
      nowIso: AT,
      paths,
      publish: () => withNotionPublishLock({ nowIso: AT, paths, publish: () => ok("inner ran") }),
    });
    expect(unwrapErr(outer)).toEqual([
      `another process is publishing the notion atlas: held by pid ${String(process.pid)} since ${AT} (0ms old, ` +
        `under the 900000ms stale threshold, and the holder answered signal 0 — it was ALIVE when checked at ` +
        `${AT}, so this is contention rather than a lock left behind by a dead process)`,
      "nothing was written — run the verb again once it has finished",
    ]);
  });

  it("releases the lock when the publish it wrapped FAILED, so one error does not wedge the atlas", () => {
    withNotionPublishLock({ nowIso: AT, paths, publish: () => err(["the publish failed"]) });
    expect(withNotionPublishLock({ nowIso: AT, paths, publish: () => ok("after") }).isOk()).toBe(true);
  });

  it("releases the lock when the publish it wrapped THREW, which a Result cannot express", () => {
    try {
      withNotionPublishLock({
        nowIso: AT,
        paths,
        publish: () => {
          throw new Error("the disk went away");
        },
      });
    } catch {
      // The throw is the point; what is under test is that the lock did not survive it.
    }
    expect(withNotionPublishLock({ nowIso: AT, paths, publish: () => ok("after") }).isOk()).toBe(true);
  });

  it("says nothing was written, so a refused caller cannot read it as a partial publish", () => {
    const refusals: string[] = [];
    withNotionPublishLock({
      nowIso: AT,
      paths,
      publish: () => {
        const inner = withNotionPublishLock({ nowIso: AT, paths, publish: () => ok("inner") });
        refusals.push(inner.isErr() ? inner.error.join(" ") : "");
        return ok(null);
      },
    });
    expect(refusals[0]).toContain("nothing was written");
  });
});

describe("the compare-and-swap every Notion publish runs", () => {
  /** A candidate that changes nothing, so only the derivation basis decides whether it lands. */
  const candidate = (): Parameters<typeof publishNotionAtlas>[0]["manifest"] =>
    initialNotionManifest({ updatedAt: AT });

  it("allows a publish derived from the generation that is actually on disk", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const held = unwrap(readNotionManifest({ paths }));

    expect(publishNotionAtlas({ derivedFrom: held, files: {}, manifest: candidate(), paths }).isOk()).toBe(true);
  });

  it("REFUSES a publish derived from a generation another writer has since replaced", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const stale = { ...unwrap(readNotionManifest({ paths }))!, updatedAt: "2020-01-01T00:00:00.000Z" };

    const refused = unwrapErr(publishNotionAtlas({ derivedFrom: stale, files: {}, manifest: candidate(), paths }));

    expect(refused.join(" ")).toContain("another writer published a notion generation");
  });

  it("REFUSES a publish that read no generation when one has since been written", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));

    const refused = unwrapErr(publishNotionAtlas({ derivedFrom: null, files: {}, manifest: candidate(), paths }));

    expect(refused.join(" ")).toContain("nothing was written");
  });

  it("allows a publish that read no generation when there still is none", () => {
    expect(publishNotionAtlas({ derivedFrom: null, files: {}, manifest: candidate(), paths }).isOk()).toBe(true);
  });
});

describe("syncNotionApiSurface", () => {
  it("publishes every endpoint the installed client declares", () => {
    const outcome = unwrap(syncNotionApiSurface({ at: AT, paths }));
    // The installed package decides these, so they are asserted as a RELATIONSHIP the projection must hold
    // rather than as literals that go stale on the vendor's schedule (they were 48, and 5.26.0 made them 76
    // declarations over 75 routes — one fold, `agents.updateSession` + `agents.updateSessionStream`, which
    // declare the identical `POST /v1/sessions` and differ only by an `Accept: text/event-stream` header).
    expect(outcome.endpointCount).toBeGreaterThan(0);
    expect(outcome.routeCount).toBeGreaterThan(0);
    expect(outcome.routeCount).toBeLessThanOrEqual(outcome.endpointCount);
    expect(unwrap(readNotionKindFile({ kind: "method", paths }))!.entities.length).toBe(outcome.routeCount);
  });

  it("names the version that declared them, so the surface is version-scoped rather than timeless", () => {
    expect(unwrap(syncNotionApiSurface({ at: AT, paths })).sdkVersion.length).toBeGreaterThan(0);
  });

  it("grades the declared endpoint set synced and authoritative", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "method", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "sdk-declared")!.role).toBe("authoritative");
  });

  it("carries the integration's own ceiling on its cell, never a human's role", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "method", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "sdk-declared")!.visibilityScope).toBe(
      "api-integration-grants",
    );
  });

  it("says who DOES hold Notion's workspace content, rather than only excluding it", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "workspace-content")!.state).toBe("held-elsewhere");
  });

  it("NAMES the holder on that cell, because a state that cannot say where is unfalsifiable", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "workspace-content")!.reason).toContain(
      "src/corpus/notion/reach.ts",
    );
  });

  it("grades that cell discovery, so the atlas can never be cited for a fact the corpus owns", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.find((cell) => cell.surface === "workspace-content")!.role).toBe("discovery");
  });

  it("keeps the walk's own page entities when a later sync writes that cell", () => {
    publishNotionBrowserWalk({ at: AT, paths, walk: walk({ pages: everyPageHeld() }) });
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const file = unwrap(readNotionKindFile({ kind: "page", paths }))!;
    expect(file.coverage.filter((cell) => cell.surface === "browser-walk").length).toBe(1);
  });

  it("writes identical bytes when run twice over the same package", () => {
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    const first = JSON.stringify(unwrap(readNotionKindFile({ kind: "method", paths })));
    unwrap(syncNotionApiSurface({ at: AT, paths }));
    expect(JSON.stringify(unwrap(readNotionKindFile({ kind: "method", paths })))).toBe(first);
  });
});
