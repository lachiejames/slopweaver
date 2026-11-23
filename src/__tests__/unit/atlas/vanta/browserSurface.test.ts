import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AtlasArtifactRef } from "../../../../atlas/kit/contract.js";
import { VANTA_BROWSER_PAGES } from "../../../../atlas/vanta/browserPages.js";
import { publishVantaBrowserWalk } from "../../../../atlas/vanta/browserSurface.js";
import type { VantaBrowserWalkResult, VantaPageObservation } from "../../../../atlas/vanta/browserWalk.js";
import { emptyVantaKindFile, initialVantaManifest, VANTA_KINDS } from "../../../../atlas/vanta/model.js";
import {
  publishVantaAtlas,
  readVantaAtlas,
  type VantaAtlasPaths,
  vantaAtlasPaths,
  vantaPageArtifactPath,
} from "../../../../atlas/vanta/store.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { renderedPng } from "../../../pngFixture.js";
import { cloneHome } from "../homeTemplate.js";

const AT = "2026-09-04T10:00:00.000Z";

/** Every declared surface, in the order the walk returns them. */
const SURFACES = VANTA_BROWSER_PAGES.map((declared) => declared.surface);

const call = ({ operation, fields = ["data.id"] }: { operation: string | null; fields?: readonly string[] }) => ({
  method: "POST",
  operation,
  pathShape: "/c/{tenant}/graphql",
  responseFields: fields,
  statusCode: 200,
});

