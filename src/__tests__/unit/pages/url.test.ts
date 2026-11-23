import { describe, expect, it } from "vitest";

import {
  isLocalPageUrl,
  isValidPageSlug,
  LOCAL_PAGE_URL_IN_TEXT,
  localPageSlug,
  PAGE_FILENAME,
  PAGES_DIRECTORY,
  pageIdentity,
} from "../../../pages/url.js";

describe("localPageSlug", () => {
  it("reads the slug out of a local page's address", () => {
    expect(localPageSlug({ url: "file:///Users/x/.slopweaver/pages/queue-decision/index.html" })).toBe(
      "queue-decision",
    );
  });

  it("reads it through a home whose path is percent-encoded", () => {
    expect(localPageSlug({ url: "file:///Users/a%20b/.slopweaver/pages/queue/index.html" })).toBe("queue");
  });

  it("accepts the localhost host a file URL may carry", () => {
    expect(localPageSlug({ url: "file://localhost/home/x/pages/queue/index.html" })).toBe("queue");
  });

  it("ignores a query and a fragment, which are not part of the identity", () => {
    expect(localPageSlug({ url: "file:///x/pages/queue/index.html#section" })).toBe("queue");
    expect(localPageSlug({ url: "file:///x/pages/queue/index.html?v=2" })).toBe("queue");
  });

  it("is undefined for an address that is not a local page", () => {
    expect(localPageSlug({ url: "https://claude.ai/code/artifact/7d871caf-9d5d-4658-8502-b2bfed2cd9fb" })).toBe(
      undefined,
    );
    expect(localPageSlug({ url: "file:///x/pages/queue/other.html" })).toBe(undefined);
    expect(localPageSlug({ url: "file:///x/notpages/queue/index.html" })).toBe(undefined);
    expect(localPageSlug({ url: "file:///x/index.html" })).toBe(undefined);
    expect(localPageSlug({ url: "not a url at all" })).toBe(undefined);
    expect(localPageSlug({ url: "" })).toBe(undefined);
  });

  it("refuses a host that is not this machine, so a remote path cannot claim a local page's identity", () => {
    expect(localPageSlug({ url: "file://evil.example/x/pages/queue/index.html" })).toBe(undefined);
  });

  it("refuses a separator smuggled through an escape rather than resolving outside the pages tree", () => {
    expect(localPageSlug({ url: "file:///x/pages/a%2F..%2Fb/index.html" })).toBe(undefined);
    expect(localPageSlug({ url: "file:///x/pages/%2e%2e/index.html" })).toBe(undefined);
    expect(localPageSlug({ url: "file:///x/pages/a%ZZb/index.html" })).toBe(undefined);
  });

  it("refuses a slug that does not fit the alphabet a directory name may carry", () => {
    expect(localPageSlug({ url: "file:///x/pages/-leading/index.html" })).toBe(undefined);
    expect(localPageSlug({ url: `file:///x/pages/${"a".repeat(129)}/index.html` })).toBe(undefined);
  });

  it("accepts a slug at exactly the 128-character bound", () => {
    expect(localPageSlug({ url: `file:///x/pages/${"a".repeat(128)}/index.html` })).toBe("a".repeat(128));
  });
});

describe("isLocalPageUrl", () => {
  it("agrees with localPageSlug on both answers", () => {
    expect(isLocalPageUrl({ url: "file:///x/pages/queue/index.html" })).toBe(true);
    expect(isLocalPageUrl({ url: "file:///x/screenshots/shot.png" })).toBe(false);
    expect(isLocalPageUrl({ url: "https://github.com/lachiejames/slopweaver/pull/1" })).toBe(false);
  });
});

describe("LOCAL_PAGE_URL_IN_TEXT", () => {
  it("matches an address built from the two constants the parser reads", () => {
    const url = `file:///Users/x/.slopweaver/${PAGES_DIRECTORY}/queue-decision/${PAGE_FILENAME}`;
    expect(`see ${url} for the options`.match(LOCAL_PAGE_URL_IN_TEXT)).toStrictEqual([url]);
  });

  it("stops before the sentence punctuation a composer leaves on it", () => {
    const found = "open file:///x/pages/queue/index.html.".match(LOCAL_PAGE_URL_IN_TEXT);
    expect(found).toStrictEqual(["file:///x/pages/queue/index.html"]);
  });

  it("does not claim a file address that is not one of these pages", () => {
    expect("file:///tmp/run.log".match(LOCAL_PAGE_URL_IN_TEXT)).toBe(null);
  });
});

describe("isValidPageSlug", () => {
  it("takes a readable name and refuses anything that would become a different directory", () => {
    expect(isValidPageSlug({ slug: "queue-decision" })).toBe(true);
    expect(isValidPageSlug({ slug: "a.b_c-1" })).toBe(true);
    expect(isValidPageSlug({ slug: "a/b" })).toBe(false);
    expect(isValidPageSlug({ slug: ".." })).toBe(false);
    expect(isValidPageSlug({ slug: "" })).toBe(false);
    expect(isValidPageSlug({ slug: "/abs" })).toBe(false);
    expect(isValidPageSlug({ slug: ".hidden" })).toBe(false);
  });
});

describe("pageIdentity", () => {
  it("is the key a lock-in row names, mirroring the artifact convention", () => {
    expect(pageIdentity({ slug: "queue-decision" })).toBe("page:queue-decision");
  });
});

describe("a path that could never name a real file", () => {
  it("is not a local page, however well the slug itself reads", () => {
    const nul = `file:///tmp/${encodeURIComponent(String.fromCodePoint(0))}/pages/alpha/index.html`;
    expect(localPageSlug({ url: nul })).toBe(undefined);
    expect(isLocalPageUrl({ url: nul })).toBe(false);
  });

  it("but a path with an ordinary encoded character still is", () => {
    expect(localPageSlug({ url: "file:///tmp/a%20b/pages/alpha/index.html" })).toBe("alpha");
  });
});

describe("an address that converts to no filesystem path", () => {
  it("is refused whatever the spelling — an encoded separator in an ancestor, not only in the slug", () => {
    expect(localPageSlug({ url: "file:///tmp/a%2Fb/pages/alpha/index.html" })).toBe(undefined);
    expect(isLocalPageUrl({ url: "file:///tmp/a%2Fb/pages/alpha/index.html" })).toBe(false);
  });
});
