/**
 * The rendered page — that it is self-contained, that a defect is visible without expanding anything, and
 * that provider-authored text cannot escape into markup.
 *
 * The renderer is pure over a model, so every fixture here is a model built by hand. What the model itself
 * decides is `pageModel.test.ts`'s subject, not this one's.
 */
import { describe, expect, it } from "vitest";

import { renderAtlasPageBody, renderAtlasPageDocument, renderAtlasPageParts } from "../../../../atlas/kit/pageHtml.js";
import type { AtlasPageDefect, AtlasPageModel } from "../../../../atlas/kit/pageModel.js";

/** One defect row, defaulted. */
function defect(over: Partial<AtlasPageDefect> = {}): AtlasPageDefect {
  return { count: 0, detail: "", id: "open-gaps", label: "open gaps", unknown: false, ...over };
}

/** One model, with everything defaulted so a test names only what it is about. */
function model(over: Partial<AtlasPageModel> = {}): AtlasPageModel {
  const base: AtlasPageModel = {
    closedGapCount: 0,
    defects: [defect()],
    detailTables: [],
    entityCount: 0,
    exclusions: [],
    freshnessWindow: null,
    generationDisagreements: [],
    generationUpdatedAt: "2026-09-01T00:00:00.000Z",
    kinds: [],
    liveReadCommand: null,
    openGapCount: 0,
    openGaps: [],
    platform: "example",
    question: "what does example hold",
    reachability: {
      corroboratedCount: 0,
      denominator: "declared",
      kinds: [],
      neverHit: [],
      neverHitCount: 0,
      undeclaredFindCount: 0,
      undeterminedKinds: [],
      unknownBecause: null,
    },
    resyncCommand: "slopweaver atlas example sync",
    schemaVersion: 3,
    screenshots: [],
    surfaces: [],
    visibilityScope: "whatever this token opens",
    writePolicy: "refuse-every-write",
  };
  return { ...base, ...over };
}

/** Render one model with no embeds, which is the shape most of these assertions want. */
function render({ over }: { over: Partial<AtlasPageModel> }): string {
  return renderAtlasPageBody({ embedded: [], model: model(over), renderedAt: "2026-09-09T00:00:00.000Z" });
}

