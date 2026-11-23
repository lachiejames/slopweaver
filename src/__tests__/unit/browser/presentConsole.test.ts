/**
 * `resolveConsoleTarget` directly: the refusal factory's message per cause, and the three shapes a verdict takes —
 * off the console, a page with its deep link, a refusal built by the same factory the module calls. The wider table
 * of API and viewer spellings runs through `resolvePresentTarget` in `./present.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { type ConsolePathCause, ConsolePathErrors, resolveConsoleTarget } from "../../../browser/presentConsole.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CONSOLE = "http://localhost:3000";

/** A verdict on one address against the console, with `prep` the one published page. */
const verdict = ({ url }: { url: string }): ReturnType<typeof resolveConsoleTarget> =>
  resolveConsoleTarget({ consoleBase: CONSOLE, pagePublished: (slug) => slug === "prep", url: new URL(url) });

describe("ConsolePathErrors.refused", () => {
  it.each<[ConsolePathCause, string]>([
    [
      "API_PATH",
      "/api/live/depth is the console's API, not a page — present opens console pages; a published page opens with --page <slug>",
    ],
    [
      "DESKTOP_PATH",
      "/api/live/depth is a path the desktop app does not open in a tab (the voice overlay, or one naming another host)",
    ],
    ["INTERNAL_PATH", "/api/live/depth is the console framework's own machinery (a path under /_), not a page"],
    ["MALFORMED_PATH", "/api/live/depth does not decode, so where it routes cannot be judged"],
    [
      "PAGE_NOT_PUBLISHED",
      "/api/live/depth names a page this home has not published — `slopweaver page publish` writes one",
    ],
    ["VIEW_API_PATH", "/api/live/depth is the in-app viewer framing the console's API, which present will not open"],
  ])("words %s as one sentence naming the path", (cause, message) => {
    expect(ConsolePathErrors.refused({ cause, path: "/api/live/depth" })).toEqual({
      cause,
      code: "CONSOLE_PATH_REFUSED",
      message,
      path: "/api/live/depth",
    });
  });
});

describe("resolveConsoleTarget", () => {
  it("leaves an address off the console to the caller", () => {
    expect(unwrap(verdict({ url: "https://github.com/acme/widgets/pull/1" }))).toBe(undefined);
  });

  it("leaves a console base off loopback to the caller, so a remote origin meets the register", () => {
    const remote = resolveConsoleTarget({
      consoleBase: "https://console.example",
      pagePublished: () => true,
      url: new URL("https://console.example/queue"),
    });
    expect(unwrap(remote)).toBe(undefined);
  });

  it("opens a 127.0.0.1 console base's page as its deep link", () => {
    const loopback = resolveConsoleTarget({
      consoleBase: "http://127.0.0.1:3000",
      pagePublished: () => true,
      url: new URL("http://127.0.0.1:3000/queue"),
    });
    expect(unwrap(loopback)).toEqual({ deepLink: "slopweaver://open?path=%2Fqueue", path: "/queue" });
  });

  it("opens the Settings address once refused, as its deep link", () => {
    expect(unwrap(verdict({ url: "http://localhost:3000/queue#settings/appearance" }))).toEqual({
      deepLink: "slopweaver://open?path=%2Fqueue%23settings%2Fappearance",
      path: "/queue#settings/appearance",
    });
  });

  it("refuses the API with the factory's own error", () => {
    expect(unwrapErr(verdict({ url: "http://localhost:3000/api/live/depth" }))).toEqual(
      ConsolePathErrors.refused({ cause: "API_PATH", path: "/api/live/depth" }),
    );
  });

  it("refuses an unpublished page's document, and opens the published one", () => {
    expect(unwrapErr(verdict({ url: "http://localhost:3000/api/page/other/index.html" }))).toEqual(
      ConsolePathErrors.refused({ cause: "PAGE_NOT_PUBLISHED", path: "/api/page/other/index.html" }),
    );
    expect(unwrap(verdict({ url: "http://localhost:3000/api/page/prep/index.html" }))).toEqual({
      deepLink: "slopweaver://open?path=%2Fapi%2Fpage%2Fprep%2Findex.html",
      path: "/api/page/prep/index.html",
    });
  });

  it("judges the address it opens, even when the object's pathname says otherwise", () => {
    const url = new URL("http://localhost:3000/api/live/depth");
    Object.defineProperty(url, "pathname", { value: "/queue" });
    expect(unwrapErr(resolveConsoleTarget({ consoleBase: CONSOLE, pagePublished: () => false, url }))).toEqual(
      ConsolePathErrors.refused({ cause: "API_PATH", path: "/api/live/depth" }),
    );
  });

  it.each<[string, ConsolePathCause]>([
    ["http://localhost:3000/queue%3F/..%2Fapi/live/depth", "API_PATH"],
    ["http://localhost:3000/queue%23/..%2Fapi/live/depth", "API_PATH"],
    ["http://localhost:3000/view?src=/queue%253F/..%252Fapi/live/depth", "VIEW_API_PATH"],
  ])("refuses %s, an encoded ? or # that would hide a dot segment into the API", (url, cause) => {
    expect(unwrapErr(verdict({ url })).cause).toBe(cause);
  });

  it("opens a page whose own path carries an encoded ?, judged as the literal character", () => {
    expect(unwrap(verdict({ url: "http://localhost:3000/queue%3F" }))).toEqual({
      deepLink: "slopweaver://open?path=%2Fqueue%253F",
      path: "/queue%3F",
    });
  });

  it("refuses the viewer framing the API, with the viewer's own cause", () => {
    expect(unwrapErr(verdict({ url: "http://localhost:3000/view?src=/api/live/depth" }))).toEqual(
      ConsolePathErrors.refused({ cause: "VIEW_API_PATH", path: "/view?src=/api/live/depth" }),
    );
  });
});
