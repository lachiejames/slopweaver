/**
 * The pure preflight over a markdown body bound for Notion. Every case here is a REFUSAL boundary: the
 * point of the module is that a body Notion would reject, or would accept while mangling, never reaches a
 * page — because a publish that fails at the provider has already created one.
 */
import { describe, expect, it } from "vitest";
import {
  bodyPreviewLines,
  canonicalCarriesTable,
  canonicalHash,
  checkMarkdownBody,
  incompleteReadReason,
  REQUEST_BYTES_MAX,
  stableCanonical,
} from "../../../../outbound/notion/markdownBody.js";

/** A Notion-hosted image URL, signed exactly as `pages.retrieveMarkdown` returns one. */
function signedUrl({ stamp }: { stamp: string }): string {
  return (
    "https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b/hero.png?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    `&X-Amz-Date=${stamp}&X-Amz-Expires=3600&X-Amz-Signature=${stamp}beef`
  );
}

/** Unwrap the errors of a refused check without a conditional in the assertion. */
function errorsOf({ markdown }: { markdown: string }): readonly string[] {
  const checked = checkMarkdownBody({ markdown });
  return checked.isOk() ? [] : checked.error;
}

describe("checkMarkdownBody", () => {
  it("accepts the golden shape", () => {
    const markdown = [
      "> *Rough, still iterating.*",
      "",
      '<table_of_contents color="gray"/>',
      "",
      "## TL;DR",
      "",
      "The thing is broken.",
      "",
      "![hero](https://example.test/shot.png)",
    ].join("\n");
    expect(checkMarkdownBody({ markdown }).isOk()).toBe(true);
  });

  it("refuses an empty body", () => {
    expect(errorsOf({ markdown: "   \n\n  " })).toEqual(["the body is empty; there is nothing to publish"]);
  });

  it("refuses a body over Notion's per-request byte ceiling", () => {
    const errors = errorsOf({ markdown: "x".repeat(REQUEST_BYTES_MAX + 1) });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain(`${String(REQUEST_BYTES_MAX + 1)} bytes`);
  });

  it("refuses an H1, because the Notion title is a property rather than a block", () => {
    const errors = errorsOf({ markdown: "# A title\n\nbody" });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("--title");
  });

  it("does not mistake a heading_2 for an H1", () => {
    expect(checkMarkdownBody({ markdown: "## TL;DR\n\nbody" }).isOk()).toBe(true);
  });

  it("refuses an image whose source is a placeholder rather than a URL", () => {
    const errors = errorsOf({ markdown: "![hero](slot:hero-shot)" });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('"slot:hero-shot"');
  });

  it("refuses a local image path", () => {
    expect(errorsOf({ markdown: "![hero](./shots/hero.png)" })[0]).toContain('"./shots/hero.png"');
  });

  it("accepts an https image and reports every problem in one pass", () => {
    expect(checkMarkdownBody({ markdown: "![hero](https://example.test/a.png)" }).isOk()).toBe(true);
    expect(errorsOf({ markdown: "# T\n\n![a](x.png)\n\n![b](y.png)" }).length).toBe(3);
  });

  it("ACCEPTS a `file:` upload placeholder, which the attach pass turns into a hosted image", () => {
    expect(checkMarkdownBody({ markdown: "![hero](file:./shots/hero.png)" }).isOk()).toBe(true);
  });

  it("still refuses a bare local path, because Notion silently builds a BROKEN image block from one", () => {
    expect(errorsOf({ markdown: "![hero](./shots/hero.png)" })[0]).toContain("file:");
  });

  it("ACCEPTS a `file:` LINK placeholder, which the attach pass turns into a hosted `pdf` block", () => {
    expect(checkMarkdownBody({ markdown: "[the DPA](file:./dpa.pdf)" }).isOk()).toBe(true);
  });

  // The document half of the image trap. Notion builds a DEAD link from a local path and reports nothing,
  // so the refusal is what turns a silent publish-and-look-wrong into a fix with a spelling attached.
  it("refuses a local link to a file this lane could have uploaded, naming the `file:` spelling", () => {
    const errors = errorsOf({ markdown: "[the DPA](./dpa.pdf)" });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("[caption](file:./doc.pdf)");
  });

  // The remedy has to be the spelling that WORKS for that extension. Advising the link form for an image
  // would be advising a sigil the attach pass then refuses, so a reader following the refusal literally
  // would be refused again by a different rule.
  it("advises the IMAGE sigil for an image extension, not the link form that would be refused next", () => {
    const errors = errorsOf({ markdown: "[the hero shot](./hero.png)" });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("![caption](file:./shot.png)");
    expect(errors[0]).toContain("an image needs the `!`");
  });

  // The scope, and it is the whole reason the refusal is keyed on the EXTENSION. A body is full of links
  // legitimately, and a blanket non-http rule would refuse every one of these three.
  it("leaves an anchor, a mailto and a local path it could not have uploaded alone", () => {
    expect(checkMarkdownBody({ markdown: "[see below](#appendix)" }).isOk()).toBe(true);
    expect(checkMarkdownBody({ markdown: "[mail me](mailto:a@b.test)" }).isOk()).toBe(true);
    expect(checkMarkdownBody({ markdown: "[the notes](./notes.docx)" }).isOk()).toBe(true);
  });

  it("leaves a local attachment link that is not alone on its line, matching the image rule exactly", () => {
    expect(checkMarkdownBody({ markdown: "read [the DPA](./dpa.pdf) first" }).isOk()).toBe(true);
  });
});