describe("publishVantaBrowserWalk", () => {
  let home: string;
  let paths: VantaAtlasPaths;

  /**
   * A page whose picture is written to disk at the digest it is addressed by, so the publisher's own
   * read-back verification passes for the reason it is supposed to — the bytes being there.
   */
  const photographed = ({
    surface,
    seed,
    unreachableBecause = null,
    calls = [],
  }: {
    surface: string;
    seed: number;
    unreachableBecause?: string | null;
    calls?: VantaPageObservation["calls"];
  }): VantaPageObservation => {
    const url = `https://app.vanta.com/c/acme/${surface}`;
    const base = {
      attempted: true,
      calls,
      captureComplete: true,
      finalUrl: url,
      observedAt: AT,
      redirected: false,
      requestedUrl: url,
      responseAccounting: { bodyFailed: 0, bodySucceeded: calls.length, eligible: calls.length, seen: 500 },
      statusCode: 200,
      surface,
      title: "Tests - Vanta",
    };
    if (unreachableBecause !== null) {
      return {
        ...base,
        artifacts: [],
        calls,
        screenshotMissingBecause: "the page was never photographed, because the visit did not complete",
        unreachableBecause,
      };
    }
    return { ...base, artifacts: [storeShot({ seed })], screenshotMissingBecause: null, unreachableBecause: null };
  };

  /** Write one distinct picture into the atlas directory and return the reference addressing it. */
  const storeShot = ({ seed }: { seed: number }): AtlasArtifactRef => {
    const bytes = renderedPng({ seed });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const relativePath = vantaPageArtifactPath({ sha256 });
    const absolute = join(paths.directory, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    return { byteLength: bytes.byteLength, kind: "page-png", mediaType: "image/png", relativePath, sha256 };
  };

  /** The whole declared list, every page reached and photographed, with per-page overrides applied. */
  const wholeWalk = ({
    over = {},
  }: {
    over?: Readonly<Record<string, Partial<Parameters<typeof photographed>[0]>>>;
  } = {}): VantaBrowserWalkResult => ({
    pages: SURFACES.map((surface, index) => photographed({ seed: index + 1, surface, ...over[surface] })),
    rootFound: true,
    sessionLost: false,
  });

  // Every case starts from the same empty generation, published once into a template and copied per case
  // (`homeTemplate.ts` says why, and what it measured).
  let template: string;
  beforeAll(() => {
    template = mkdtempSync(join(tmpdir(), "vanta-browser-surface-template-"));
    unwrap(
      publishVantaAtlas({
        derivedFrom: null,
        files: Object.fromEntries(VANTA_KINDS.map((kind) => [kind, emptyVantaKindFile({ kind, updatedAt: AT })])),
        manifest: initialVantaManifest({ updatedAt: AT }),
        paths: vantaAtlasPaths({ home: template }),
      }),
    );
  });
  afterAll(() => {
    rmSync(template, { force: true, recursive: true });
  });
  beforeEach(() => {
    home = cloneHome({ prefix: "vanta-browser-surface-", template });
    paths = vantaAtlasPaths({ home });
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("publishes one entity per declared page and one per distinct operation", () => {
    const outcome = unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({
          over: {
            "audits-collection": { calls: [call({ operation: "userContext" }), call({ operation: "audits" })] },
            "tests-collection": { calls: [call({ operation: "userContext" })] },
          },
        }),
      }),
    );
    expect(outcome.declaredCount).toBe(SURFACES.length);
    expect(outcome.reachedCount).toBe(SURFACES.length);
    expect(outcome.photographedCount).toBe(SURFACES.length);
    expect(outcome.operationCount).toBe(2);
  });

  it("refuses a walk that does not cover the declared list, rather than grading itself against what it was handed", () => {
    const short = publishVantaBrowserWalk({
      at: AT,
      paths,
      walk: { pages: [photographed({ seed: 1, surface: "tests-collection" })], rootFound: true, sessionLost: false },
    });
    expect(short.isErr()).toBe(true);
    expect(unwrapErr(short)[0]).toContain("does not cover the declared page list");
  });

  it("records which pages an operation was seen on, rather than only the last", () => {
    unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({
          over: {
            "audits-collection": { calls: [call({ operation: "userContext" })] },
            "tests-collection": { calls: [call({ operation: "userContext" })] },
          },
        }),
      }),
    );
    const file = unwrap(readVantaAtlas({ paths })).files["browser-operation"]!;
    const detail = file.entities[0]!.channels.browser!.detail;
    expect(JSON.stringify(detail)).toContain('"seenOnSurfaces":["audits-collection","tests-collection"]');
  });

  it("widens an operation's observed fields across pages instead of letting the last page win", () => {
    unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({
          over: {
            "audits-collection": { calls: [call({ fields: ["data.b"], operation: "x" })] },
            "tests-collection": { calls: [call({ fields: ["data.a"], operation: "x" })] },
          },
        }),
      }),
    );
    const file = unwrap(readVantaAtlas({ paths })).files["browser-operation"]!;
    expect(JSON.stringify(file.entities[0]!.channels.browser!.detail)).toContain(
      '"responseFields":["data.a","data.b"]',
    );
  });

  it("credits no operation to a page the client would not render", () => {
    unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({
          over: {
            "audits-collection": {
              calls: [call({ operation: "userContext" })],
              unreachableBecause: "the client has no such route",
            },
          },
        }),
      }),
    );
    const file = unwrap(readVantaAtlas({ paths })).files["browser-operation"]!;
    expect(file.entities).toEqual([]);
  });

  it("grades a partial walk deferred with the fraction, rather than synced because it wrote some rows", () => {
    unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({ over: { "audits-collection": { unreachableBecause: "the client has no such route" } } }),
      }),
    );
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    const cell = file.coverage.find((entry) => entry.surface === "browser-walk")!;
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toBe("11 of 12 declared page(s) reached, 11 of those also photographed");
  });

  it("grades a walk that reached everything and photographed nothing DEFERRED, which is the whole point", () => {
    const pages = SURFACES.map((surface): VantaPageObservation => ({
      artifacts: [],
      attempted: true,
      calls: [],
      captureComplete: true,
      finalUrl: `https://app.vanta.com/c/acme/${surface}`,
      observedAt: AT,
      redirected: false,
      requestedUrl: `https://app.vanta.com/c/acme/${surface}`,
      responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 500 },
      screenshotMissingBecause: "the page was reached but the browser returned no screenshot for it",
      statusCode: 200,
      surface,
      title: "Tests - Vanta",
      unreachableBecause: null,
    }));
    const outcome = unwrap(
      publishVantaBrowserWalk({ at: AT, paths, walk: { pages, rootFound: true, sessionLost: false } }),
    );
    expect(outcome.reachedCount).toBe(12);
    expect(outcome.photographedCount).toBe(0);
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    const cell = file.coverage.find((entry) => entry.surface === "browser-walk")!;
    expect(cell.state).toBe("deferred");
    expect(cell.reason).toBe("12 of 12 declared page(s) reached, 0 of those also photographed");
    // Asserted on the REASON each gap carries, never on the count. The failure this
    // guards, as measured: Chrome renders no frame for a tab that is not its window's active one, so a walk
    // reaches every page and stops photographing part-way through, storing fewer pictures than pages. A count moves for
    // that and for a walk that was never asked to photograph, and only the reason tells them apart.
    expect(file.gaps.map((gap) => gap.reason)).toEqual(
      SURFACES.map(() => "the page was reached but the browser returned no screenshot for it"),
    );
    expect(file.gaps.map((gap) => gap.scope).toSorted()).toEqual([...SURFACES].toSorted());
  });

  it("withdraws a screenshot claim whose bytes are not on disk, rather than trusting the reference", () => {
    const walk = wholeWalk();
    const invented: AtlasArtifactRef = {
      byteLength: 95_000,
      kind: "page-png",
      mediaType: "image/png",
      relativePath: vantaPageArtifactPath({ sha256: "0".repeat(64) }),
      sha256: "0".repeat(64),
    };
    const forged: VantaBrowserWalkResult = {
      ...walk,
      pages: walk.pages.map((page) =>
        page.surface === "tests-collection" ? { ...page, artifacts: [invented] } : page,
      ),
    };
    const outcome = unwrap(publishVantaBrowserWalk({ at: AT, paths, walk: forged }));
    expect(outcome.photographedCount).toBe(11);
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    expect(file.gaps.map((gap) => gap.scope)).toEqual(["tests-collection"]);
    expect(file.gaps[0]!.reason).toContain("no longer hash to the digest they are addressed by");
  });

  it("marks a complete walk synced and carries its pictures onto the cell", () => {
    unwrap(publishVantaBrowserWalk({ at: AT, paths, walk: wholeWalk() }));
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    const cell = file.coverage.find((entry) => entry.surface === "browser-walk")!;
    expect(cell.state).toBe("synced");
    expect(cell.artifacts.length).toBe(12);
  });

  it("carries a page's picture onto its own entity's source, where a reader looking at one page finds it", () => {
    unwrap(publishVantaBrowserWalk({ at: AT, paths, walk: wholeWalk() }));
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    const tests = file.entities.find((entity) => entity.providerId === "tests-collection")!;
    expect(tests.channels.browser!.source!.artifacts.length).toBe(1);
    expect(tests.channels.browser!.source!.deepLinkStatus).toBe("browser-discovered");
  });

  it("opens a gap for a page the walk could not reach", () => {
    unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({ over: { "audits-collection": { unreachableBecause: "the client has no such route" } } }),
      }),
    );
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    expect(file.gaps.map((gap) => gap.scope)).toEqual(["audits-collection"]);
    expect(file.gaps[0]!.status).toBe("open");
  });

  it("CLOSES a gap the previous run opened once the page is held, rather than leaving a healed gap open for ever", () => {
    // A recheck list that does not name every condition the observed list OPENS leaves a healed gap open
    // permanently — measured on a sibling atlas. This walk opens exactly one
    // condition and rechecks exactly that one, and this is the witness that they still match.
    unwrap(
      publishVantaBrowserWalk({
        at: AT,
        paths,
        walk: wholeWalk({ over: { "audits-collection": { unreachableBecause: "the client has no such route" } } }),
      }),
    );
    const opened = unwrap(readVantaAtlas({ paths })).files["browser-page"]!.gaps;
    expect(opened.map((gap) => `${gap.scope}:${gap.status}`)).toEqual(["audits-collection:open"]);

    unwrap(publishVantaBrowserWalk({ at: "2026-09-05T00:00:00.000Z", paths, walk: wholeWalk() }));
    const healed = unwrap(readVantaAtlas({ paths })).files["browser-page"]!.gaps;
    expect(healed.map((gap) => `${gap.scope}:${gap.status}`)).toEqual(["audits-collection:closed"]);
  });

  it("carries the browser channel's own visibility scope, never the API's", () => {
    unwrap(publishVantaBrowserWalk({ at: AT, paths, walk: wholeWalk() }));
    const file = unwrap(readVantaAtlas({ paths })).files["browser-page"]!;
    expect(file.coverage[0]!.visibilityScope).toBe("browser-signed-in-role");
  });

  it("leaves every Manage API kind's file untouched, so a walk cannot truncate a sync", () => {
    const before = unwrap(readVantaAtlas({ paths })).files.control!;
    unwrap(publishVantaBrowserWalk({ at: "2026-09-05T00:00:00.000Z", paths, walk: wholeWalk() }));
    expect(unwrap(readVantaAtlas({ paths })).files.control!.updatedAt).toBe(before.updatedAt);
  });
});
