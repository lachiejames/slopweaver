import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { readGithubObjectWithMedia } from "../../../../live/github/bodyMedia.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubRenderedMediaCandidate } from "../../../../live/github/media.js";
import { type GithubReadGraphql, readGithubObject } from "../../../../live/github/read.js";
import {
  type ProviderReadMedia,
  renderProviderReadJson,
  renderProviderReadText,
} from "../../../../live/providerRead.js";

const NOW = "2026-09-27T12:00:00.000Z";
const NODE = { number: 7, title: "Current title" };
const SIGNED = "https://private-user-images.githubusercontent.com/1/a.mp4?jwt=SECRET-WITNESS";
const WRITTEN: ProviderReadMedia = {
  bytes: 3,
  kind: "video",
  name: "github-media-01.mp4",
  path: "/out/github-media-01.mp4",
  sha256: "a".repeat(64),
};

/** A GraphQL seam answering the ordinary read with NODE and the rendered-body read with `bodyHtml`. */
function graphqlAnswering({ queries, bodyHtml }: { queries: string[]; bodyHtml: unknown }): GithubReadGraphql {
  return ({ query, variables }) => {
    queries.push(`${query.includes("bodyHTML") ? "body" : "object"} ${JSON.stringify(variables)}`);
    if (query.includes("bodyHTML")) {
      return Promise.resolve(ok({ repository: { issueOrPullRequest: { bodyHTML: bodyHtml } } }));
    }
    return Promise.resolve(ok({ repository: { issueOrPullRequest: NODE } }));
  };
}

describe("readGithubObjectWithMedia", () => {
  it("makes one query and carries no media when none is asked for", async () => {
    const queries: string[] = [];

    const document = unwrap(
      await readGithubObject({
        address: "https://github.com/o/r/pull/7",
        graphql: graphqlAnswering({ bodyHtml: "", queries }),
        limit: 25,
        nowIso: () => NOW,
      }),
    );

    expect(queries).toEqual([`object {"limit":25,"number":7,"owner":"o","repo":"r"}`]);
    expect(Object.keys(document).toSorted()).toEqual(["coverage", "data", "readAtIso", "source", "target"]);
  });

  it("reads the rendered body in a second query and hands the downloader its candidates", async () => {
    const queries: string[] = [];
    const handed: (readonly GithubRenderedMediaCandidate[])[] = [];

    const document = unwrap(
      await readGithubObjectWithMedia({
        address: "https://github.com/o/r/pull/7",
        graphql: graphqlAnswering({ bodyHtml: `<video src="${SIGNED}"></video>`, queries }),
        limit: 25,
        download: ({ candidates }) => {
          handed.push(candidates);
          return Promise.resolve(ok([WRITTEN]));
        },
        nowIso: () => NOW,
      }),
    );

    expect(queries).toEqual([
      `object {"limit":25,"number":7,"owner":"o","repo":"r"}`,
      `body {"number":7,"owner":"o","repo":"r"}`,
    ]);
    expect(handed).toEqual([[{ index: 1, kind: "video", url: SIGNED }]]);
    expect(document.data).toEqual(NODE);
    expect(document.media).toEqual([WRITTEN]);
    expect(renderProviderReadJson({ document })).not.toContain("SECRET-WITNESS");
  });

  it("answers an empty body with an empty media list", async () => {
    const handed: (readonly GithubRenderedMediaCandidate[])[] = [];
    const document = unwrap(
      await readGithubObjectWithMedia({
        address: "https://github.com/o/r/issues/7",
        graphql: graphqlAnswering({ bodyHtml: "", queries: [] }),
        limit: 25,
        download: ({ candidates }) => {
          handed.push(candidates);
          return Promise.resolve(ok([]));
        },
        nowIso: () => NOW,
      }),
    );

    expect(handed).toEqual([[]]);
    expect(document.media).toEqual([]);
  });

  it("names a rendered body that is not a string as unreadable", async () => {
    const failure = unwrapErr(
      await readGithubObjectWithMedia({
        address: "https://github.com/o/r/pull/7",
        graphql: graphqlAnswering({ bodyHtml: null, queries: [] }),
        limit: 25,
        download: () => Promise.resolve(ok([])),
        nowIso: () => NOW,
      }),
    );

    expect(failure).toEqual(GithubLiveErrors.mediaUnreadable({ reason: "GitHub returned no rendered body for o/r#7" }));
  });

  it("refuses media on a discussion before any provider call", async () => {
    const queries: string[] = [];

    const failure = unwrapErr(
      await readGithubObjectWithMedia({
        address: "https://github.com/o/r/discussions/7",
        graphql: graphqlAnswering({ bodyHtml: "", queries }),
        limit: 25,
        download: () => Promise.resolve(ok([])),
        nowIso: () => NOW,
      }),
    );

    expect(queries).toEqual([]);
    expect(failure).toEqual(GithubLiveErrors.mediaUnsupported({ kind: "discussion" }));
  });

  it("carries the downloader's failure through unchanged", async () => {
    const stop = GithubLiveErrors.mediaDownloadFailed({ reason: "the host answered HTTP 403", url: SIGNED });

    const failure = unwrapErr(
      await readGithubObjectWithMedia({
        address: "https://github.com/o/r/pull/7",
        graphql: graphqlAnswering({ bodyHtml: `<img src="${SIGNED}">`, queries: [] }),
        limit: 25,
        download: () => Promise.resolve(err(stop)),
        nowIso: () => NOW,
      }),
    );

    expect(failure).toEqual(stop);
    expect(JSON.stringify(failure)).not.toContain("SECRET-WITNESS");
  });
});

describe("renderProviderReadText media", () => {
  const base = {
    coverage: { detail: "one object", kind: "bounded" as const, residue: [] },
    data: {},
    readAtIso: NOW,
    source: "github" as const,
    target: { address: "a", identity: "o/r#7", kind: "pull-request" },
  };

  it("prints nothing about media that was not asked for", () => {
    expect(renderProviderReadText({ document: base })).not.toContain("media:");
  });

  it("says an empty list means the body embeds none", () => {
    expect(renderProviderReadText({ document: { ...base, media: [] } })).toContain("media: none embedded in this body");
  });

  it("lists each written file's path, kind, size and sha256", () => {
    expect(renderProviderReadText({ document: { ...base, media: [WRITTEN] } })).toContain(
      `media: 1\n  /out/github-media-01.mp4 — video, 3 bytes, sha256 ${"a".repeat(64)}`,
    );
  });
});
