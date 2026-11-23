import { describe, expect, it } from "vitest";

import { type PageVersion, pageVersionOf } from "../../lib/pageVersion";
import {
  frameReportFrom,
  frameVersionReportOf,
  newerVersionWaiting,
  PAGE_VERSION_ASK,
  PAGE_VERSION_REPORT,
  pageVersionReplyOf,
} from "../../lib/pageVersionReply";
import { pageStoreFake } from "../pageStoreFake";

/** The version of `alpha` in a store holding `files` as its files. */
async function versionOf({
  files,
  unreadable = false,
}: {
  files: Readonly<Record<string, string>>;
  unreadable?: boolean;
}): Promise<PageVersion> {
  const { presentation } = pageStoreFake({ pages: { alpha: files }, unreadable });
  return pageVersionOf({ read: await presentation({ fresh: true, slug: "alpha" }) });
}

/** The digest a version carries, throwing (and so failing the test) when there is none. */
function digest({ version }: { version: PageVersion }): string {
  if (version.kind !== "version") {
    throw new Error(`expected a version, got ${version.kind}`);
  }
  return version.version;
}

describe("pageVersionOf", () => {
  it("names the same version for the same files, whatever order the store lists them in", async () => {
    const one = digest({ version: await versionOf({ files: { "index.html": "<p>a</p>", "shot.png": "png" } }) });
    const two = digest({ version: await versionOf({ files: { "shot.png": "png", "index.html": "<p>a</p>" } }) });
    expect(one).toMatch(/^[0-9a-f]{64}$/u);
    expect(two).toBe(one);
  });

  it("names a new version when the document changes", async () => {
    const before = digest({ version: await versionOf({ files: { "index.html": "<p>a</p>" } }) });
    const after = digest({ version: await versionOf({ files: { "index.html": "<p>b</p>" } }) });
    expect(after).not.toBe(before);
  });

  it("names a new version when only a file beside the document changes, or one is added", async () => {
    const before = digest({ version: await versionOf({ files: { "index.html": "<p>a</p>", "shot.png": "one" } }) });
    const changed = digest({ version: await versionOf({ files: { "index.html": "<p>a</p>", "shot.png": "two" } }) });
    const added = digest({
      version: await versionOf({ files: { "index.html": "<p>a</p>", "more.png": "x", "shot.png": "one" } }),
    });
    expect(changed).not.toBe(before);
    expect(added).not.toBe(before);
  });

  it("names a new version when a file moves to another path with the same bytes", async () => {
    const before = digest({ version: await versionOf({ files: { "a.png": "same", "index.html": "<p>a</p>" } }) });
    const moved = digest({ version: await versionOf({ files: { "b.png": "same", "index.html": "<p>a</p>" } }) });
    expect(moved).not.toBe(before);
  });

  it("says a page that is not there is not found", () => {
    expect(pageVersionOf({ read: { kind: "not-found" } })).toEqual({ kind: "not-found" });
  });

  it("carries why when the store could not say", async () => {
    expect(await versionOf({ files: { "index.html": "x" }, unreadable: true })).toEqual({
      kind: "unknown",
      why: "the published-page store did not connect: connect ECONNREFUSED",
    });
  });
});

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("pageVersionReplyOf", () => {
  it("reads a version body", () => {
    expect(pageVersionReplyOf({ value: { kind: "version", version: A } })).toEqual({ kind: "version", version: A });
  });

  it.each([
    ["a page that is gone", { kind: "not-found" }],
    ["a store that could not say", { kind: "unknown", why: "stopped" }],
    ["a short digest", { kind: "version", version: "abc" }],
    ["an upper-case digest", { kind: "version", version: A.toUpperCase() }],
    ["a digest that is not a string", { kind: "version", version: 7 }],
    ["a version with an extra member", { kind: "version", version: A, why: "x" }],
    ["a version with no digest", { kind: "version" }],
    ["an array", [{ kind: "version", version: A }]],
    ["null", null],
    ["a string", "version"],
  ])("reads %s as none", (_what, value) => {
    expect(pageVersionReplyOf({ value })).toEqual({ kind: "none" });
  });
});

describe("frameVersionReportOf", () => {
  it("reads the frame's report for this page as the version it shows", () => {
    const value = { kind: PAGE_VERSION_REPORT, slug: "alpha", version: A };
    expect(frameVersionReportOf({ slug: "alpha", value })).toEqual({ kind: "version", version: A });
  });

  it.each([
    ["a report for another page the frame went on to", { kind: PAGE_VERSION_REPORT, slug: "beta", version: A }],
    ["another kind", { kind: "version", slug: "alpha", version: A }],
    ["the viewer's own ask", { kind: PAGE_VERSION_ASK }],
    ["a malformed digest", { kind: PAGE_VERSION_REPORT, slug: "alpha", version: "abc" }],
    ["an extra member", { extra: 1, kind: PAGE_VERSION_REPORT, slug: "alpha", version: A }],
    ["no slug", { kind: PAGE_VERSION_REPORT, version: A, why: "x" }],
    ["null", null],
  ])("reads %s as none", (_what, value) => {
    expect(frameVersionReportOf({ slug: "alpha", value })).toEqual({ kind: "none" });
  });
});

describe("frameReportFrom", () => {
  const frameWindow = { frame: "viewer" };
  const report = { kind: PAGE_VERSION_REPORT, slug: "alpha", version: A };

  it("takes a well-formed report from the viewer's own frame window", () => {
    expect(frameReportFrom({ frameWindow, slug: "alpha", source: frameWindow, value: report })).toEqual({
      kind: "version",
      version: A,
    });
  });

  it.each([
    ["a forged report from another window", { frame: "other" }, frameWindow],
    ["a report with no source", null, frameWindow],
    ["a report while the frame has no window yet", null, null],
  ])("refuses %s", (_what, source, frame) => {
    expect(frameReportFrom({ frameWindow: frame, slug: "alpha", source, value: report })).toEqual({ kind: "none" });
  });

  it("refuses a malformed body even from the viewer's own frame window", () => {
    const value = { ...report, version: "abc" };
    expect(frameReportFrom({ frameWindow, slug: "alpha", source: frameWindow, value })).toEqual({ kind: "none" });
  });
});

describe("newerVersionWaiting", () => {
  it("offers a version other than the one shown", () => {
    expect(newerVersionWaiting({ latest: { kind: "version", version: B }, shown: A })).toBe(true);
  });

  it("offers nothing for the version shown", () => {
    expect(newerVersionWaiting({ latest: { kind: "version", version: A }, shown: A })).toBe(false);
  });

  it("offers nothing when the store gave no version", () => {
    expect(newerVersionWaiting({ latest: { kind: "none" }, shown: A })).toBe(false);
  });

  it("offers nothing when the viewer never learned which version it loaded", () => {
    expect(newerVersionWaiting({ latest: { kind: "version", version: B }, shown: undefined })).toBe(false);
  });
});
