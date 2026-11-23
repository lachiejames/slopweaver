/**
 * Which of several pages the store publishes, over a fake reader: each distinct slug asked once about its document,
 * the published ones answered, and the first failed ask failing the whole answer rather than reading as unpublished.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { publishedAmongOver } from "../../../pages/published.js";
import { type PublishedPagesReadError, PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";

/** A reader whose file check answers `answer` for a slug, recording every ask. */
function readerAnswering({ answer }: { answer: (slug: string) => Result<boolean, PublishedPagesReadError> }) {
  const asked: { pageKey: string; relativePath: string }[] = [];
  return {
    asked,
    reader: {
      fileExists: async ({ pageKey, relativePath }: { pageKey: string; relativePath: string }) => {
        asked.push({ pageKey, relativePath });
        return answer(pageKey);
      },
    },
  };
}

describe("publishedAmongOver", () => {
  it("answers the published slugs, each distinct slug asked once about its document", async () => {
    const { asked, reader } = readerAnswering({ answer: (slug) => ok(slug !== "retro-brief") });
    const published = unwrap(
      await publishedAmongOver({ reader, slugs: ["standup-brief", "retro-brief", "standup-brief"] }),
    );
    expect([...published]).toEqual(["standup-brief"]);
    expect(asked).toEqual([
      { pageKey: "standup-brief", relativePath: "index.html" },
      { pageKey: "retro-brief", relativePath: "index.html" },
    ]);
  });

  it("asks nothing and answers none for no slugs", async () => {
    const { asked, reader } = readerAnswering({ answer: () => ok(true) });
    expect([...unwrap(await publishedAmongOver({ reader, slugs: [] }))]).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("fails the whole answer on the first failed ask, asking nothing after it", async () => {
    const stopped = PublishedPagesReadErrors.unavailable({
      cause: new Error("connect ECONNREFUSED"),
      doing: "connect",
    });
    const { asked, reader } = readerAnswering({
      answer: (slug) => (slug === "b" ? err(stopped) : ok(true)),
    });
    const failed = unwrapErr(await publishedAmongOver({ reader, slugs: ["a", "b", "c"] }));
    expect(failed).toEqual(stopped);
    expect(asked.map((ask) => ask.pageKey)).toEqual(["a", "b"]);
  });
});
