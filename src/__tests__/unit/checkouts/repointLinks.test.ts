import { describe, expect, it } from "vitest";

import { applyLinkReplacements, historicalLinkReplacements } from "../../../checkouts/repointLinks.js";

const REPOSITORY = "acme/widgets";
const ARCHIVE = "widgets-archive";
const find = ({ text }: { text: string }) =>
  historicalLinkReplacements({ archiveName: ARCHIVE, repository: REPOSITORY, text });

describe("historicalLinkReplacements", () => {
  it("moves a pull request, an issue and a commit link to the archive's name", () => {
    const text = [
      "https://github.com/acme/widgets/pull/12",
      "https://github.com/acme/widgets/issues/3",
      "https://github.com/acme/widgets/commit/0123abc",
    ].join("\n");

    expect(find({ text }).map((replacement) => replacement.to)).toEqual([
      "https://github.com/acme/widgets-archive/pull/12",
      "https://github.com/acme/widgets-archive/issues/3",
      "https://github.com/acme/widgets-archive/commit/0123abc",
    ]);
  });

  it("counts a repeated link once, with its occurrences", () => {
    const text = "see https://github.com/acme/widgets/pull/12 and again https://github.com/acme/widgets/pull/12";

    expect(find({ text })).toEqual([
      {
        from: "https://github.com/acme/widgets/pull/12",
        occurrences: 2,
        to: "https://github.com/acme/widgets-archive/pull/12",
      },
    ]);
  });

  it("keeps the route's fragment and query byte for byte", () => {
    const text = "https://github.com/acme/widgets/pull/12#discussion_r9?x=1";

    expect(find({ text })[0]!.to).toBe("https://github.com/acme/widgets-archive/pull/12#discussion_r9?x=1");
  });

  it("matches the coordinate in any case, as GitHub resolves it", () => {
    expect(find({ text: "https://github.com/Acme/Widgets/pull/7" })[0]!.to).toBe(
      "https://github.com/acme/widgets-archive/pull/7",
    );
  });

  it("stops at a closing quote, bracket or backtick", () => {
    const text = `"https://github.com/acme/widgets/pull/1" (https://github.com/acme/widgets/pull/2) \`https://github.com/acme/widgets/pull/3\``;

    expect(find({ text }).map((replacement) => replacement.from)).toEqual([
      "https://github.com/acme/widgets/pull/1",
      "https://github.com/acme/widgets/pull/2",
      "https://github.com/acme/widgets/pull/3",
    ]);
  });

  it("leaves the home link, a tree link, an API URL, bare owner/name and the archive's own links alone", () => {
    const text = [
      "https://github.com/acme/widgets",
      "https://github.com/acme/widgets/tree/main",
      "https://api.github.com/repos/acme/widgets/pulls/1",
      "acme/widgets",
      "https://github.com/acme/widgets-archive/pull/1",
    ].join("\n");

    expect(find({ text })).toEqual([]);
  });

  it("leaves a repository whose name merely starts with the same letters alone", () => {
    expect(find({ text: "https://github.com/acme/widgetsx/pull/1 https://github.com/notacme/widgets/pull/1" })).toEqual(
      [],
    );
  });
});

describe("applyLinkReplacements", () => {
  it("rewrites every occurrence and nothing else", () => {
    const text = "a https://github.com/acme/widgets/pull/1 b https://github.com/acme/widgets/pull/1 c";

    expect(applyLinkReplacements({ replacements: find({ text }), text })).toBe(
      "a https://github.com/acme/widgets-archive/pull/1 b https://github.com/acme/widgets-archive/pull/1 c",
    );
  });

  it("rewrites a link that is a prefix of another without corrupting the longer one", () => {
    const text = "https://github.com/acme/widgets/pull/1 https://github.com/acme/widgets/pull/12";

    expect(applyLinkReplacements({ replacements: find({ text }), text })).toBe(
      "https://github.com/acme/widgets-archive/pull/1 https://github.com/acme/widgets-archive/pull/12",
    );
  });

  it("returns a text with no links unchanged", () => {
    expect(applyLinkReplacements({ replacements: [], text: "nothing here" })).toBe("nothing here");
  });
});
