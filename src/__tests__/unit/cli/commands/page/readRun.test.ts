/**
 * `page read --presentation` against a fake store: the document it prints for a page, for no page and for a store that
 * cannot say, the exit code each carries, and the arguments it refuses before reading anything.
 */
import { describe, expect, it } from "vitest";
import { type PageReadDeps, pageReadOptions, runPageRead } from "../../../../../cli/commands/page/readRun.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrapErr } from "../../../../../lib/result.js";
import type { PagePresentation } from "../../../../../store/publishedPages/presentation.js";
import { PublishedPagesReadErrors } from "../../../../../store/publishedPages/readErrors.js";

const PRESENTED: PagePresentation = {
  expiresInSeconds: 300,
  files: [
    {
      byteLength: 120,
      relativePath: "index.html",
      sha256: "a".repeat(64),
      signedUrl: "http://127.0.0.1:54321/storage/v1/object/sign/published-pages/doc?token=t1",
    },
  ],
  pageKey: "standup-brief",
};

/** Run the verb over a store answering `answer`, collecting both sinks and every slug asked. */
async function readWith({
  rest,
  answer,
}: {
  rest: readonly string[];
  answer: Awaited<ReturnType<PageReadDeps["presentation"]>>;
}): Promise<{ code: number; out: string[]; diagnostics: string[]; asked: string[] }> {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const asked: string[] = [];
  const code = await runPageRead({
    deps: {
      presentation: async ({ slug }) => {
        asked.push(slug);
        return answer;
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    rest,
  });
  return { asked, code, diagnostics, out };
}

describe("page read --presentation", () => {
  it("prints every file the page serves, signed, and exits 0", async () => {
    const run = await readWith({ answer: ok(PRESENTED), rest: ["standup-brief", "--presentation", "--json"] });
    expect(run.code).toBe(EXIT_OK);
    expect(JSON.parse(run.out[0]!)).toEqual({
      expiresInSeconds: 300,
      files: PRESENTED.files,
      kind: "page",
      schemaVersion: 1,
      slug: "standup-brief",
    });
    expect(run.asked).toEqual(["standup-brief"]);
  });

  it("says a page the store does not hold is not found, and exits 3", async () => {
    const answer = err(PublishedPagesReadErrors.notPublished({ pageKey: "retro-brief" }));
    const run = await readWith({ answer, rest: ["retro-brief", "--presentation", "--json"] });
    expect(run.code).toBe(EXIT_EXPECTED_EMPTY);
    expect(JSON.parse(run.out[0]!)).toEqual({ kind: "not-found", schemaVersion: 1, slug: "retro-brief" });
  });

  it("says a store that cannot answer is unreadable, never not found, and exits 1", async () => {
    const answer = err(
      PublishedPagesReadErrors.unavailable({ cause: new Error("connect ECONNREFUSED"), doing: "connect" }),
    );
    const run = await readWith({ answer, rest: ["standup-brief", "--presentation", "--json"] });
    expect(run.code).toBe(EXIT_ERROR);
    expect(JSON.parse(run.out[0]!)).toEqual({
      code: "PAGES_READ_UNAVAILABLE",
      kind: "store-unreadable",
      message: "the published-page store did not connect: connect ECONNREFUSED",
      schemaVersion: 1,
      slug: "standup-brief",
    });
  });

  it("prints each file and its size for a person, never an address", async () => {
    const run = await readWith({ answer: ok(PRESENTED), rest: ["standup-brief", "--presentation"] });
    expect(run.out).toEqual(["standup-brief: 1 file(s), signed for 300s", "  index.html  120 bytes"]);
  });

  it("refuses a missing --presentation, a second slug and a slug outside the alphabet before reading", async () => {
    const run = await readWith({ answer: ok(PRESENTED), rest: ["standup-brief"] });
    expect(run.code).toBe(EXIT_USAGE);
    expect(run.asked).toEqual([]);
    expect(unwrapErr(pageReadOptions({ rest: ["a", "b", "--presentation"] }))).toEqual([
      "page read takes exactly one slug, got 2",
    ]);
    expect(unwrapErr(pageReadOptions({ rest: ["../etc", "--presentation"] }))).toEqual(['"../etc" is not a page slug']);
  });
});
