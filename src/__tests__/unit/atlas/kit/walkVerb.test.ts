/**
 * {@link storeWalkScreenshots} — the read-after-screenshot grade on the route that does NOT drive the
 * browser itself.
 *
 * This is where a visible session hands back a PNG it took and never looked at. There is no transport here
 * to take the picture again, so the only two outcomes are storing a real photograph or naming the page that
 * has none — and storing the spinner is the one the owner's ruling is about.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readGraphqlHiveSnapshot } from "../../../../atlas/graphqlHive/readAdapter.js";
import type { AtlasEntityView, AtlasReadSnapshot } from "../../../../atlas/kit/read.js";
import type { AtlasWalkedPage } from "../../../../atlas/kit/walkSurface.js";
import {
  type AtlasWalkVerbSpec,
  declaredPagesFrom,
  runAtlasWalkVerb,
  storeWalkScreenshots,
} from "../../../../atlas/kit/walkVerb.js";
import { EXIT_OK } from "../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { renderedPng, unrenderedPng } from "../../../pngFixture.js";

const scratch: string[] = [];

/** A throwaway directory, removed after the test that made it. */
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-walk-verb-"));
  scratch.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** One walked page naming a PNG this test just wrote. */
function page({ providerId, bytes, dir }: { providerId: string; bytes: Uint8Array; dir: string }): AtlasWalkedPage {
  const path = join(dir, `${providerId}.png`);
  writeFileSync(path, bytes);
  return {
    finalUrl: `https://console.example.invalid/${providerId}`,
    providerId,
    reached: true,
    requestedUrl: `https://console.example.invalid/${providerId}`,
    screenshotPath: path,
    statusCode: 200,
    title: providerId,
    unreachableBecause: null,
  };
}

describe("storeWalkScreenshots", () => {
  it("stores a page that actually rendered, addressed by its own digest", () => {
    const dir = scratchDir();
    const pages = [page({ bytes: renderedPng({ seed: 3 }), dir, providerId: "members" })];
    const result = unwrap(
      storeWalkScreenshots({ artifactPath: ({ sha256 }) => `artifacts/${sha256}.png`, directory: dir, pages }),
    );
    expect(result.stored.length).toBe(1);
    expect(result.stored[0]!.providerId).toBe("members");
    expect(result.unrendered).toEqual([]);
  });

  it("refuses to publish a spinner as a photograph, and names the page instead", () => {
    const dir = scratchDir();
    const pages = [page({ bytes: unrenderedPng(), dir, providerId: "members" })];
    const result = unwrap(
      storeWalkScreenshots({ artifactPath: ({ sha256 }) => `artifacts/${sha256}.png`, directory: dir, pages }),
    );
    expect(result.stored).toEqual([]);
    expect(result.unrendered).toEqual(["members"]);
  });

  it("keeps the pages that rendered when one of them did not", () => {
    const dir = scratchDir();
    const pages = [
      page({ bytes: renderedPng({ seed: 4 }), dir, providerId: "members" }),
      page({ bytes: unrenderedPng(), dir, providerId: "billing" }),
    ];
    const result = unwrap(
      storeWalkScreenshots({ artifactPath: ({ sha256 }) => `artifacts/${sha256}.png`, directory: dir, pages }),
    );
    expect(result.stored.map((ref) => ref.providerId)).toEqual(["members"]);
    expect(result.unrendered).toEqual(["billing"]);
  });

  it("passes over a page that names no screenshot at all, without calling it unrendered", () => {
    const dir = scratchDir();
    const declared = { ...page({ bytes: renderedPng(), dir, providerId: "members" }), screenshotPath: null };
    const result = unwrap(
      storeWalkScreenshots({
        artifactPath: ({ sha256 }) => `artifacts/${sha256}.png`,
        directory: dir,
        pages: [declared],
      }),
    );
    expect(result.stored).toEqual([]);
    expect(result.unrendered).toEqual([]);
  });
});

/** What a fresh home reads back for a real walked atlas: every kind its registry declares, nothing in any. */
function freshSnapshot(): AtlasReadSnapshot {
  return unwrap(readGraphqlHiveSnapshot({ home: scratchDir() }));
}

