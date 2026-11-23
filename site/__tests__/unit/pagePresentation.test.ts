/*
 * Decoding `page read --presentation --json`: a page's files keyed by path, a page that is not there, and every way the
 * verb could fail to say — a timeout, a non-JSON line, a document about another slug, an address that is not http —
 * read as a store that could not say, never as a page that is not there.
 */

import { describe, expect, it } from "vitest";

import { pagePresentationArgv, presentationOf } from "../../lib/pagePresentation";
import type { SpawnOutcome } from "../../lib/spawnVerb";

const SHA = "a".repeat(64);
const URL_SIGNED = "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/a?token=t";

/** A run of the verb that exited `exitCode` having printed `document`. */
function ran({ document, exitCode = 0 }: { document: unknown; exitCode?: number }): SpawnOutcome {
  const out = typeof document === "string" ? document : JSON.stringify(document);
  if (exitCode === 0) {
    return { err: "", ok: true, out, tookMs: 5 };
  }
  return { err: "", exitCode, notMeasured: "exited", ok: false, out, tookMs: 5 };
}

const PAGE = {
  expiresInSeconds: 300,
  files: [{ byteLength: 12, relativePath: "shots/a.png", sha256: SHA, signedUrl: URL_SIGNED }],
  kind: "page",
  schemaVersion: 1,
  slug: "alpha",
};

describe("presentationOf", () => {
  it("asks for one page's presentation as JSON", () => {
    expect(pagePresentationArgv({ slug: "alpha" })).toEqual(["page", "read", "alpha", "--presentation", "--json"]);
  });

  it("keys each file by its path under the page", () => {
    const read = presentationOf({ outcome: ran({ document: PAGE }), slug: "alpha" });
    expect(read).toEqual({
      expiresInSeconds: 300,
      files: new Map([["shots/a.png", { byteLength: 12, sha256: SHA, signedUrl: URL_SIGNED }]]),
      kind: "page",
    });
  });

  it("reads a page that is not there from the verb's exit 3", () => {
    const document = { kind: "not-found", schemaVersion: 1, slug: "alpha" };
    expect(presentationOf({ outcome: ran({ document, exitCode: 3 }), slug: "alpha" })).toEqual({ kind: "not-found" });
  });

  it("carries the store's own reason from the verb's exit 1", () => {
    const document = {
      code: "PAGES_READ_UNAVAILABLE",
      kind: "store-unreadable",
      message: "down",
      schemaVersion: 1,
      slug: "alpha",
    };
    expect(presentationOf({ outcome: ran({ document, exitCode: 1 }), slug: "alpha" })).toEqual({
      kind: "store-unreadable",
      why: "down",
    });
  });

  it("believes a kind only under its own exit, reading any other pair as a store that could not say", () => {
    const notFound = { kind: "not-found", schemaVersion: 1, slug: "alpha" };
    const reads = [
      presentationOf({ outcome: ran({ document: notFound, exitCode: 1 }), slug: "alpha" }),
      presentationOf({ outcome: ran({ document: notFound }), slug: "alpha" }),
      presentationOf({ outcome: ran({ document: PAGE, exitCode: 3 }), slug: "alpha" }),
    ];
    expect(reads).toEqual([
      {
        kind: "store-unreadable",
        why: "slopweaver page read <slug> --presentation --json exited 1 printing not-found, which it never does",
      },
      {
        kind: "store-unreadable",
        why: "slopweaver page read <slug> --presentation --json exited 0 printing not-found, which it never does",
      },
      {
        kind: "store-unreadable",
        why: "slopweaver page read <slug> --presentation --json exited 3 printing page, which it never does",
      },
    ]);
  });

  it("reads a timeout, a non-JSON line, another slug and a non-http address as a store that could not say", () => {
    const timedOut: SpawnOutcome = {
      err: "",
      exitCode: undefined,
      notMeasured: "timed out",
      ok: false,
      out: "",
      tookMs: 5,
    };
    const notHttp = { ...PAGE, files: [{ ...PAGE.files[0], signedUrl: "file:///etc/passwd" }] };
    const reads = [
      presentationOf({ outcome: timedOut, slug: "alpha" }),
      presentationOf({ outcome: ran({ document: "not json" }), slug: "alpha" }),
      presentationOf({ outcome: ran({ document: PAGE }), slug: "beta" }),
      presentationOf({ outcome: ran({ document: notHttp }), slug: "alpha" }),
    ];
    expect(reads.map((read) => read.kind)).toEqual([
      "store-unreadable",
      "store-unreadable",
      "store-unreadable",
      "store-unreadable",
    ]);
    expect(reads[0]).toEqual({
      kind: "store-unreadable",
      why: "slopweaver page read <slug> --presentation --json did not finish",
    });
  });
});
