/*
 * The console-press guard, as a pure function over request headers, and the witness that every console route
 * taking a write verb puts it in front of itself. Measured: a `no-cors` POST from an opaque origin to
 * `/api/sync/landing` would have run, because that one route had never called the guard. The route is read
 * as source rather than imported: this lane does not resolve `next/server`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { refuseUnlessConsolePress } from "../../lib/consolePress";

/** The console's app directory, which every route file sits under. */
const APP_DIR = join(import.meta.dirname, "..", "..", "app");

/** A handler export for a verb that writes, which is what obliges a route to call the guard. */
const WRITE_HANDLER = /export\s+(?:(?:async\s+)?function|const|let)\s+(?:POST|PUT|PATCH|DELETE)\b/u;

/** The guard itself, or a talk-route reader that calls it before anything else (`site/lib/talkCallRequest.ts`). */
const GUARD_CALL = /\b(?:refuseUnlessConsolePress|readCallRequest|readConsoleBody)\(/u;

/**
 * A request carrying exactly the named headers.
 *
 * @returns the POST
 */
function post({ url, headers }: { url: string; headers: Record<string, string> }): Request {
  return new Request(url, { body: "{}", headers, method: "POST" });
}

/** What a same-origin press from the console served on port 3000 carries. */
const PRESS = {
  "content-type": "application/json",
  host: "localhost:3000",
  origin: "http://localhost:3000",
  "sec-fetch-site": "same-origin",
};

/** The opaque-origin request: a `no-cors` POST from a sandboxed page, whose origin serialises as `null`. */
const OPAQUE_NO_CORS = {
  "content-type": "text/plain;charset=UTF-8",
  host: "localhost:3000",
  origin: "null",
  "sec-fetch-site": "cross-site",
};

/**
 * Every `route.ts` under a directory, walked without following anything but directories.
 *
 * @returns the absolute paths
 */
function routeFiles({ dir }: { dir: string }): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles({ dir: path });
    }
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("refuseUnlessConsolePress", () => {
  const url = "http://localhost:3000/api/sync/landing";

  it("passes a same-origin JSON press from this server's own page", () => {
    expect(refuseUnlessConsolePress({ request: post({ headers: PRESS, url }) })).toBe(undefined);
  });

  it("refuses an opaque origin's no-cors POST", () => {
    expect(refuseUnlessConsolePress({ request: post({ headers: OPAQUE_NO_CORS, url }) })).toBe(
      "Origin null is not a URL",
    );
  });

  it("refuses a request with no Origin, a foreign one, or one naming another host", () => {
    const noOrigin = { "content-type": PRESS["content-type"], host: PRESS.host };
    expect(refuseUnlessConsolePress({ request: post({ headers: noOrigin, url }) })).toBe(
      "no Origin header: a press from the console carries one, a navigation or a bare curl does not",
    );
    expect(
      refuseUnlessConsolePress({ request: post({ headers: { ...PRESS, origin: "https://evil.example" }, url }) }),
    ).toBe("Origin https://evil.example is not this machine; the console acts only from the page this server serves");
    expect(
      refuseUnlessConsolePress({ request: post({ headers: { ...PRESS, origin: "http://localhost:4000" }, url }) }),
    ).toBe("Origin http://localhost:4000 does not match the Host this server was reached as (localhost:3000)");
  });

  it("refuses a cross-site fetch and a body that is not JSON", () => {
    expect(
      refuseUnlessConsolePress({ request: post({ headers: { ...PRESS, "sec-fetch-site": "same-site" }, url }) }),
    ).toBe("Sec-Fetch-Site is same-site, not same-origin");
    expect(
      refuseUnlessConsolePress({ request: post({ headers: { ...PRESS, "content-type": "text/plain" }, url }) }),
    ).toBe("the body is not application/json");
  });
});

describe("every console route taking a write verb", () => {
  const writers = routeFiles({ dir: APP_DIR }).filter((path) => WRITE_HANDLER.test(readFileSync(path, "utf8")));

  it("finds the write routes it guards", () => {
    expect(writers.length).toBeGreaterThan(0);
    expect(writers.map((path) => relative(APP_DIR, path))).toContain("api/sync/[verb]/route.ts");
  });

  it("calls the console-press guard", () => {
    const unguarded = writers
      .filter((path) => !GUARD_CALL.test(readFileSync(path, "utf8")))
      .map((path) => relative(APP_DIR, path));
    expect(unguarded).toEqual([]);
  });
});
