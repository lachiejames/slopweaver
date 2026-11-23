import { describe, expect, it } from "vitest";

import { bareAddresses, brokenAddresses, linkDocumentMarkdown, linkPhrases } from "../../../../policy/diff/link.js";
import { CONTEXT, CONTROL_URL } from "./fixture.js";

const SDP = { text: "Secure Development Policy", url: "https://x.test/sdp" };
const DEV = { text: "Development", url: "https://x.test/dev" };

describe("linkPhrases", () => {
  it("links the longest phrase first, keeping the text's own casing", () => {
    expect(linkPhrases({ markdown: "per the secure development policy", phrases: [DEV, SDP] })).toBe(
      "per the [secure development policy](https://x.test/sdp)",
    );
  });

  it("links only at word boundaries", () => {
    expect(linkPhrases({ markdown: "Developments and Development", phrases: [DEV] })).toBe(
      "Developments and [Development](https://x.test/dev)",
    );
  });

  it("percent-encodes a bracket or space in the address, so the link is not cut short", () => {
    const privacy = { text: "Privacy Policy", url: "https://x.test/policies/custom-privacy-(external%2C-customer) b" };
    expect(linkPhrases({ markdown: "see the Privacy Policy", phrases: [privacy] })).toBe(
      "see the [Privacy Policy](https://x.test/policies/custom-privacy-%28external%2C-customer%29%20b)",
    );
  });

  it("never links inside an existing link or a code span", () => {
    const markdown = "[Development](https://y.test) and `Development`";
    expect(linkPhrases({ markdown, phrases: [DEV] })).toBe(markdown);
  });
});

describe("linkDocumentMarkdown", () => {
  it("links a control id through the identifier resolver", () => {
    expect(linkDocumentMarkdown({ context: CONTEXT, markdown: "NET-38 holds", phrases: [] })).toEqual({
      markdown: `[NET-38](${CONTROL_URL}) holds`,
      unresolved: [],
      unsafe: [],
    });
  });

  it("reports an address with a scheme a page must not carry, and passes the safe ones", () => {
    const markdown =
      "[a](javascript:alert`1`) [b](JAVASCRIPT:x) ![c](data:image/png;base64,AA) [d](https://x.test) [e](mailto:a@b.test) [f](policies/x.md) ![g](diff-image:ab12)";
    expect(linkDocumentMarkdown({ context: CONTEXT, markdown, phrases: [] }).unsafe).toEqual([
      "javascript:alert`1`",
      "JAVASCRIPT:x",
      "data:image/png;base64,AA",
    ]);
  });

  it("reports a scheme hidden behind a control character, and an image key used as a link", () => {
    const markdown = "See [runbook](\u0001javascript:alert`1`) and [x](diff-image:ab12) now.";
    expect(linkDocumentMarkdown({ context: CONTEXT, markdown, phrases: [] }).unsafe).toEqual([
      "\u0001javascript:alert`1`",
      "diff-image:ab12",
    ]);
  });

  it("names an address that would lead nowhere once published, and passes the rest", () => {
    const markdown =
      "[a](./runbook.md) [b](#scope) [c](https://docs.acme.com) [h](https://) [i](mailto:a@acme.com) ![d](topology.avif) ![e](https://cdn.acme.com/m.png) ![j](http://cdn.acme.com/m.png) ![f](diff-image:aa) ![g](diff-image:bb)";
    expect(brokenAddresses({ images: new Set(["diff-image:aa"]), markdown })).toEqual([
      "./runbook.md",
      "#scope",
      "https://",
      "topology.avif",
      "http://cdn.acme.com/m.png",
      "diff-image:bb",
    ]);
  });

  it("names an address on the author's own machine or network, or at no public name", () => {
    const markdown =
      "[a](http://localhost/guide) [b](http://127.0.0.1:9/x) [c](https://x) [d](mailto:a@b) [e](https://[::1]/x) [f](https://wiki.internal/p) [g](https://x.test/p) [h](https://app.vanta.com/c) [i](mailto:security@acme.com?cc=x@localhost) [j](mailto:security@acme.com)";
    const privateNames = ["corp", "lan", "home", "home.arpa", "localdomain", "onion", "alt", "mail", "intranet"].map(
      (top) => `https://wiki.${top}/p`,
    );
    const documentation = "https://docs.example.com/p";
    expect([
      brokenAddresses({ images: new Set(), markdown }),
      brokenAddresses({
        images: new Set(),
        markdown: [...privateNames, documentation].map((url) => `[x](${url})`).join(" "),
      }),
    ]).toEqual([
      [
        "http://localhost/guide",
        "http://127.0.0.1:9/x",
        "https://x",
        "mailto:a@b",
        "https://[::1]/x",
        "https://wiki.internal/p",
        "https://x.test/p",
        "mailto:security@acme.com?cc=x@localhost",
      ],
      [...privateNames, documentation],
    ]);
  });

  it("names a bare address in running text a client would link to nowhere, and leaves a public one, a link and code", () => {
    const markdown = [
      "See https://localhost/x, ftp://files.acme.com/a and https://app.vanta.com/c.",
      "Mail ops@b.corp or security@acme.com; read wiki.corp/sec, factory-module.ts and apps/ops/aop.local.",
      'Not [this](https://localhost/x ) nor [that](https://localhost/y "t"), but `db.internal` and [docs](https://docs.acme.com).',
    ].join(" ");
    expect(bareAddresses({ markdown })).toEqual([
      "https://localhost/x",
      "ftp://files.acme.com/a",
      "https://localhost/y",
      "ops@b.corp",
      "wiki.corp",
    ]);
  });

  it("reads a bare address inside Slack's emphasis as the address it is", () => {
    const markdown =
      "See _https://localhost/admin_, _http://10.0.0.5/admin_, _wiki.corp_, _ops@b.corp_ and _ops@acme.com_.";
    expect(bareAddresses({ markdown })).toEqual([
      "https://localhost/admin",
      "http://10.0.0.5/admin",
      "ops@b.corp",
      "wiki.corp",
    ]);
  });

  it("reads an image's caption, printed as text, and code only within one line", () => {
    const markdown = "See ![https://localhost/admin](https://acme.com/i.png) and `a\nwiki.corp` now.";
    expect([bareAddresses({ markdown }), bareAddresses({ markdown: "Ask `db.internal` first." })]).toEqual([
      ["https://localhost/admin", "wiki.corp"],
      [],
    ]);
  });

  it("reads the halves a wordless link or captionless image joins as the one address the post prints", () => {
    expect([
      bareAddresses({ markdown: "see wiki.[](https://acme.com/)corp" }),
      bareAddresses({ markdown: "see wiki.![](https://acme.com/i.png)corp" }),
      bareAddresses({ markdown: "see wiki.[docs](https://acme.com/)corp" }),
    ]).toEqual([["wiki.corp"], ["wiki.corp"], []]);
  });

  it("reports a bare pull request number no repository resolves, once", () => {
    const linked = linkDocumentMarkdown({ context: CONTEXT, markdown: "PRs #3349 and #3349", phrases: [] });
    expect(linked.unresolved).toEqual(["#3349"]);
  });
});
