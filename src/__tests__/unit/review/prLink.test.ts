import { describe, expect, it } from "vitest";

import { findPrLinks, linksPrExactly, slackHaystack, taggedIn } from "../../../review/prLink.js";

/** The exact shape Slack stores a labelled GitHub link in — the case the projected text loses. */
const LABELLED = "<https://github.com/owner/repo/pull/16304|#16304> drop stale basic-ftp pin";

describe("findPrLinks", () => {
  it("finds a link inside Slack's own labelled markup", () => {
    expect(findPrLinks({ haystack: LABELLED })).toEqual([{ number: 16304, owner: "owner", repo: "repo" }]);
  });

  it("finds a link with no scheme, which is how Slack renders a bare one", () => {
    expect(findPrLinks({ haystack: "see github.com/o/r/pull/7 please" })).toEqual([
      { number: 7, owner: "o", repo: "r" },
    ]);
  });

  it("accepts the /issues/ spelling GitHub serves the same pull request under", () => {
    expect(findPrLinks({ haystack: "https://github.com/o/r/issues/16370" })).toEqual([
      { number: 16370, owner: "o", repo: "r" },
    ]);
  });

  it("dedupes a link repeated in one message, keeping first-seen order", () => {
    const found = findPrLinks({ haystack: "github.com/o/r/pull/2 and github.com/o/r/pull/1 and o/r/pull/2" });
    expect(found).toEqual([
      { number: 2, owner: "o", repo: "r" },
      { number: 1, owner: "o", repo: "r" },
    ]);
  });

  it("finds nothing in a message that links nothing", () => {
    expect(findPrLinks({ haystack: "no links here at all" })).toEqual([]);
  });
});

describe("linksPrExactly", () => {
  it("refuses a prefix match, so a longer number is never reported as its prefix", () => {
    expect(linksPrExactly({ haystack: "github.com/o/r/pull/123", ref: { number: 12, owner: "o", repo: "r" } })).toBe(
      false,
    );
  });

  it("matches the exact number when a path follows it", () => {
    expect(
      linksPrExactly({ haystack: "github.com/o/r/pull/12/files", ref: { number: 12, owner: "o", repo: "r" } }),
    ).toBe(true);
  });

  it("refuses the same number in a different repository", () => {
    expect(linksPrExactly({ haystack: "github.com/o/other/pull/12", ref: { number: 12, owner: "o", repo: "r" } })).toBe(
      false,
    );
  });
});

describe("taggedIn", () => {
  it("finds a structural person mention run", () => {
    expect(taggedIn({ haystack: "<@U3> <@U4> could you review" })).toEqual(["U3", "U4"]);
  });

  it("finds a user-group mention run", () => {
    expect(taggedIn({ haystack: "<!subteam^S123ABC|@platform> please look" })).toEqual(["S123ABC"]);
  });

  it("ignores a bare @handle, which pings nobody", () => {
    expect(taggedIn({ haystack: "@jonah can you review github.com/o/r/pull/1" })).toEqual([]);
  });

  it("ignores a bare user id that is not inside a mention run", () => {
    expect(taggedIn({ haystack: '{"reply_users":["U3"]}' })).toEqual([]);
  });

  it("dedupes a person tagged twice", () => {
    expect(taggedIn({ haystack: "<@U1> hi <@U1>" })).toEqual(["U1"]);
  });
});

describe("slackHaystack", () => {
  it("carries the raw payload, which is where a labelled link survives", () => {
    const haystack = slackHaystack({ record: { raw: { text: LABELLED }, text: "#16304 drop stale basic-ftp pin" } });
    expect(linksPrExactly({ haystack, ref: { number: 16304, owner: "owner", repo: "repo" } })).toBe(true);
  });

  it("still carries the projected text when no raw payload was retained", () => {
    const haystack = slackHaystack({ record: { text: "github.com/o/r/pull/5" } });
    expect(linksPrExactly({ haystack, ref: { number: 5, owner: "o", repo: "r" } })).toBe(true);
  });

  it("finds nothing in a record whose projection dropped the link and which kept no raw payload", () => {
    const haystack = slackHaystack({ record: { text: "#16304 drop stale basic-ftp pin" } });
    expect(findPrLinks({ haystack })).toEqual([]);
  });
});
