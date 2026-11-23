/** The `cmux` noun's flag handling — mirrors `fleetCore.test.ts` for the sibling noun it was built from. */
import { describe, expect, it } from "vitest";

import {
  CMUX_FLAG_NAMES,
  type CmuxVerb,
  cmuxUsage,
  parseCmuxArgs,
  repeatedFlag,
  resolveCmuxDriver,
  resolveSpawnEffort,
  SPAWN_EFFORT_LEVELS,
  spawnDispatcher,
  workspaceOperand,
} from "../../../../cli/commands/cmux/core.js";
import type { ParsedFlags } from "../../../../cli/parseFlags.js";
import { unwrapErr } from "../../../../lib/result.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../../supervisor/session.js";

/** Parse a verb's flags, throwing when the parse fails — mirrors `fleetCore.test.ts`'s own helper. */
function flags({ verb, rest }: { verb: CmuxVerb; rest: readonly string[] }): ParsedFlags {
  const parsed = parseCmuxArgs({ rest, verb });
  if (parsed.isErr()) {
    throw new Error(`expected a clean parse of ${verb} ${rest.join(" ")}, got: ${parsed.error.join("; ")}`);
  }
  return parsed.value;
}

describe("cmuxUsage", () => {
  it("advertises the positional tail each verb takes", () => {
    expect(cmuxUsage({ verb: "spawn" })).toContain("cmux spawn <slug>");
    expect(cmuxUsage({ verb: "close" })).toContain("cmux close <workspace>");
  });

  it("renders spawn's value flags with a placeholder", () => {
    const usage = cmuxUsage({ verb: "spawn" });

    expect(usage).toContain("[--dir <value>]");
    expect(usage).toContain("[--driver <value>]");
    expect(usage).toContain("[--effort <value>]");
    expect(usage).toContain("[--home <value>]");
    expect(usage).toContain("[--home <value>]");
  });

  it("renders spawn's --model unbracketed, because it is required", () => {
    const usage = cmuxUsage({ verb: "spawn" });

    expect(usage).toContain(" --model <value> ");
    expect(usage.includes("[--model")).toBe(false);
  });

  it("brackets every flag of a verb that requires none, and leaves no tail when it takes no positional", () => {
    expect(cmuxUsage({ verb: "close" })).toBe(
      "usage: slopweaver cmux close <workspace> [--harness <value>] [--home <value>] [--via-card] [--workspace <value>]",
    );
    expect(cmuxUsage({ verb: "list" })).toBe("usage: slopweaver cmux list [--full] [--harness <value>] [--json]");
  });
});

describe("workspaceOperand", () => {
  it("prefers --workspace over the positional when the verb puts the flag first", () => {
    const parsed = flags({ rest: ["by-position", "--workspace", "by-flag"], verb: "processes" });
    expect(workspaceOperand({ parsed, precedence: "flag" })).toBe("by-flag");
  });

  it("prefers the positional over --workspace when the verb puts the positional first", () => {
    const parsed = flags({ rest: ["by-position", "--workspace", "by-flag"], verb: "close" });
    expect(workspaceOperand({ parsed, precedence: "positional" })).toBe("by-position");
  });

  it("takes whichever one was given when only one was", () => {
    const flagOnly = flags({ rest: ["--workspace", "by-flag"], verb: "close" });
    const positionalOnly = flags({ rest: ["by-position"], verb: "processes" });
    expect(workspaceOperand({ parsed: flagOnly, precedence: "positional" })).toBe("by-flag");
    expect(workspaceOperand({ parsed: positionalOnly, precedence: "flag" })).toBe("by-position");
  });

  it("names no workspace when neither was given", () => {
    expect(workspaceOperand({ parsed: flags({ rest: [], verb: "close" }), precedence: "positional" })).toBe(undefined);
  });
});

describe("spawnDispatcher", () => {
  it("names the session id the environment carries", () => {
    const id = "89e81284-ee20-4e94-8896-6c17a2d10a50";
    expect(spawnDispatcher({ env: { [CLAUDE_CODE_SESSION_ID_ENV]: id } })).toBe(id);
  });

  it("says the dispatcher is unidentified when the environment names no session", () => {
    expect(spawnDispatcher({ env: {} })).toBe("an unidentified session");
  });
});