describe("stableCanonical", () => {
  it("strips the rotating signature off a Notion-hosted image, so two reads of one page agree", () => {
    const first = `## A\n![shot](${signedUrl({ stamp: "20260822T101546Z" })})\nprose`;
    const second = `## A\n![shot](${signedUrl({ stamp: "20260822T111546Z" })})\nprose`;
    expect(first).not.toBe(second);
    expect(stableCanonical({ canonical: first })).toBe(stableCanonical({ canonical: second }));
  });

  it("keeps the image's path and caption, so a swapped shot is still a changed page", () => {
    const stable = stableCanonical({ canonical: `![shot](${signedUrl({ stamp: "20260822T101546Z" })})` });
    expect(stable).toBe("![shot](https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b/hero.png)");
  });

  it("leaves an ordinary external image completely alone, query string and all", () => {
    const external = "![x](https://example.test/a.png?v=3)";
    expect(stableCanonical({ canonical: external })).toBe(external);
  });

  it("leaves a body with no images at all untouched", () => {
    expect(stableCanonical({ canonical: "## A\nprose" })).toBe("## A\nprose");
  });
});

describe("incompleteReadReason", () => {
  it("passes a complete read", () => {
    expect(incompleteReadReason({ truncated: false, unknownBlockIds: [] })).toBe(undefined);
  });

  it("names truncation, because a digest over a partial read compares nothing to everything", () => {
    expect(incompleteReadReason({ truncated: true, unknownBlockIds: [] })).toContain("TRUNCATED");
  });

  it("names the blocks Notion could not express, which an update would destroy unseen", () => {
    const reason = incompleteReadReason({ truncated: false, unknownBlockIds: ["b1", "b2"] });
    expect(reason).toContain("2 block(s)");
    expect(reason).toContain("b1, b2");
  });
});

describe("canonicalHash", () => {
  it("is stable for identical input", () => {
    expect(canonicalHash({ canonical: "## A\nbody" })).toBe(canonicalHash({ canonical: "## A\nbody" }));
  });

  it("differs for a one-character change", () => {
    expect(canonicalHash({ canonical: "## A" })).not.toBe(canonicalHash({ canonical: "## B" }));
  });

  it("is 32 hex characters, so it is safe as a filename", () => {
    expect(canonicalHash({ canonical: "x" })).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is IDENTICAL across two reads of one page carrying an uploaded image", () => {
    expect(canonicalHash({ canonical: `![s](${signedUrl({ stamp: "20260822T101546Z" })})` })).toBe(
      canonicalHash({ canonical: `![s](${signedUrl({ stamp: "20260822T111546Z" })})` }),
    );
  });
});

describe("bodyPreviewLines", () => {
  it("drops blank lines and keeps the leading ones", () => {
    expect(bodyPreviewLines({ lines: 2, markdown: "a\n\nb\n\nc" })).toEqual(["a", "b", "… and 1 more line(s)"]);
  });

  it("shows everything when the body is short", () => {
    expect(bodyPreviewLines({ lines: 5, markdown: "a\nb" })).toEqual(["a", "b"]);
  });

  it("clips a long line rather than wrapping the terminal", () => {
    const line = bodyPreviewLines({ lines: 1, markdown: "x".repeat(200) })[0]!;
    expect(line.length).toBe(111);
    expect(line.endsWith("…")).toBe(true);
  });
});

describe("canonicalCarriesTable", () => {
  it("finds the `<table>` Notion's own read-back actually returns", () => {
    expect(canonicalCarriesTable({ canonical: "para\n\n<table>\n<tr><td>a</td></tr>\n</table>" })).toBe(true);
  });

  it("finds a pipe table too, which is what an operator writes", () => {
    expect(canonicalCarriesTable({ canonical: "lead\n\n| a | b |\n| - | - |\n| 1 | 2 |" })).toBe(true);
  });

  it("is false for a body with no table, so the blind-spot note stays earned", () => {
    expect(canonicalCarriesTable({ canonical: "## H\n\nprose with a | pipe mid-sentence and no row" })).toBe(false);
  });

  it("is false for an empty body", () => {
    expect(canonicalCarriesTable({ canonical: "" })).toBe(false);
  });
});
