/**
 * Where the console is, read off `scripts/docs-site.sh`'s own output, and the PATH a Finder-opened app runs
 * that script under.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { checkoutArgument, childEnv, childPathEnv, dropCmuxEnv, parseConsoleEndpoint } from "../../src/consoleEndpoint";

describe("parseConsoleEndpoint", () => {
  it("reads the address --status prints for a live server", () => {
    const result = parseConsoleEndpoint({ output: "docs-site: http://localhost:3000 — pid 4412 (production)\n" });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toBe("http://localhost:3000");
  });

  it("reads one address printed twice as one", () => {
    const result = parseConsoleEndpoint({
      output: "serving http://localhost:3001\nopen http://localhost:3001/queue\n",
    });
    expect(unwrap(result)).toBe("http://localhost:3001");
  });

  it("refuses output with no address, naming its last line", () => {
    const error = unwrapErr(parseConsoleEndpoint({ output: "docs-site: not running\n\n" }));
    expect(error.code).toBe("NO_ENDPOINT");
    expect(error.message).toBe("the console is not serving: docs-site: not running");
  });

  it("refuses empty output", () => {
    expect(unwrapErr(parseConsoleEndpoint({ output: "" })).message).toBe("the console is not serving: no output");
  });

  it("refuses two different addresses rather than picking one", () => {
    const error = unwrapErr(parseConsoleEndpoint({ output: "http://localhost:3000 and http://localhost:3005" }));
    expect(error.code).toBe("CONFLICTING_ENDPOINTS");
    expect(error.message).toBe(
      "the console script named 2 different addresses (http://localhost:3000, http://localhost:3005)",
    );
  });

  it("refuses a port outside the valid range and a six-digit run", () => {
    expect(unwrapErr(parseConsoleEndpoint({ output: "http://localhost:0" })).code).toBe("NO_ENDPOINT");
    expect(unwrapErr(parseConsoleEndpoint({ output: "http://localhost:70000" })).code).toBe("NO_ENDPOINT");
    expect(unwrapErr(parseConsoleEndpoint({ output: "http://localhost:300000" })).code).toBe("NO_ENDPOINT");
  });

  it("ignores an address on another host", () => {
    expect(unwrapErr(parseConsoleEndpoint({ output: "http://example.com:3000" })).code).toBe("NO_ENDPOINT");
  });
});

describe("checkoutArgument", () => {
  it("reads both spellings", () => {
    expect(checkoutArgument({ argv: ["electron", ".", "--checkout", "/src/sw"] })).toBe("/src/sw");
    expect(checkoutArgument({ argv: ["Slopweaver", "--checkout=/src/sw"] })).toBe("/src/sw");
  });

  it("is undefined when none is passed or the flag has no value", () => {
    expect(checkoutArgument({ argv: ["Slopweaver"] })).toBe(undefined);
    expect(checkoutArgument({ argv: ["Slopweaver", "--checkout"] })).toBe(undefined);
  });
});

describe("childPathEnv", () => {
  it("leads with proto and Homebrew under launchd's bare PATH", () => {
    expect(childPathEnv({ home: "/Users/h", inherited: "/usr/bin:/bin:/usr/sbin:/sbin" })).toBe(
      "/Users/h/.proto/shims:/Users/h/.proto/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  it("keeps a terminal's own entries between the lead and the system directories, once each", () => {
    expect(
      childPathEnv({ home: "/Users/h", inherited: "/opt/homebrew/bin:/Users/h/bin::/usr/bin:/Users/h/.cargo/bin" }),
    ).toBe(
      "/Users/h/.proto/shims:/Users/h/.proto/bin:/opt/homebrew/bin:/usr/local/bin:/Users/h/bin:/Users/h/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  it("builds a working PATH when none was given at all", () => {
    expect(childPathEnv({ home: "/Users/h", inherited: undefined })).toBe(
      "/Users/h/.proto/shims:/Users/h/.proto/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });
});

describe("dropCmuxEnv", () => {
  it("drops every CMUX_ key in place and keeps the rest", () => {
    const env: Record<string, string | undefined> = {
      CMUX_SOCKET_PATH: "/tmp/cmux.sock",
      CMUX_WORKSPACE_ID: "seat",
      HOME: "/Users/h",
      NOT_CMUX_X: "kept",
    };
    dropCmuxEnv({ env });
    expect(env).toEqual({ HOME: "/Users/h", NOT_CMUX_X: "kept" });
  });
});

describe("childEnv", () => {
  it("drops every CMUX_ key an app reopened from a seat inherited, and keeps the rest", () => {
    expect(
      childEnv({
        home: "/Users/h",
        inherited: {
          CMUX_SOCKET_PATH: "/Users/h/.local/state/cmux/cmux-501.sock",
          CMUX_WORKSPACE_ID: "6038BFD6",
          HOME: "/Users/h",
          PATH: "/usr/bin",
          XCMUX_KEEP: "kept",
        },
      }),
    ).toEqual({
      HOME: "/Users/h",
      PATH: "/Users/h/.proto/shims:/Users/h/.proto/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      XCMUX_KEEP: "kept",
    });
  });
});
