/**
 * `browser present` asking the store which pages are published before its pure resolve: the slugs asked, the store
 * left closed for a request naming no page, a store that cannot say refused rather than read as "not published",
 * and a resolve that asks about a slug the first pass never named refused rather than answered.
 */
import { describe, expect, it } from "vitest";

import { resolvePresentTarget } from "../../../browser/present.js";
import {
  isPresentPagesError,
  PresentPagesErrors,
  resolveOverPublishedPages,
  resolvePresentOverStore,
} from "../../../browser/presentPublished.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { type PublishedPagesReadError, PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";

/** A store fake answering every ask with `answer`, and recording the slugs of each. */
function storeAnswering({ answer }: { answer: Result<ReadonlySet<string>, PublishedPagesReadError> }): {
  asked: (readonly string[])[];
  publishedAmong: (input: {
    slugs: readonly string[];
  }) => Promise<Result<ReadonlySet<string>, PublishedPagesReadError>>;
} {
  const asked: (readonly string[])[] = [];
  return {
    asked,
    publishedAmong: async ({ slugs }) => {
      asked.push(slugs);
      return answer;
    },
  };
}

/** The real resolve for one `--page` or `--url`, over whatever predicate the helper hands it. */
function presenting({
  page,
  url,
}: {
  page?: string;
  url?: string;
}): (pagePublished: (slug: string) => boolean) => ReturnType<typeof resolvePresentTarget> {
  return (pagePublished) =>
    resolvePresentTarget({
      consoleBase: "http://localhost:3000",
      ddSite: undefined,
      pagePublished,
      request: { destination: undefined, page, url },
    });
}

describe("resolveOverPublishedPages", () => {
  it("opens a page the store publishes, having asked about that slug alone", async () => {
    const store = storeAnswering({ answer: ok(new Set(["standup-brief"])) });
    const target = unwrap(
      unwrap(await resolveOverPublishedPages({ ...store, resolve: presenting({ page: "standup-brief" }) })),
    );
    expect(target.url).toBe("http://localhost:3000/api/page/standup-brief/index.html");
    expect(store.asked).toEqual([["standup-brief"]]);
  });

  it("refuses a page the store does not publish as not published", async () => {
    const store = storeAnswering({ answer: ok(new Set()) });
    const target = unwrap(await resolveOverPublishedPages({ ...store, resolve: presenting({ page: "retro-brief" }) }));
    expect(unwrapErr(target).code).toBe("PAGE_NOT_PUBLISHED");
  });

  it("never opens the store for a request that names no local page", async () => {
    const store = storeAnswering({ answer: err(PublishedPagesReadErrors.unavailable({ cause: "down", doing: "x" })) });
    const target = unwrap(
      unwrap(await resolveOverPublishedPages({ ...store, resolve: presenting({ url: "https://github.com/pulls" }) })),
    );
    expect(target.url).toBe("https://github.com/pulls");
    expect(store.asked).toEqual([]);
  });

  it("refuses with the store's reason when the store cannot say, never answering not published", async () => {
    const stopped = PublishedPagesReadErrors.unavailable({
      cause: new Error("connect ECONNREFUSED"),
      doing: "connect",
    });
    const store = storeAnswering({ answer: err(stopped) });
    const failed = unwrapErr(
      await resolveOverPublishedPages({ ...store, resolve: presenting({ page: "standup-brief" }) }),
    );
    expect(failed).toEqual(PresentPagesErrors.storeUnreadable({ cause: stopped }));
    expect(failed.message).toBe(
      "browser present: the store could not say whether the page is published: " +
        "the published-page store did not connect: connect ECONNREFUSED",
    );
  });

  it("refuses a second resolve that asks about a slug the first never named", async () => {
    const store = storeAnswering({ answer: ok(new Set(["first"])) });
    let passes = 0;
    const failed = unwrapErr(
      await resolveOverPublishedPages({
        ...store,
        resolve: (pagePublished) => {
          passes += 1;
          return pagePublished(passes === 1 ? "first" : "second");
        },
      }),
    );
    expect(failed).toEqual(PresentPagesErrors.notAsked({ slugs: ["second"] }));
    expect(store.asked).toEqual([["first"]]);
  });
});

describe("resolvePresentOverStore", () => {
  const consoleBase = "http://localhost:3000";

  it("opens a published page, and refuses an unpublished one as the request's own refusal", async () => {
    const store = storeAnswering({ answer: ok(new Set(["standup-brief"])) });
    const request = { destination: undefined, url: undefined };
    const opened = await resolvePresentOverStore({
      ...store,
      consoleBase,
      ddSite: undefined,
      request: { ...request, page: "standup-brief" },
    });
    expect(unwrap(opened).url).toBe("http://localhost:3000/api/page/standup-brief/index.html");
    const refused = unwrapErr(
      await resolvePresentOverStore({
        ...store,
        consoleBase,
        ddSite: undefined,
        request: { ...request, page: "retro-brief" },
      }),
    );
    expect(refused.code).toBe("PAGE_NOT_PUBLISHED");
    expect(isPresentPagesError(refused)).toBe(false);
  });

  it("refuses as the store's own refusal when the store cannot say", async () => {
    const stopped = PublishedPagesReadErrors.unavailable({
      cause: new Error("connect ECONNREFUSED"),
      doing: "connect",
    });
    const store = storeAnswering({ answer: err(stopped) });
    const refused = unwrapErr(
      await resolvePresentOverStore({
        ...store,
        consoleBase,
        ddSite: undefined,
        request: { destination: undefined, page: "standup-brief", url: undefined },
      }),
    );
    expect(refused).toEqual(PresentPagesErrors.storeUnreadable({ cause: stopped }));
    expect(isPresentPagesError(refused)).toBe(true);
  });
});
