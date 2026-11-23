/*
 * A citation chip's words, read off the cited address alone, and a held draft's markers turned into footnotes. A
 * chip that named the wrong source, or a footnote pointing at a citation the draft never declared, is caught here
 * without a browser. Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import {
  anchorReference,
  citedAddress,
  citedSource,
  footnotedMarkdown,
  heldDraftMarkdown,
  opensNowhere,
  referenceHref,
} from "../../lib/citationDisplay";
import { namedSlackPlace } from "../../lib/citationPlaces";

describe("opensNowhere", () => {
  it("is true of a board row, every address naming one and every console address under a retired page, of nothing else", () => {
    expect([
      opensNowhere({ reference: { kind: "board-row", slug: "alpha-beta-gamma" } }),
      opensNowhere({ reference: { kind: "address", url: "/board?row=alpha-beta-gamma" } }),
      opensNowhere({ reference: { kind: "address", url: "http://localhost:3000/board?row=alpha-beta-gamma" } }),
      opensNowhere({ reference: { kind: "address", url: "http://127.0.0.1:3107/workstreams?row=alpha-beta-gamma" } }),
      // The retired pages themselves, whose routes are gone.
      opensNowhere({ reference: { kind: "address", url: "http://localhost:3000/board" } }),
      opensNowhere({ reference: { kind: "address", url: "/machine" } }),
      opensNowhere({ reference: { kind: "address", url: "http://127.0.0.1:3107/machine?tab=agents" } }),
      opensNowhere({ reference: { kind: "address", url: "/queue?open=abc" } }),
      opensNowhere({ reference: { kind: "address", url: "/fleet" } }),
      opensNowhere({ reference: { kind: "address", url: "https://github.com/acme/widgets/pull/12" } }),
      opensNowhere({ reference: { kind: "address", url: "https://example.com/board?row=alpha-beta-gamma" } }),
      opensNowhere({ reference: { kind: "address", url: "https://example.com/machine" } }),
      opensNowhere({ reference: { kind: "queue-card", key: "abc" } }),
    ]).toEqual([true, true, true, true, true, true, true, false, false, false, false, false, false]);
  });

  it("leaves a retired page's address unlinked, never a dead route", () => {
    expect([
      referenceHref({ reference: { kind: "address", url: "/machine" } }),
      referenceHref({ reference: { kind: "address", url: "/fleet" } }),
    ]).toEqual([undefined, "/fleet"]);
  });

  it("leaves an https loopback address under a retired page unlinked, and any other https loopback page linked", () => {
    expect([
      opensNowhere({ reference: { kind: "address", url: "https://localhost:3000/machine" } }),
      opensNowhere({ reference: { kind: "address", url: "https://127.0.0.1/%62oard?row=x" } }),
      opensNowhere({ reference: { kind: "address", url: "https://[::1]:3000/Machine/agents" } }),
      opensNowhere({ reference: { kind: "address", url: "https://localhost./board" } }),
      opensNowhere({ reference: { kind: "address", url: "https://localhost:3000/fleet" } }),
      opensNowhere({ reference: { kind: "address", url: "https://localhost:3000/" } }),
      referenceHref({ reference: { kind: "address", url: "https://localhost:3000/machine" } }),
    ]).toEqual([true, true, true, true, false, false, undefined]);
  });

  it("reads every numeric spelling of the loopback range as the console, IPv4-mapped IPv6 included", () => {
    expect([
      opensNowhere({ reference: { kind: "address", url: "http://[::ffff:127.0.0.1]:3000/board?row=alpha" } }),
      opensNowhere({ reference: { kind: "address", url: "https://[::ffff:127.9.8.7]/machine" } }),
      opensNowhere({ reference: { kind: "address", url: "http://127.1:3000/machine" } }),
      opensNowhere({ reference: { kind: "address", url: "http://0x7f000001:3000/board" } }),
      opensNowhere({ reference: { kind: "address", url: "http://2130706433:3000/machine" } }),
      opensNowhere({ reference: { kind: "address", url: "http://[0:0:0:0:0:0:0:1]:3000/board" } }),
      opensNowhere({ reference: { kind: "address", url: "http://[::ffff:10.0.0.1]:3000/machine" } }),
    ]).toEqual([true, true, true, true, true, true, false]);
  });

  it("reads a retired page behind an encoded leading separator as the router does, after one decode", () => {
    expect([
      opensNowhere({ reference: { kind: "address", url: "/%2Fboard" } }),
      opensNowhere({ reference: { kind: "address", url: "/%2F/machine" } }),
      opensNowhere({ reference: { kind: "address", url: "http://localhost:3000/%5Cboard?row=x" } }),
      opensNowhere({ reference: { kind: "address", url: "/%2Ffleet" } }),
    ]).toEqual([true, true, true, false]);
  });
});

describe("citedAddress", () => {
  it("names a pull request, its diff, an issue and a file by repository and number or path", () => {
    expect([
      citedAddress({ url: "https://github.com/lachiejames/slopweaver/pull/1230" }),
      citedAddress({ url: "https://github.com/lachiejames/slopweaver/pull/1230/files" }).place,
      citedAddress({ url: "https://github.com/lachiejames/slopweaver/issues/7" }).place,
      citedAddress({ url: "https://github.com/lachiejames/slopweaver/blob/main/docs/console.md#talk" }).place,
    ]).toEqual([
      { external: true, kind: "github", place: "lachiejames/slopweaver #1230", source: "GitHub" },
      "lachiejames/slopweaver #1230 · its diff",
      "lachiejames/slopweaver #7",
      "lachiejames/slopweaver · docs/console.md",
    ]);
  });

  it("names a Slack message or channel without the id its archive link carries", () => {
    expect([
      citedAddress({ url: "https://acme.slack.com/archives/C0123ABC/p1788319097879449" }),
      citedAddress({ url: "https://acme.slack.com/archives/C0123ABC" }).place,
    ]).toEqual([{ external: true, kind: "slack", place: "a message", source: "Slack" }, "a channel"]);
  });

  it("names a Slack place by its channel's name when the caller holds it", () => {
    const channels = new Map([["C0123ABC", "#platform-squad"]]);
    expect([
      namedSlackPlace({ channels, href: "https://acme.slack.com/archives/C0123ABC/p1788319097879449" }),
      namedSlackPlace({ channels, href: "https://acme.slack.com/archives/C0123ABC" }),
      namedSlackPlace({ channels, href: "https://acme.slack.com/archives/C0OTHER1/p1788319097879449" }),
      namedSlackPlace({ channels, href: "https://github.com/lachiejames/slopweaver/pull/1230" }),
    ]).toEqual(["a message in #platform-squad", "#platform-squad", undefined, undefined]);
  });

  it("names a Linear issue by its key", () => {
    expect(citedAddress({ url: "https://linear.app/acme/issue/JJJJ-1642/plugin-stack" })).toEqual({
      external: true,
      kind: "linear",
      place: "JJJJ-1642",
      source: "Linear",
    });
  });

  it("keeps a board row and a local page on this machine", () => {
    expect([
      citedAddress({ url: "/board?row=console-archive-ui-port-prs-2-to-9" }),
      citedAddress({ url: "/workstreams?row=console-archive-ui-port-prs-2-to-9" }),
      citedAddress({ url: "file:///Users/x/.slopweaver/pages/console-steer-composer-write-target/index.html" }),
    ]).toEqual([
      { external: false, kind: "board", place: "console-archive-ui-port-prs-2-to-9", source: "the board" },
      { external: false, kind: "board", place: "console-archive-ui-port-prs-2-to-9", source: "the board" },
      { external: false, kind: "page", place: "console-steer-composer-write-target", source: "a local page" },
    ]);
  });

  it("never names a lookalike host as the source it merely ends in", () => {
    expect([
      citedAddress({ url: "https://evilslack.com/archives/C1/p1" }).source,
      citedAddress({ url: "https://notnotion.so/page" }).source,
      citedAddress({ url: "https://acme.slack.com/archives/C1" }).source,
    ]).toEqual(["evilslack.com", "notnotion.so", "Slack"]);
  });

  it("reads a relative path and the console's own localhost origin as this console, and a non-web scheme as a bare address", () => {
    expect([
      citedAddress({ url: "http://localhost:3000/workstreams?row=x" }),
      citedAddress({ url: "https://localhost/workstreams?row=x" }).kind,
      citedAddress({ url: "//example.org/workstreams?row=x" }).kind,
      citedAddress({ url: "mailto:someone@example.org" }),
    ]).toEqual([
      { external: false, kind: "board", place: "x", source: "the board" },
      "web",
      "web",
      { external: true, kind: "web", place: "mailto:someone@example.org", source: "an address" },
    ]);
  });

  it("names a queue card and any other console page apart from a board row, the retired talk page included", () => {
    expect([
      citedAddress({ url: "/queue?open=ask%3Aiso-compliance-violations-bigtask" }),
      citedAddress({ url: "/talk" }),
      citedAddress({ url: "/pull-requests" }),
    ]).toEqual([
      { external: false, kind: "queue", place: "ask:iso-compliance-violations-bigtask", source: "the queue" },
      { external: false, kind: "console", place: "/talk", source: "this console" },
      { external: false, kind: "console", place: "/pull-requests", source: "this console" },
    ]);
  });

  it("names a Vanta control, test and policy by the id its address carries", () => {
    expect([
      citedAddress({ url: "https://app.vanta.com/c/acme/controls/change-management" }),
      citedAddress({ url: "https://app.vanta.com/tests/github-repo-branch-protection" }).place,
      citedAddress({ url: "https://app.vanta.com/c/acme/policies/p-1/edit" }).place,
      citedAddress({ url: "https://app.vanta.com" }).place,
    ]).toEqual([
      { external: true, kind: "vanta", place: "control change-management", source: "Vanta" },
      "test github-repo-branch-protection",
      "policy p-1",
      "Vanta",
    ]);
  });

  it("names a Datadog monitor, a JumpCloud route and a Google file by what the address says", () => {
    expect([
      citedAddress({ url: "https://app.ap1.datadoghq.com/monitors/4412" }),
      citedAddress({ url: "https://ap1.datadoghq.com/logs?query=x" }).place,
      citedAddress({ url: "https://console.jumpcloud.com/#/users/5f1a/details" }),
      citedAddress({ url: "https://console.jumpcloud.com/" }).place,
      citedAddress({ url: "https://docs.google.com/spreadsheets/d/abc/edit" }),
      citedAddress({ url: "https://mail.google.com/mail/u/0/#inbox/FMfc" }).kind,
      citedAddress({ url: "https://fathom.video/share/xyz" }).place,
    ]).toEqual([
      { external: true, kind: "datadog", place: "monitor 4412", source: "Datadog" },
      "the logs view",
      { external: true, kind: "jumpcloud", place: "users 5f1a", source: "JumpCloud" },
      "the JumpCloud console",
      { external: true, kind: "drive", place: "a Google Sheet", source: "Google Drive" },
      "gmail",
      "a recorded call",
    ]);
  });

  it("names an atlas integration with no spelled-out places by its host, in its own colour", () => {
    expect([
      citedAddress({ url: "https://dashboard.workos.com/users" }),
      citedAddress({ url: "https://app.notvanta.com/controls/x" }).kind,
    ]).toEqual([{ external: true, kind: "workos", place: "dashboard.workos.com", source: "WorkOS" }, "web"]);
  });

  it("names any other address by its host, without the www", () => {
    expect(citedAddress({ url: "https://www.example.org/a/b" })).toEqual({
      external: true,
      kind: "web",
      place: "example.org",
      source: "example.org",
    });
  });
});

describe("citedSource", () => {
  it("names a typed board row, queue card and talk turn without parsing a string for them", () => {
    expect([
      citedSource({ reference: { kind: "board-row", slug: "iso-compliance-violations-bigtask" } }),
      citedSource({ reference: { key: "hand:mon-park-1", kind: "queue-card" } }),
      citedSource({ reference: { id: "a0000027", kind: "talk-turn" } }),
      citedSource({ reference: { kind: "address", url: "https://linear.app/acme/issue/III-204" } }).place,
    ]).toEqual([
      { external: false, kind: "board", place: "iso-compliance-violations-bigtask", source: "the board" },
      { external: false, kind: "queue", place: "hand:mon-park-1", source: "the queue" },
      { external: false, kind: "talk", place: "turn a0000027", source: "a talk turn" },
      "III-204",
    ]);
  });
});

describe("referenceHref", () => {
  it("opens an address as itself and a queue card or talk turn on the Queue", () => {
    expect([
      referenceHref({ reference: { kind: "address", url: "https://github.com/a/b/pull/1" } }),
      referenceHref({ reference: { key: "ask:a-row", kind: "queue-card" } }),
      referenceHref({ reference: { id: "a0000027", kind: "talk-turn" } }),
    ]).toEqual(["https://github.com/a/b/pull/1", "/queue?open=ask%3Aa-row", "/queue"]);
  });

  it("opens no board row, by slug or by any address naming one, the older `/workstreams?row=` included", () => {
    expect([
      referenceHref({ reference: { kind: "board-row", slug: "a-row" } }),
      referenceHref({ reference: { kind: "address", url: "/board?row=c-row&view=compact#notes" } }),
      referenceHref({ reference: { kind: "address", url: "/workstreams?row=a-row" } }),
      referenceHref({
        reference: { kind: "address", url: "http://localhost:3000/workstreams?row=b-row&view=x#notes" },
      }),
      referenceHref({ reference: { kind: "address", url: "http://127.0.0.1:3107/board?row=c-row" } }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("leaves every address that names no board row as written", () => {
    expect([
      referenceHref({ reference: { kind: "address", url: "/workstreams" } }),
      referenceHref({ reference: { kind: "address", url: "https://example.com/workstreams?row=d-row" } }),
      referenceHref({ reference: { kind: "address", url: "/workstreams?view=x#row" } }),
      referenceHref({ reference: { kind: "address", url: "http://localhost.example.com/workstreams?row=g-row" } }),
    ]).toEqual([
      "/workstreams",
      "https://example.com/workstreams?row=d-row",
      "/workstreams?view=x#row",
      "http://localhost.example.com/workstreams?row=g-row",
    ]);
  });
});

const SLACK = "https://acme.slack.com/archives/C0123ABC/p1788319097879449";
const PR = "https://github.com/lachiejames/slopweaver/pull/1230";

describe("footnotedMarkdown", () => {
  it("turns each declared marker into a footnote and defines them in number order", () => {
    expect(
      footnotedMarkdown({
        citations: [
          { label: "[2]", url: PR },
          { label: "[1]", url: SLACK },
        ],
        text: "The pool was exhausted [1], and the fix is up [2]. Again [1].",
      }),
    ).toBe(
      [
        "The pool was exhausted [^1], and the fix is up [^2]. Again [^1].",
        "",
        `[^1]: [Slack · a message](<${SLACK}>)`,
        `[^2]: [GitHub · lachiejames/slopweaver #1230](<${PR}>)`,
      ].join("\n"),
    );
  });

  it("leaves a marker no citation declares as the text it was", () => {
    expect(footnotedMarkdown({ citations: [{ label: "[1]", url: PR }], text: "see [3] and [1]" })).toBe(
      `see [3] and [^1]\n\n[^1]: [GitHub · lachiejames/slopweaver #1230](<${PR}>)`,
    );
  });

  it("still shows a citation the text never references, on a closing line of its own", () => {
    expect(
      footnotedMarkdown({
        citations: [
          { label: "[1]", url: SLACK },
          { label: "[2]", url: PR },
        ],
        text: "The pool was exhausted [1].",
      }),
    ).toBe(
      [
        "The pool was exhausted [^1].",
        "",
        `Also cited: [\\[2\\] GitHub · lachiejames/slopweaver #1230](<${PR}>)`,
        "",
        `[^1]: [Slack · a message](<${SLACK}>)`,
      ].join("\n"),
    );
  });

  it("escapes an angle bracket in the address so it cannot end the link", () => {
    expect(footnotedMarkdown({ citations: [{ label: "[1]", url: "https://example.org/a>b" }], text: "[1]" })).toBe(
      "[^1]\n\n[^1]: [example.org · example.org](<https://example.org/a%3Eb>)",
    );
  });

  it("escapes an ampersand and a backslash so Markdown decodes neither", () => {
    const url = "https://example.org/a?b=1&copy=2\\c";
    expect(footnotedMarkdown({ citations: [{ label: "[1]", url }], text: "[1]" }).split("\n")[2]).toBe(
      "[^1]: [example.org · example.org](<https://example.org/a?b=1\\&copy=2\\\\c>)",
    );
  });

  it("is the text unchanged when nothing is cited", () => {
    expect(footnotedMarkdown({ citations: [], text: "an array index [0]" })).toBe("an array index [0]");
  });

  it("escapes a bracket in the words so the link text cannot close early", () => {
    const url = "https://github.com/a/b/blob/main/app/[id]/page.tsx";
    expect(footnotedMarkdown({ citations: [{ label: "[1]", url }], text: "[1]" }).split("\n")[2]).toBe(
      `[^1]: [GitHub · a/b · app/\\[id\\]/page.tsx](<${url}>)`,
    );
  });

  it("points a local page's footnote at the console's page route, naming the page", () => {
    const url = "file:///Users/x/.slopweaver/pages/console-pages-and-workstreams/index.html";
    expect(footnotedMarkdown({ citations: [{ label: "[1]", url }], text: "[1]" }).split("\n")[2]).toBe(
      "[^1]: [a local page · console-pages-and-workstreams](</api/page/console-pages-and-workstreams/index.html>)",
    );
  });

  it("draws a footnote to a retired page or a board row as words, never a link", () => {
    const definitions = [
      "/machine",
      "http://localhost:3000/board?row=alpha-beta",
      "http://localhost:3000/%62oard/notes",
      "/%6Dachine/agents",
      "/Machine",
      "http://[::1]:3000/machine",
      "http://localhost.:3000/board",
      "http://127.0.0.2:3000/machine",
      "/machine%2Fagents",
      "/board%5Cnotes",
      "/fleet",
      "/fleet%2Fmachine",
    ].map((url) => footnotedMarkdown({ citations: [{ label: "[1]", url }], text: "[1]" }).split("\n")[2]);
    expect(definitions.map((line) => line.includes("](<"))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });
});

describe("heldDraftMarkdown", () => {
  it("reads a held reply's standard shortcodes as their emoji, then footnotes it", () => {
    expect(
      heldDraftMarkdown({ citations: [{ label: "[1]", url: PR }], text: "ship :tada: [1] :+1::skin-tone-3:" }),
    ).toBe(`ship 🎉 [^1] 👍🏼\n\n[^1]: [GitHub · lachiejames/slopweaver #1230](<${PR}>)`);
  });

  it("leaves a custom emoji, code and a web address in a held reply exactly as written", () => {
    const text = ":partyparrot: `:tada:` https://example.com/a:tada:b";
    expect(heldDraftMarkdown({ citations: [], text })).toBe(text);
  });
});

describe("anchorReference", () => {
  it("reads an address, a console route and a talk turn, and nothing else", () => {
    expect([
      anchorReference({ anchor: " https://acme.slack.com/archives/C1/p2 " }),
      anchorReference({ anchor: "http://localhost:3000/queue?open=ask%3Ax" }),
      anchorReference({ anchor: "talk:a0000027-0000-4000-8000-000000000030" }),
      anchorReference({ anchor: "transcript:abc#def" }),
      anchorReference({ anchor: "http://example.com/x" }),
      anchorReference({ anchor: "said in the earlier call" }),
    ]).toEqual([
      { kind: "address", url: "https://acme.slack.com/archives/C1/p2" },
      { kind: "address", url: "http://localhost:3000/queue?open=ask%3Ax" },
      { id: "a0000027-0000-4000-8000-000000000030", kind: "talk-turn" },
      undefined,
      undefined,
      undefined,
    ]);
  });
});
