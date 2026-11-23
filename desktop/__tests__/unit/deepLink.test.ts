/**
 * The app's `slopweaver://open?path=…` address: the console page it opens, which tab it opens in, and everything it
 * refuses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DESKTOP_VOICE_LINK, desktopDeepLinkTab } from "../../../src/desktop/deepLink.js";
import { desktopLinkFor } from "../../../src/hand/note/desktopLink.js";
import { DEEP_LINK_SCHEME, deepLinkAction, deepLinkPath, deepLinkTarget } from "../../src/deepLink";

describe("the note and the app agree on the address", () => {
  it("opens, in the app, exactly the page the note's own link names", () => {
    const pages = ["/queue?open=ask%3Aa-row&context=slopweaver", "/api/page/audit/index.html", "/briefing#needs-you"];
    const opened = pages.map((page) => {
      const minted = desktopLinkFor({ consoleBase: "http://localhost:3000", url: `http://localhost:3000${page}` })!;
      return deepLinkPath({ url: minted });
    });
    expect(opened).toEqual(pages);
  });

  it("claims, in the packaged manifest, the one scheme it parses", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
      build: { protocols: { schemes: string[] }[] };
    };
    expect(manifest.build.protocols.flatMap((protocol) => protocol.schemes)).toEqual([DEEP_LINK_SCHEME]);
  });
});

/** The address a note mints for a console path, built the way `src/hand/note/desktopLink.ts` builds it. */
function linkTo({ path }: { path: string }): string {
  const url = new URL("slopweaver://open");
  url.searchParams.set("path", path);
  return url.toString();
}

describe("deepLinkPath", () => {
  it("opens a queue card, its query kept exactly", () => {
    expect(deepLinkPath({ url: linkTo({ path: "/queue?open=ask%3Aa-row&context=slopweaver" }) })).toBe(
      "/queue?open=ask%3Aa-row&context=slopweaver",
    );
  });

  it("opens a published briefing page, which the tab then frames in the viewer", () => {
    expect(deepLinkPath({ url: linkTo({ path: "/api/page/dead-code-audit/index.html" }) })).toBe(
      "/api/page/dead-code-audit/index.html",
    );
  });

  it("keeps a fragment on the page", () => {
    expect(deepLinkPath({ url: linkTo({ path: "/briefing#needs-you" }) })).toBe("/briefing#needs-you");
  });

  it("refuses the overlay's own voice page, with or without a query", () => {
    expect([
      deepLinkPath({ url: linkTo({ path: "/voice" }) }),
      deepLinkPath({ url: linkTo({ path: "/voice?call=1#x" }) }),
    ]).toEqual([undefined, undefined]);
  });

  it("refuses a path off the console: protocol-relative, a full URL, a backslash, a relative path", () => {
    expect([
      deepLinkPath({ url: linkTo({ path: "//evil.example/queue" }) }),
      deepLinkPath({ url: linkTo({ path: "https://evil.example/queue" }) }),
      deepLinkPath({ url: linkTo({ path: "/\\evil.example" }) }),
      deepLinkPath({ url: linkTo({ path: "queue" }) }),
      deepLinkPath({ url: linkTo({ path: "" }) }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses any query but exactly one path", () => {
    expect([
      deepLinkPath({ url: "slopweaver://open" }),
      deepLinkPath({ url: "slopweaver://open?path=%2Fqueue&path=%2Fbriefing" }),
      deepLinkPath({ url: "slopweaver://open?path=%2Fqueue&extra=1" }),
      deepLinkPath({ url: "slopweaver://open?page=%2Fqueue" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses another scheme, another action, or anything on the address beside its query", () => {
    expect([
      deepLinkPath({ url: "http://open?path=%2Fqueue" }),
      deepLinkPath({ url: "slopweaver://close?path=%2Fqueue" }),
      deepLinkPath({ url: "slopweaver://user:pw@open?path=%2Fqueue" }),
      deepLinkPath({ url: "slopweaver://open:9?path=%2Fqueue" }),
      deepLinkPath({ url: "slopweaver://open/x?path=%2Fqueue" }),
      deepLinkPath({ url: "slopweaver://open?path=%2Fqueue#frag" }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("refuses a string that is no URL at all", () => {
    expect(deepLinkPath({ url: "not a url" })).toBe(undefined);
  });
});

describe("deepLinkTarget (one Queue tab, never a duplicate)", () => {
  it("sends the Queue, with any query or hash, to the pinned Queue tab", () => {
    const queue = ["/queue", "/queue?context=slopweaver", "/queue?open=ask%3Ax#top", "/queue#settings/appearance"];
    expect(queue.map((path) => deepLinkTarget({ path }))).toEqual(["pinned", "pinned", "pinned", "pinned"]);
  });

  it("opens every other console page in a new tab, a near-miss of the Queue's path included", () => {
    const others = ["/alignment", "/alignment?open=act%3Ax", "/queue/", "/queuing", "/api/page/x/index.html"];
    expect(others.map((path) => deepLinkTarget({ path }))).toEqual(["new", "new", "new", "new", "new"]);
  });

  it("agrees with the CLI's restatement, so the voice is told the tab the page really opened in", () => {
    const paths = [
      "/queue",
      "/queue?open=ask%3Ax#top",
      "/queue#settings/appearance",
      "/queue/",
      "/queuing",
      "/alignment",
    ];
    expect(paths.map((path) => desktopDeepLinkTab({ path }))).toEqual(paths.map((path) => deepLinkTarget({ path })));
  });

  it("routes the exact address the voice's browser_open minted on that call to the pinned tab", () => {
    const path = deepLinkPath({ url: "slopweaver://open?path=%2Fqueue%3Fcontext%3Dslopweaver" })!;
    expect(deepLinkTarget({ path })).toBe("pinned");
  });
});

describe("deepLinkAction (a launcher's open and voice)", () => {
  it("reads a bare open as the window action, and a bare voice as the voice action", () => {
    expect([deepLinkAction({ url: "slopweaver://open" }), deepLinkAction({ url: "slopweaver://voice" })]).toEqual([
      { kind: "window" },
      { kind: "voice" },
    ]);
  });

  it("reads the address the end-to-end walk's launcher-voice emits as the voice action", () => {
    expect(deepLinkAction({ url: DESKTOP_VOICE_LINK })).toEqual({ kind: "voice" });
  });

  it("still reads an open carrying a path as the page action", () => {
    expect(deepLinkAction({ url: linkTo({ path: "/alignment" }) })).toEqual({ kind: "page", path: "/alignment" });
  });

  it("refuses a launcher address carrying anything beside its action", () => {
    const carrying = [
      "slopweaver://voice?path=%2Fqueue",
      "slopweaver://voice?",
      "slopweaver://voice#x",
      "slopweaver://voice/",
      "slopweaver://voice:9",
      "slopweaver://user@voice",
      "slopweaver://open?",
      "slopweaver://open/",
      "slopweaver://open#x",
    ];
    expect(carrying.map((url) => deepLinkAction({ url }))).toEqual(carrying.map(() => undefined));
  });

  it("refuses another action, another scheme, and an open whose page it would refuse", () => {
    const refused = [
      "slopweaver://call",
      "slopweaver:voice",
      "http://voice",
      linkTo({ path: "/voice" }),
      linkTo({ path: "//evil.example" }),
      "not a url",
    ];
    expect(refused.map((url) => deepLinkAction({ url }))).toEqual(refused.map(() => undefined));
  });
});