/** One declared `page` entity, with or without the address a walk step opens. */
function declaredPage({ providerId, deepLink }: { providerId: string; deepLink: string | null }): AtlasEntityView {
  return {
    detail: { purpose: `the ${providerId} page` },
    id: `page-${providerId}`,
    kind: "page",
    observations: [
      {
        artifacts: [],
        deepLink,
        deepLinkStatus: "declared",
        endpoint: "declared-routes",
        observedAt: "2026-09-27T00:00:00.000Z",
        state: "observed",
        surface: "api",
      },
    ],
    providerId,
    scope: "graphql-hive",
  };
}

describe("declaredPagesFrom", () => {
  it("reads a fresh home's empty page kind as nothing declared yet, never as a refusal", () => {
    expect(unwrap(declaredPagesFrom({ fallbackPurpose: "a page", snapshot: freshSnapshot() }))).toStrictEqual([]);
  });

  it("briefs a declared page carrying an address and skips one with none", () => {
    const fresh = freshSnapshot();
    const snapshot: AtlasReadSnapshot = {
      ...fresh,
      kinds: fresh.kinds.map((view) =>
        view.kind === "page"
          ? {
              ...view,
              entities: [
                declaredPage({ deepLink: "https://console.example.invalid/members", providerId: "members" }),
                declaredPage({ deepLink: null, providerId: "billing" }),
              ],
            }
          : view,
      ),
    };
    expect(unwrap(declaredPagesFrom({ fallbackPurpose: "a page", snapshot }))).toStrictEqual([
      { providerId: "members", purpose: "the members page", url: "https://console.example.invalid/members" },
    ]);
  });

  it("refuses a snapshot whose registry no longer declares a page kind, naming the kinds it does", () => {
    const fresh = freshSnapshot();
    const snapshot: AtlasReadSnapshot = { ...fresh, kinds: fresh.kinds.filter((view) => view.kind !== "page") };
    const refusal = unwrapErr(declaredPagesFrom({ fallbackPurpose: "a page", snapshot }));
    expect(refusal.code).toBe("ATLAS_KIND_UNKNOWN");
    expect(refusal.message).toBe(
      "graphql-hive has no kind page — it declares: operation, type, organization, project, target",
    );
  });
});

/**
 * A walk spec whose every edge is a plain function: one declared page, so the brief half really runs.
 * Nothing past the brief is reached, so the publish edges refuse rather than pretend.
 */
const BRIEF_ONLY_SPEC: AtlasWalkVerbSpec<unknown> = {
  artifactPath: ({ sha256 }) => `artifacts/${sha256}.png`,
  atlasDirectory: ({ home }) => join(home, "atlas"),
  buildBrief: ({ pages, finish }) => ({
    finish,
    lane: "fixture-console-walk",
    steps: pages.map((declared) => ({ tool: "slopweaver browser shot", what: `photograph ${declared.url}` })),
    url: pages[0]!.url,
  }),
  declaredPages: () =>
    ok([{ providerId: "members", purpose: "the members page", url: "https://console.example.invalid/members" }]),
  documentPages: () => [],
  finishCommand: ({ home }) => `slopweaver atlas fixture walk --observation <path> --home ${home}`,
  noPagesMessage: "no page declared",
  parseDocument: () => err(["the brief half never parses a document"]),
  publish: () => err(["the brief half never publishes"]),
  summaryLine: () => "unused",
  usage: "usage: slopweaver atlas fixture walk [--observation <path>] [--json] [--home <dir>]",
  verbIndex: 4,
};

describe("runAtlasWalkVerb's brief half", () => {
  // The retired Claude-in-Chrome door read `ledgers/browser-grants.jsonl` on a path nothing reaches any
  // more, so a walk appending to it was writing a log no reader opens.
  it("prints the brief and leaves no browser grant journal behind", () => {
    const home = scratchDir();
    const code = runAtlasWalkVerb({
      argv: ["node", "slopweaver", "atlas", "fixture", "walk", "--json", "--home", home],
      spec: BRIEF_ONLY_SPEC,
    });
    expect(code).toBe(EXIT_OK);
    expect(existsSync(join(stateHomePaths({ home }).ledgers, "browser-grants.jsonl"))).toBe(false);
  });
});
