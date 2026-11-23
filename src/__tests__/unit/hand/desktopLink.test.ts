/**
 * A note's console link becomes the desktop app's `slopweaver://open?path=…` address; every other link stays a link.
 */
import { describe, expect, it } from "vitest";

import { desktopLinkFor, desktopLinksFor } from "../../../hand/note/desktopLink.js";

const BASE = "http://localhost:3000";

describe("desktopLinksFor", () => {
  it("maps each console link once and leaves an empty string and a Slack permalink out", () => {
    const urls = [
      `${BASE}/queue`,
      "",
      "https://acme.slack.com/archives/C0FIXTURE/p1",
      `${BASE}/queue`,
      `${BASE}/api/page/brief/index.html`,
    ];
    expect(desktopLinksFor({ consoleBase: BASE, urls })).toStrictEqual({
      [`${BASE}/api/page/brief/index.html`]: "slopweaver://open?path=%2Fapi%2Fpage%2Fbrief%2Findex.html",
      [`${BASE}/queue`]: "slopweaver://open?path=%2Fqueue",
    });
  });

  it("maps a console link the app refuses to null, so the note never hands it to the browser", () => {
    expect(
      desktopLinksFor({
        consoleBase: BASE,
        urls: [`${BASE}/voice`, `${BASE}//evil.example/queue`, "https://acme.example/x"],
      }),
    ).toStrictEqual({ [`${BASE}//evil.example/queue`]: null, [`${BASE}/voice`]: null });
  });

  it("answers an empty map for no links", () => {
    expect(desktopLinksFor({ consoleBase: BASE, urls: [] })).toStrictEqual({});
  });
});

describe("desktopLinkFor", () => {
  it("turns a queue card link into the app's address, the encoded key kept", () => {
    expect(desktopLinkFor({ consoleBase: BASE, url: `${BASE}/queue?open=ask%3Aa-row&context=slopweaver` })).toBe(
      "slopweaver://open?path=%2Fqueue%3Fopen%3Dask%253Aa-row%26context%3Dslopweaver",
    );
  });

  it("turns a published briefing page into the app's address, its fragment kept", () => {
    expect(desktopLinkFor({ consoleBase: BASE, url: `${BASE}/api/page/dead-code-audit/index.html#top` })).toBe(
      "slopweaver://open?path=%2Fapi%2Fpage%2Fdead-code-audit%2Findex.html%23top",
    );
  });

  it("matches the console's own origin under https, and its own non-local origin", () => {
    expect(desktopLinkFor({ consoleBase: "https://console.example", url: "https://console.example/briefing" })).toBe(
      "slopweaver://open?path=%2Fbriefing",
    );
  });

  it("reads 127.0.0.1 and [::1] as the localhost console on the same port", () => {
    expect([
      desktopLinkFor({ consoleBase: BASE, url: "http://127.0.0.1:3000/queue" }),
      desktopLinkFor({ consoleBase: BASE, url: "http://[::1]:3000/queue" }),
    ]).toEqual(["slopweaver://open?path=%2Fqueue", "slopweaver://open?path=%2Fqueue"]);
  });

  it("compares an implicit port as the one dialled", () => {
    expect([
      desktopLinkFor({ consoleBase: "http://localhost", url: "http://127.0.0.1:80/queue" }),
      desktopLinkFor({ consoleBase: "http://localhost", url: "http://127.0.0.1:443/queue" }),
    ]).toEqual(["slopweaver://open?path=%2Fqueue", undefined]);
  });

  it("leaves a link off the console alone: another port, another host, another scheme", () => {
    expect([
      desktopLinkFor({ consoleBase: BASE, url: "http://localhost:5173/queue" }),
      desktopLinkFor({ consoleBase: BASE, url: "https://acme.slack.com/archives/C1/p1" }),
      desktopLinkFor({ consoleBase: BASE, url: "https://localhost:3000/queue" }),
      desktopLinkFor({ consoleBase: BASE, url: "file:///Users/acme/page.html" }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("mints no address for a console link the app would refuse", () => {
    expect([
      desktopLinkFor({ consoleBase: BASE, url: `${BASE}/voice` }),
      desktopLinkFor({ consoleBase: BASE, url: `${BASE}/voice?call=1` }),
      desktopLinkFor({ consoleBase: BASE, url: `${BASE}//evil.example/queue` }),
    ]).toEqual([undefined, undefined, undefined]);
  });

  it("percent-encodes a backslash in the query or fragment, so the app takes the link", () => {
    expect([
      desktopLinkFor({ consoleBase: BASE, url: `${BASE}/queue?q=\\evil` }),
      desktopLinkFor({ consoleBase: BASE, url: `${BASE}/queue#a\\b` }),
    ]).toEqual(["slopweaver://open?path=%2Fqueue%3Fq%3D%255Cevil", "slopweaver://open?path=%2Fqueue%23a%255Cb"]);
  });

  it("leaves an empty or malformed link, or a malformed base, alone", () => {
    expect([
      desktopLinkFor({ consoleBase: BASE, url: "" }),
      desktopLinkFor({ consoleBase: BASE, url: "not a url" }),
      desktopLinkFor({ consoleBase: "nope", url: `${BASE}/queue` }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
