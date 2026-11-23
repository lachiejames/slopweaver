/**
 * The `hex` verbs' shared shell over a recording sink: help is printed to stdout for either spelling and
 * nothing else, a refusal prints every reason then the usage to stderr, and a typed read failure prints its
 * own message and earns exit 3 only when no token is configured. `clientOrExit` is not driven here: it would
 * add a credential edge while its only decision is `exitForHexError`, which is pinned directly.
 */
import { describe, expect, it } from "vitest";

import { askedForHelp, exitForHexError, printRefusal } from "../../../../../cli/commands/hex/shell.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../../../../cli/exitCodes.js";
import { HexReadErrors } from "../../../../../hex/errors.js";

const USAGE = "usage: slopweaver hex projects [--limit <n>] [--json]";

/** A sink recording every stdout and stderr line, tagged by channel, in order. */
function recordingSink(): {
  lines: string[];
  sink: { out: (args: { line: string }) => void; error: (args: { msg: string }) => void };
} {
  const lines: string[] = [];
  return {
    lines,
    sink: {
      error: ({ msg }) => {
        lines.push(`err: ${msg}`);
      },
      out: ({ line }) => {
        lines.push(`out: ${line}`);
      },
    },
  };
}

describe("askedForHelp", () => {
  it.each([["--help"], ["-h"]])("prints the usage to stdout and answers true for %s", (flag) => {
    const { lines, sink } = recordingSink();

    expect(askedForHelp({ rest: ["--limit", "5", flag], sink, usage: USAGE })).toBe(true);
    expect(lines).toEqual([`out: ${USAGE}`]);
  });

  it("answers false and prints nothing for a tail that does not ask for help", () => {
    const { lines, sink } = recordingSink();

    expect(askedForHelp({ rest: ["--limit", "5", "--json"], sink, usage: USAGE })).toBe(false);
    expect(lines).toEqual([]);
  });
});

describe("printRefusal", () => {
  it("prints every reason in order, then the usage, all to stderr", () => {
    const { lines, sink } = recordingSink();

    printRefusal({ reasons: ["unknown flag: --nope", "--limit must be a whole number"], sink, usage: USAGE });

    expect(lines).toEqual(["err: unknown flag: --nope", "err: --limit must be a whole number", `err: ${USAGE}`]);
  });
});

describe("exitForHexError", () => {
  it("earns exit 3 for TOKEN_MISSING and prints the mint line", () => {
    const { lines, sink } = recordingSink();
    const error = HexReadErrors.tokenMissing();

    expect(error.code).toBe("TOKEN_MISSING");
    expect(exitForHexError({ error, sink })).toBe(EXIT_EXPECTED_EMPTY);
    expect(EXIT_EXPECTED_EMPTY).toBe(3);
    expect(lines).toEqual([
      "err: no Hex API token is configured (HEX_API_TOKEN or $SLOPWEAVER_HOME/secrets/hex-api-token). mint a personal API token at app.hex.tech → Settings → API keys (a write in Hex that is the owner's own hand, never a session's), then `slopweaver secrets set hex-api-token`, then `slopweaver hex verify`",
    ]);
  });

  it("earns exit 1 for UNAUTHORIZED and prints the error's own message", () => {
    const { lines, sink } = recordingSink();
    const error = HexReadErrors.unauthorized({ detail: "invalid token", path: "/v1/projects" });

    expect(error.code).toBe("UNAUTHORIZED");
    expect(exitForHexError({ error, sink })).toBe(EXIT_ERROR);
    expect(EXIT_ERROR).toBe(1);
    expect(lines).toEqual([
      "err: /v1/projects returned HTTP 401: invalid token — the token is not accepted; re-mint it and `slopweaver secrets set hex-api-token`",
    ]);
  });
});
