import { describe, expect, it } from "vitest";

import {
  isLinearWorkspaceSlug,
  linearIssueUrl,
  linearKeyRefusal,
} from "../../../../outbound/linkify/linearWorkspaceSlug.js";

/** U+2028, built rather than typed: a literal one in source splits the line for some readers. */
const LINE_SEPARATOR = String.fromCodePoint(0x2028);

describe("isLinearWorkspaceSlug", () => {
  it("accepts letters, digits, a hyphen and an underscore after a leading letter or digit", () => {
    expect(["acme", "acme_hq-2", "9lives"].map((slug) => isLinearWorkspaceSlug({ slug }))).toEqual([true, true, true]);
  });

  // A trailing line ending is refused too: JavaScript's `$` without the `m` flag matches only at the end of
  // input, never before a final newline the way Perl's and Python's do.
  it("refuses an empty slug, a leading - or _, a trailing line ending, and anything leaving its segment", () => {
    const slugs = ["", "-lab", "_lab", "acme/hq", "acme.hq", "acme hq", "lab)", "lab%2F", "lab]", "acme\n"];
    const all = [...slugs, `acme${LINE_SEPARATOR}`];
    expect(all.map((slug) => isLinearWorkspaceSlug({ slug }))).toEqual(all.map(() => false));
  });
});

describe("linearIssueUrl", () => {
  it("builds the issue URL from a Linear-shaped slug", () => {
    expect(linearIssueUrl({ key: "ENG-12", slug: "acme" })).toBe("https://linear.app/acme/issue/ENG-12");
  });

  it("builds nothing from an absent or malformed slug", () => {
    expect([
      linearIssueUrl({ key: "ENG-12", slug: undefined }),
      linearIssueUrl({ key: "ENG-12", slug: "evil.test/x" }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("linearKeyRefusal", () => {
  it("names a malformed slug, and asks for a slug when none is known", () => {
    expect(linearKeyRefusal({ raw: "ENG-12", slug: "evil.test/x" })).toContain(
      'the workspace slug "evil.test/x" is not a Linear URL key',
    );
    expect(linearKeyRefusal({ raw: "ENG-12", slug: undefined })).toContain("with no workspace to link it into");
  });
});