describe("parseCmuxArgs", () => {
  it("keeps the slug as a positional rather than rejecting it", () => {
    expect(flags({ rest: ["a-doc"], verb: "spawn" }).positionals).toEqual(["a-doc"]);
  });

  it("refuses a flag spawn does not know", () => {
    expect(unwrapErr(parseCmuxArgs({ rest: ["--not-a-real-flag"], verb: "spawn" }))).toEqual([
      "unknown flag: --not-a-real-flag",
    ]);
  });

  it("refuses a flag close does not accept", () => {
    expect(unwrapErr(parseCmuxArgs({ rest: ["--dir", "/tmp"], verb: "close" }))).toEqual(["unknown flag: --dir"]);
  });

  it("lets events repeat its two list filters, which it reads off the raw tail", () => {
    const rest = ["--name", "a", "--name", "b", "--category", "x", "--category", "y"];
    expect(parseCmuxArgs({ rest, verb: "events" }).isOk()).toBe(true);
    expect(repeatedFlag({ name: "name", rest })).toEqual(["a", "b"]);
  });

  it("still refuses a repeated --home on events, which is not a list", () => {
    expect(unwrapErr(parseCmuxArgs({ rest: ["--home", "/a", "--home", "/b"], verb: "events" }))).toEqual([
      "--home was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("publishes each verb's flag names for the help-truth ratchet", () => {
    expect(CMUX_FLAG_NAMES["spawn"]).toEqual([
      "--build",
      "--deps",
      "--dev-build",
      "--dir",
      "--driver",
      "--effort",
      "--force",
      "--full",
      "--harness",
      "--home",
      "--model",
      "--no-dev-build",
      "--no-install",
      "--plan",
      "--require-current-base",
      "--template",
      "--timeout-seconds",
      "--wait",
    ]);
    expect(CMUX_FLAG_NAMES["close"]).toEqual(["--harness", "--home", "--via-card", "--workspace"]);
    expect(CMUX_FLAG_NAMES["list"]).toEqual(["--full", "--harness", "--json"]);
    expect(CMUX_FLAG_NAMES["processes"]).toEqual(["--json", "--workspace"]);
  });

  it("accepts --model as a spawn flag", () => {
    expect(flags({ rest: ["a-doc", "--model", "sonnet"], verb: "spawn" }).values["model"]).toBe("sonnet");
  });

  it("accepts --require-current-base as a spawn switch", () => {
    expect(flags({ rest: ["a-doc", "--require-current-base"], verb: "spawn" }).values["require-current-base"]).toBe(
      true,
    );
  });
});

describe("resolveSpawnEffort", () => {
  it("resolves to nothing at all when --effort is absent, so no key reaches the plan", () => {
    expect(resolveSpawnEffort({ parsed: flags({ rest: ["a-doc"], verb: "spawn" }) })).toEqual({});
  });

  it("accepts every level claude itself advertises", () => {
    expect(SPAWN_EFFORT_LEVELS.length).toBeGreaterThan(0);
    expect(
      SPAWN_EFFORT_LEVELS.map((level) =>
        resolveSpawnEffort({ parsed: flags({ rest: ["a-doc", "--effort", level], verb: "spawn" }) }),
      ),
    ).toEqual(SPAWN_EFFORT_LEVELS.map((level) => ({ effort: level })));
  });

  it("publishes the levels in the order claude's own help prints them", () => {
    expect(SPAWN_EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("names the bad value and the whole accepted set for anything else", () => {
    expect(resolveSpawnEffort({ parsed: flags({ rest: ["a-doc", "--effort", "maximum"], verb: "spawn" }) })).toEqual({
      error: '--effort must be one of low|medium|high|xhigh|max, got "maximum"',
    });
  });

  it("refuses an empty value rather than treating it as unset", () => {
    expect(resolveSpawnEffort({ parsed: flags({ rest: ["a-doc", "--effort", ""], verb: "spawn" }) })).toEqual({
      error: '--effort must be one of low|medium|high|xhigh|max, got ""',
    });
  });
});

describe("resolveCmuxDriver", () => {
  it("takes the register's default when --driver is absent, whichever host that is", () => {
    const parsed = flags({ rest: ["a-doc"], verb: "spawn" });
    expect([
      resolveCmuxDriver({ defaultDriver: "claude", parsed }),
      resolveCmuxDriver({ defaultDriver: "codex", parsed }),
    ]).toEqual([{ driver: "claude" }, { driver: "codex" }]);
  });

  it("lets an explicit --driver win over the register's default, both ways", () => {
    expect([
      resolveCmuxDriver({
        defaultDriver: "claude",
        parsed: flags({ rest: ["a-doc", "--driver", "codex"], verb: "spawn" }),
      }),
      resolveCmuxDriver({
        defaultDriver: "codex",
        parsed: flags({ rest: ["a-doc", "--driver", "claude"], verb: "spawn" }),
      }),
    ]).toEqual([{ driver: "codex" }, { driver: "claude" }]);
  });

  it("names the bad value in the error for anything else", () => {
    expect(
      resolveCmuxDriver({
        defaultDriver: "claude",
        parsed: flags({ rest: ["a-doc", "--driver", "gemini"], verb: "spawn" }),
      }),
    ).toEqual({
      error: '--driver must be one of claude|codex, got "gemini"',
    });
  });
});
