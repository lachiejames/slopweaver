import { describe, expect, it } from "vitest";
import { CONSOLE_READ_HEADER, CONSOLE_READ_VALUE, refuseUnlessConsoleRead } from "../../lib/consoleRead";

const CHANNEL_URL = "http://localhost:3000/api/slack-channel?channel=C0ONE&workspace=acme.slack.com";

/** The console's own read, as its window sends it, before a test changes one header. */
const OWN = { [CONSOLE_READ_HEADER]: CONSOLE_READ_VALUE, host: "localhost:3000", "sec-fetch-site": "same-origin" };

/** A GET to the channel route carrying exactly `headers`. */
function get({ headers }: { headers: Record<string, string> }): Request {
  return new Request(CHANNEL_URL, { headers, method: "GET" });
}

/** `OWN` with `drop` removed. */
function without({ drop }: { drop: string }): Record<string, string> {
  return Object.fromEntries(Object.entries(OWN).filter(([name]) => name !== drop));
}

describe("refuseUnlessConsoleRead", () => {
  it("lets the console's own same-origin read through, on every loopback name", () => {
    expect(
      ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST", "localhost"].map((host) =>
        refuseUnlessConsoleRead({ request: get({ headers: { ...OWN, host } }) }),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("lets the console's read through when the browser sends no fetch metadata", () => {
    expect(refuseUnlessConsoleRead({ request: get({ headers: without({ drop: "sec-fetch-site" }) }) })).toBe(undefined);
  });

  it("refuses a page on another name that DNS-rebinds to this machine, though it is same-origin with itself", () => {
    expect(
      ["evil.example:3000", "localhost.evil.example:3000", "[::2]:3000"].map((host) =>
        refuseUnlessConsoleRead({ request: get({ headers: { ...OWN, host } }) }),
      ),
    ).toEqual([
      "Host evil.example:3000 is not this machine. The console reads only for the page this server serves",
      "Host localhost.evil.example:3000 is not this machine. The console reads only for the page this server serves",
      "Host [::2]:3000 is not this machine. The console reads only for the page this server serves",
    ]);
  });

  it("refuses a request that names no Host at all", () => {
    expect(refuseUnlessConsoleRead({ request: get({ headers: without({ drop: "host" }) }) })).toBe("no Host header");
  });

  it("refuses a GET without the console's header, which is all a tag or a link on another site can send", () => {
    expect(refuseUnlessConsoleRead({ request: get({ headers: without({ drop: CONSOLE_READ_HEADER }) }) })).toBe(
      "no x-slopweaver-console-read header. The console's own window sends one, a page on another site cannot",
    );
  });

  it("refuses the header with any other value", () => {
    expect(refuseUnlessConsoleRead({ request: get({ headers: { ...OWN, [CONSOLE_READ_HEADER]: "yes" } }) })).toBe(
      "no x-slopweaver-console-read header. The console's own window sends one, a page on another site cannot",
    );
  });

  it("refuses a cross-site or same-site read even carrying the header", () => {
    expect(
      ["cross-site", "same-site", "none"].map((site) =>
        refuseUnlessConsoleRead({ request: get({ headers: { ...OWN, "sec-fetch-site": site } }) }),
      ),
    ).toEqual([
      "Sec-Fetch-Site is cross-site, not same-origin",
      "Sec-Fetch-Site is same-site, not same-origin",
      "Sec-Fetch-Site is none, not same-origin",
    ]);
  });
});