describe("renderAtlasPageBody", () => {
  it("runs no script and loads nothing but the one font host an artifact may reach", () => {
    const html = render({ over: {} });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("https://cdn");
    const hosts = [...html.matchAll(/href="(https:\/\/[^/"]+)/g)].map((match) => match[1]);
    expect([...new Set(hosts)].toSorted((left, right) => left!.localeCompare(right!))).toEqual([
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]);
  });

  it("names the verb that made it, so a reader can regenerate the page they are looking at", () => {
    expect(render({ over: {} })).toContain("<code>slopweaver atlas example render</code>");
  });

  it("names the page after the platform, as a title reads it", () => {
    expect(render({ over: { platform: "google-admin" } })).toContain("<title>Google Admin Atlas</title>");
  });

  it("escapes provider-authored text rather than letting it close a tag", () => {
    const html = render({ over: { question: '</style><script>alert("x")</script>' } });
    expect(html).toContain("&lt;/style&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("x")</script>');
  });

  it("escapes a deep link before putting it in an href", () => {
    const html = render({
      over: {
        reachability: {
          corroboratedCount: 0,
          denominator: "declared",
          kinds: [],
          undeterminedKinds: [],
          neverHit: [
            {
              deepLink: 'https://example.test/"onmouseover="alert(1)',
              endpoint: "GET /x",
              kind: "widget",
              providerId: "x",
              surface: "spec-declared",
            },
          ],
          neverHitCount: 1,
          undeclaredFindCount: 0,
          unknownBecause: null,
        },
      },
    });
    expect(html).toContain('href="https://example.test/&quot;onmouseover=&quot;alert(1)"');
    expect(html).not.toContain('"onmouseover="alert(1)"');
  });

  it("prints an unmeasurable defect row as a question rather than a green zero", () => {
    const html = render({
      over: {
        defects: [
          defect({ count: 0, id: "never-hit", label: "endpoints that exist and were never hit", unknown: true }),
        ],
      },
    });
    expect(html).toContain('<div class="chip unknown"><span class="chip-count">?</span>');
    expect(html).not.toContain('<div class="chip ok"><span class="chip-count">0</span>');
  });

  it("says UNKNOWN, not none, when the atlas declares no denominator", () => {
    const html = render({
      over: {
        reachability: {
          corroboratedCount: 0,
          denominator: "absent",
          kinds: [],
          undeterminedKinds: [],
          neverHit: [],
          neverHitCount: 0,
          undeclaredFindCount: 7,
          unknownBecause: "no surface of this atlas is compiled from example's own specification",
        },
      },
    });
    expect(html).toContain("UNKNOWN — and that is not the same as none.");
    expect(html).toContain("no surface of this atlas is compiled from example&#39;s own specification");
  });

  // The first cut rendered `partial`
  // down the numeric path, so an atlas measurable on one kind and no other printed "0 declared and never
  // reached" — a zero reading as coverage over kinds nothing had ever declared.
  it("never prints a bare count for a partial atlas, zero least of all", () => {
    const html = render({
      over: {
        reachability: {
          corroboratedCount: 1,
          denominator: "partial",
          kinds: [],
          neverHit: [],
          neverHitCount: 0,
          undeclaredFindCount: 1,
          undeterminedKinds: ["console-page"],
          unknownBecause: "only some of this atlas is measurable",
        },
      },
    });
    expect(html).toContain("PARTLY UNKNOWN");
    expect(html).toContain("Nothing declares what exists for console-page");
    expect(html).toContain("That figure covers those kinds and no others — including when it is zero.");
    expect(html).not.toContain("0 declared and never reached · 1 declared and reached");
  });

  it("opens the never-hit disclosure when there is something behind it, and leaves it shut when there is not", () => {
    const withRows = render({
      over: {
        reachability: {
          corroboratedCount: 0,
          denominator: "declared",
          kinds: [],
          undeterminedKinds: [],
          neverHit: [{ deepLink: null, endpoint: "GET /x", kind: "widget", providerId: "x", surface: "spec" }],
          neverHitCount: 1,
          undeclaredFindCount: 0,
          unknownBecause: null,
        },
      },
    });
    expect(withRows).toContain("<details open>");
    expect(render({ over: {} })).not.toContain("<details open>");
  });

  it("states how many screenshots it embedded against how many the atlas holds", () => {
    const shot = {
      byteLength: 10,
      deepLink: null,
      mediaType: "image/png",
      providerId: "policies-collection",
      relativePath: "artifacts/pages/aa.png",
      sha256: "a".repeat(64),
      surface: "browser",
    };
    const html = renderAtlasPageBody({
      embedded: [],
      model: model({ screenshots: [shot, { ...shot, sha256: "b".repeat(64) }] }),
      renderedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(html).toContain("0 of 2 screenshot(s) embedded in this page");
    expect(html).toContain("held on disk — it did not fit this page&#39;s screenshot budget");
  });

  it("embeds a screenshot as a picture once its bytes arrive", () => {
    const html = renderAtlasPageBody({
      embedded: [{ dataUri: "data:image/png;base64,AAAA", sha256: "a".repeat(64), status: "embedded" }],
      model: model({
        screenshots: [
          {
            byteLength: 10,
            deepLink: null,
            mediaType: "image/png",
            providerId: "policies-collection",
            relativePath: "artifacts/pages/aa.png",
            sha256: "a".repeat(64),
            surface: "browser",
          },
        ],
      }),
      renderedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    expect(html).toContain("1 of 1 screenshot(s) embedded in this page");
  });

  it("says a screenshot is GONE OR CHANGED rather than held when its digest did not match", () => {
    const html = renderAtlasPageBody({
      embedded: [{ dataUri: null, sha256: "a".repeat(64), status: "integrity-failed" }],
      model: model({
        screenshots: [
          {
            byteLength: 10,
            deepLink: null,
            mediaType: "image/png",
            providerId: "policies-collection",
            relativePath: "artifacts/pages/aa.png",
            sha256: "a".repeat(64),
            surface: "browser",
          },
        ],
      }),
      renderedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(html).toContain("GONE OR CHANGED — the bytes on disk are not the ones this atlas recorded");
    expect(html).toContain("1 of them could not be verified against the digest this atlas recorded");
    expect(html).toContain("Screenshots held (1, 1 unverifiable)");
  });

  it("prints a link only for a web URL, and the raw text for anything else", () => {
    const linked = render({
      over: {
        reachability: {
          corroboratedCount: 0,
          denominator: "declared",
          kinds: [],
          neverHit: [
            { deepLink: "javascript:alert(1)", endpoint: "GET /x", kind: "widget", providerId: "x", surface: "spec" },
            {
              deepLink: "https://example.test/x",
              endpoint: "GET /y",
              kind: "widget",
              providerId: "y",
              surface: "spec",
            },
          ],
          neverHitCount: 2,
          undeclaredFindCount: 0,
          undeterminedKinds: [],
          unknownBecause: null,
        },
      },
    });
    expect(linked).not.toContain('href="javascript:alert(1)"');
    expect(linked).toContain("<code>javascript:alert(1)</code>");
    expect(linked).toContain('href="https://example.test/x" rel="noreferrer"');
  });

  it("prints a generation disagreement as its own panel rather than only as a count", () => {
    const html = render({ over: { generationDisagreements: ["audit: a file the manifest does not vouch for"] } });
    expect(html).toContain("This generation disagrees with its own manifest");
    expect(html).toContain("audit: a file the manifest does not vouch for");
  });
});

describe("renderAtlasPageDocument", () => {
  it("puts the title and stylesheet in the head and the content in the body", () => {
    const document = renderAtlasPageDocument({
      embedded: [],
      model: model(),
      renderedAt: "2026-09-09T00:00:00.000Z",
    });
    expect(document.startsWith("<!doctype html>")).toBe(true);
    expect(document).toContain(
      '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Example Atlas</title>',
    );
    expect(document).toContain("</style></head><body><main>");
    expect(document.endsWith("</main></body></html>")).toBe(true);
  });

  it("is built from the same bytes as the artifact form, so the two cannot drift", () => {
    const parts = renderAtlasPageParts({ embedded: [], model: model(), renderedAt: "2026-09-09T00:00:00.000Z" });
    const body = renderAtlasPageBody({ embedded: [], model: model(), renderedAt: "2026-09-09T00:00:00.000Z" });
    expect(body).toBe(`${parts.head}${parts.body}`);
  });
});
