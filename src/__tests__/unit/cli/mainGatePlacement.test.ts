/**
 * Where the ruling gate is installed in the dispatch spine — a structural guard, because the property is
 * about ORDER and nothing about a verdict function can express it.
 *
 * `src/cli/router.ts` resolves ONE arm. Every act a resolved route can take — answering `--help` off the
 * registry entry, warning about a stale seat, loading the module, reminding about a governed verb, running
 * the handler — has to sit BELOW the gate, because a gate any one of them could reach first would silently
 * exempt the verbs that take that path, and no test of the verdict would notice: the exempted verbs would
 * simply never ask. So this asserts the call sits between the route resolving and each of those five acts.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const main = readFileSync(join(repoRoot, "src", "cli", "main.ts"), "utf8");

/** Every act a resolved route can take, in the order the spine performs them. */
const ACTS_BELOW_THE_GATE = [
  "wantsHelp({ argv })",
  "maybeWarnStaleSeat({",
  "await nounRoute.entry.load()",
  "maybeRemindGovernedVerb({",
  "return run(argv)",
] as const;

describe("the ruling gate's placement in main.ts", () => {
  it("calls the gate at all", () => {
    expect(main).toContain("refuseOnStandingRuling({");
  });

  it("calls it AFTER the route resolves", () => {
    const resolved = main.indexOf("resolveNoun({ argv, groups: NOUN_GROUPS })");
    const gate = main.indexOf("refuseOnStandingRuling({");

    expect(resolved).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(resolved);
  });

  it("calls it BEFORE every act a resolved route can take", () => {
    const gate = main.indexOf("refuseOnStandingRuling({");
    expect(gate).toBeGreaterThan(0);

    expect(ACTS_BELOW_THE_GATE.length).toBeGreaterThan(0);

    const positions = ACTS_BELOW_THE_GATE.map((act) => ({ act, at: main.indexOf(act) }));

    // A renamed act would read as absent (`-1`) and pass a bare `>` comparison against the gate's own
    // position, so presence is asserted first and separately.
    expect(positions.filter((p) => p.at === -1)).toEqual([]);
    expect(positions.filter((p) => p.at < gate)).toEqual([]);
  });
});
