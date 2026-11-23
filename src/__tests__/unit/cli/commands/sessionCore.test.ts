/** The `session` noun's flag handling — mirrors `cmuxCore.test.ts` for the sibling noun it was built from. */
import { describe, expect, it } from "vitest";

import {
  numberFlagOr,
  parseSessionArgs,
  SESSION_FLAG_NAMES,
  type SessionVerb,
  sessionUsage,
} from "../../../../cli/commands/session/core.js";
import type { ParsedFlags } from "../../../../cli/parseFlags.js";
import { unwrapErr } from "../../../../lib/result.js";

/** Parse a verb's flags, throwing when the parse fails. */
function flags({ verb, rest }: { verb: SessionVerb; rest: readonly string[] }): ParsedFlags {
  const parsed = parseSessionArgs({ rest, verb });
  if (parsed.isErr()) {
    throw new Error(`expected a clean parse of ${verb} ${rest.join(" ")}, got: ${parsed.error.join("; ")}`);
  }
  return parsed.value;
}

describe("sessionUsage", () => {
  it("advertises the positional tail record and close take, and that list/standing take none", () => {
    expect(sessionUsage({ verb: "record" })).toContain("session record <session-key>");
    expect(sessionUsage({ verb: "close" })).toContain("session close <session-key>");
    expect(sessionUsage({ verb: "list" })).not.toContain("<session-key>");
    expect(sessionUsage({ verb: "standing" })).not.toContain("<session-key>");
  });

  it("renders a value flag with a placeholder and a switch without one", () => {
    expect(sessionUsage({ verb: "record" })).toContain("[--note <value>]");
    expect(sessionUsage({ verb: "list" })).toContain("[--json]");
  });

  it("renders a whole usage line from the verb's real spec", () => {
    expect(sessionUsage({ verb: "record" })).toBe(
      "usage: slopweaver session record <session-key> [--home <value>] [--note <value>]",
    );
    expect(sessionUsage({ verb: "fallbacks" })).toBe("usage: slopweaver session fallbacks [--json]");
  });
});

describe("parseSessionArgs", () => {
  it("keeps the session key as a positional", () => {
    expect(flags({ rest: ["a-doc", "--note", "hi"], verb: "record" }).positionals).toEqual(["a-doc"]);
  });

  it("refuses a flag record does not know", () => {
    expect(unwrapErr(parseSessionArgs({ rest: ["--not-a-real-flag"], verb: "record" }))).toEqual([
      "unknown flag: --not-a-real-flag",
    ]);
  });

  it("refuses list taking a positional-shaped flag it does not know", () => {
    expect(unwrapErr(parseSessionArgs({ rest: ["--note", "x"], verb: "list" }))).toEqual(["unknown flag: --note"]);
  });

  it("publishes each verb's flag names for the help-truth ratchet", () => {
    expect(SESSION_FLAG_NAMES["record"]).toEqual(["--home", "--note"]);
    expect(SESSION_FLAG_NAMES["list"]).toEqual(["--home", "--json"]);
    expect(SESSION_FLAG_NAMES["close"]).toEqual(["--home", "--workspace"]);
    expect(SESSION_FLAG_NAMES["close-done"]).toEqual(["--dir", "--dry-run", "--home", "--json", "--keep-worktrees"]);
    expect(SESSION_FLAG_NAMES["standing"]).toEqual(["--home", "--json", "--loop-session-key"]);
  });
});

describe("numberFlagOr", () => {
  it("answers the documented default when the flag was not passed", () => {
    const parsed = flags({ rest: ["--json"], verb: "depth" });
    expect(numberFlagOr({ fallback: 90, name: "threshold", parsed })).toEqual({ value: 90 });
  });

  it("answers the passed whole number over the default", () => {
    const parsed = flags({ rest: ["--threshold", "7"], verb: "depth" });
    expect(numberFlagOr({ fallback: 90, name: "threshold", parsed })).toEqual({ value: 7 });
  });

  it("refuses a value that is not a whole number rather than answering the default", () => {
    const parsed = flags({ rest: ["--threshold", "x"], verb: "depth" });
    expect(numberFlagOr({ fallback: 90, name: "threshold", parsed })).toEqual({
      error: '--threshold must be a non-negative whole number, got "x"',
    });
  });
});
