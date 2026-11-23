/**
 * The `dev profile` shell's refusal paths — every one of them decided before a single process is spawned.
 *
 * Deliberately spawn-free. What this verb DOES is run another program, which is the subprocess lane's
 * subject, not a unit test's; what it decides before spawning is pure enough to test here, and it is where
 * every operator mistake lands. The end-to-end witness is the verb run against real gates, recorded in
 * `.baselines/perf-baseline.json` and reproduced with `slopweaver dev profile --gate named-object-params --cpu`.
 */
import { describe, expect, it } from "vitest";
import { runDevProfileWithDeps } from "../../../../../cli/commands/dev/profile.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import type { Logger } from "../../../../../lib/logger.js";

/** A logger that records what the verb printed, by stream. */
function captureLogger(): { log: Pick<Logger, "error" | "info" | "out" | "warn">; out: string[]; errs: string[] } {
  const out: string[] = [];
  const errs: string[] = [];
  return {
    errs,
    log: {
      error: ({ msg }) => {
        errs.push(msg);
      },
      info: ({ msg }) => {
        errs.push(msg);
      },
      out: ({ line }) => {
        out.push(line);
      },
      warn: ({ msg }) => {
        errs.push(msg);
      },
    },
    out,
  };
}

/** `slopweaver dev profile <tail>` — the tail starts at argv index 4. */
const run = ({
  tail,
  log,
}: {
  tail: readonly string[];
  log: Pick<Logger, "error" | "info" | "out" | "warn">;
}): Promise<number> => runDevProfileWithDeps({ argv: ["node", "slopweaver", "dev", "profile", ...tail], log });

describe("runDevProfile", () => {
  it("prints usage on --help", async () => {
    const { log, out } = captureLogger();
    expect(await run({ log, tail: ["--help"] })).toBe(EXIT_OK);
    expect(out[0]).toContain("usage: slopweaver dev profile");
  });

  it("refuses an unknown flag before spawning anything", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--nope"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toBe("unknown flag: --nope");
  });

  it("refuses naming no subject", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: [] })).toBe(EXIT_USAGE);
    expect(errs[0]).toBe("name a subject: --gate <name>, --lane <name>, or --verb -- <argv...>");
  });

  it("refuses two subjects at once", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--gate", "jsdoc-tags", "--lane", "unit"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toBe("name exactly one subject: --gate, --lane and --verb are alternatives");
  });

  it("refuses a bad --top", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--gate", "jsdoc-tags", "--top", "0"] })).toBe(EXIT_USAGE);
    expect(errs[0]).toBe("--top must be a positive integer, got 0");
  });

  it("refuses a gate that is not in the registry, and names the real ones", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--gate", "no-such-gate"] })).toBe(EXIT_ERROR);
    expect(errs[0]).toContain("no gate named no-such-gate; known gates: ");
    expect(errs[0]).toContain("named-object-params");
  });

  it("refuses a lane that is not one of the three", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--lane", "e2e"] })).toBe(EXIT_ERROR);
    expect(errs[0]).toBe("no lane named e2e; known lanes: unit, subprocess, integration");
  });

  it("refuses --verb with nothing after the separator", async () => {
    const { log, errs } = captureLogger();
    expect(await run({ log, tail: ["--verb", "--"] })).toBe(EXIT_ERROR);
    expect(errs[0]).toBe("--verb needs a verb after `--`, e.g. `dev profile --verb -- catalog`");
  });
});
