/*
 * The console-origin flags a console server hands `talk transcript` and `talk relay`: every fact the server's, none
 * the page's or the request's, and never a guessed value when one cannot be read.
 */
import { describe, expect, it } from "vitest";

import { consoleOriginArgv } from "../../lib/consoleOrigin";

describe("consoleOriginArgv", () => {
  it("names the checkout, the port the server listens on and the default port", () => {
    expect(
      consoleOriginArgv({ docsSitePort: undefined, listenPort: "3001", root: "/w/seat", cwd: "/w/seat/site" }),
    ).toEqual({
      argv: ["--console-root", "/w/seat", "--console-port", "3001", "--console-default-port", "3000"],
    });
  });

  it("takes the default from DOCS_SITE_PORT", () => {
    expect(
      consoleOriginArgv({ docsSitePort: "4000", listenPort: "4000", root: "/w/main", cwd: "/w/main/site" }),
    ).toEqual({
      argv: ["--console-root", "/w/main", "--console-port", "4000", "--console-default-port", "4000"],
    });
  });

  it.each([
    [
      "no checkout",
      { cwd: "/w/main/site", docsSitePort: undefined, listenPort: "3000", root: undefined },
      "the checkout serving this console could not be found, so where it serves from is unknown",
    ],
    [
      "an ancestor's slopweaver, as a clone nested inside the owner's checkout with none of its own finds",
      { cwd: "/w/main/seat-clone/site", docsSitePort: undefined, listenPort: "3000", root: "/w/main" },
      "the slopweaver found at /w/main is not the checkout this server runs in (/w/main/seat-clone/site)",
    ],
    [
      "an unset PORT",
      { cwd: "/w/main/site", docsSitePort: undefined, listenPort: undefined, root: "/w/main" },
      "PORT is unset, so the port this server listens on is unknown",
    ],
    [
      "a malformed PORT",
      { cwd: "/w/main/site", docsSitePort: undefined, listenPort: "30x0", root: "/w/main" },
      "PORT is 30x0, which is not a port",
    ],
    [
      "a malformed DOCS_SITE_PORT",
      { cwd: "/w/main/site", docsSitePort: "30x0", listenPort: "3000", root: "/w/main" },
      "DOCS_SITE_PORT is 30x0, which is not a port",
    ],
    [
      "an out-of-range DOCS_SITE_PORT",
      { cwd: "/w/main/site", docsSitePort: "0", listenPort: "3000", root: "/w/main" },
      "DOCS_SITE_PORT is 0, which is not a port",
    ],
  ])("refuses %s rather than guessing", (_label, input, refused) => {
    expect(consoleOriginArgv(input)).toEqual({ refused });
  });
});
