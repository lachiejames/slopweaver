/**
 * `everyPage`, the whole-collection read the attachment and category lists go through: every page is followed,
 * only a Graph-hosted link carries the bearer, and a collection longer than the ceiling is refused rather than
 * answered from a part. The page reader is a plain fake function that records the links it was asked for.
 */
import { describe, expect, it } from "vitest";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { Page } from "../../../../live/outlook/apiCore.js";
import { everyPage, MAX_COLLECTION_PAGES } from "../../../../live/outlook/apiRead.js";
import { type OutlookError, OutlookErrors } from "../../../../live/outlook/errors.js";

/** A link on Graph's own origin naming page `n`. */
function graphLink({ n }: { n: number }): string {
  return `https://graph.microsoft.com/v1.0/me/outlook/masterCategories?$skiptoken=${String(n)}`;
}

/** A page reader answering `pages` in order, recording every link it was handed. */
function pagedReader({ pages }: { pages: readonly Page<string>[] }): {
  asked: (string | undefined)[];
  fetchPage: (args: { link: string | undefined }) => Promise<Result<Page<string>, OutlookError>>;
} {
  const asked: (string | undefined)[] = [];
  return {
    asked,
    fetchPage: async ({ link }) => {
      asked.push(link);
      return ok(pages[asked.length - 1]!);
    },
  };
}

describe("everyPage", () => {
  it("answers a single page whole", async () => {
    const reader = pagedReader({ pages: [{ items: ["a", "b"], nextLink: undefined }] });

    const items = unwrap(await everyPage({ fetchPage: reader.fetchPage, operation: "outlook.test" }));

    expect(items).toEqual(["a", "b"]);
    expect(reader.asked).toEqual([undefined]);
  });

  it("follows each Graph link and joins the pages in order", async () => {
    const reader = pagedReader({
      pages: [
        { items: ["a"], nextLink: graphLink({ n: 2 }) },
        { items: ["b"], nextLink: graphLink({ n: 3 }) },
        { items: ["c"], nextLink: undefined },
      ],
    });

    const items = unwrap(await everyPage({ fetchPage: reader.fetchPage, operation: "outlook.test" }));

    expect(items).toEqual(["a", "b", "c"]);
    expect(reader.asked).toEqual([undefined, graphLink({ n: 2 }), graphLink({ n: 3 })]);
  });

  it("refuses a foreign link before asking for it", async () => {
    const reader = pagedReader({ pages: [{ items: ["a"], nextLink: "https://evil.example.test/next" }] });

    const refused = await everyPage({ fetchPage: reader.fetchPage, operation: "outlook.test" });

    expect(unwrapErr(refused).code).toBe("NEXT_LINK_REFUSED");
    expect(reader.asked).toEqual([undefined]);
  });

  it("refuses a collection still paging at the ceiling, naming the operation", async () => {
    const endless = Array.from({ length: MAX_COLLECTION_PAGES + 1 }, (_, n) => ({
      items: [String(n)],
      nextLink: graphLink({ n: n + 2 }),
    }));
    const reader = pagedReader({ pages: endless });

    const refused = await everyPage({ fetchPage: reader.fetchPage, operation: "outlook.categories.list" });

    const error = unwrapErr(refused);
    expect(error.code).toBe("COLLECTION_INCOMPLETE");
    expect(error.message).toContain("outlook.categories.list");
    expect(error.message).toContain(`after ${String(MAX_COLLECTION_PAGES)} pages`);
    expect(reader.asked.length).toBe(MAX_COLLECTION_PAGES);
  });

  it("passes a failed page through and reads no further", async () => {
    const asked: (string | undefined)[] = [];
    const fetchPage = async ({ link }: { link: string | undefined }): Promise<Result<Page<string>, OutlookError>> => {
      asked.push(link);
      if (link === undefined) {
        return ok({ items: ["a"], nextLink: graphLink({ n: 2 }) });
      }
      return err(OutlookErrors.apiFailed({ message: "503 synthetic outage" }));
    };

    const refused = await everyPage({ fetchPage, operation: "outlook.test" });

    expect(unwrapErr(refused).message).toBe("503 synthetic outage");
    expect(asked).toEqual([undefined, graphLink({ n: 2 })]);
  });
});
