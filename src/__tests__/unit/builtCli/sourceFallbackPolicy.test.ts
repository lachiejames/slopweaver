/**
 * Which verbs a stale build may hand to the checkout's source: every verb but the declared few that need the built
 * tree itself.
 *
 * The policy reads `argv[2]` and `argv[3]` because the router does, and nowhere else: `resolveNoun`
 * (`src/cli/router.ts`) takes the noun from `argv[2]` and the verb from `argv[3]`, and none of the protected nouns
 * registers a default verb. So an option ahead of the noun, or between noun and verb, is one the policy lets through
 * to source and one the source run's own router then refuses to parse — usage, never the protected verb. The last
 * case below pins that agreement against the REAL registry, so a router that learns to skip a leading option fails
 * here before it can run `desktop install` from source.
 */
import { describe, expect, it } from "vitest";

import { BUILT_TREE_VERBS, sourceFallbackAllowed } from "../../../builtCli/sourceFallbackPolicy.js";
import { NOUN_GROUPS } from "../../../cli/nounGroups.js";
import { resolveNoun } from "../../../cli/router.js";

/** A process argv for one noun and verb, as the built entry receives it. */
function argvOf({ noun, verb }: { noun: string; verb: string }): readonly string[] {
  return ["node", "dist-cli/cli/index.js", noun, verb, "--json"];
}

/**
 * The route dispatch runs for an argv, beside the policy's verdict. `"usage"` is no route: `main` answers every one
 * of those with usage and `EXIT_USAGE` (`src/cli/main.ts`, after `resolveNoun`), never a verb.
 */
function judged({ argv }: { argv: readonly string[] }): { route: string; sourceAllowed: boolean } {
  const route = resolveNoun({ argv, groups: NOUN_GROUPS });
  if (route === null) {
    return { route: "usage", sourceAllowed: sourceFallbackAllowed({ argv }) };
  }
  return { route: `${route.noun} ${route.verb}`, sourceAllowed: sourceFallbackAllowed({ argv }) };
}

describe("sourceFallbackAllowed", () => {
  it("declares exactly the verbs whose contract needs a built tree", () => {
    expect(BUILT_TREE_VERBS).toEqual([
      { noun: "desktop", verb: "install" },
      { noun: "desktop", verb: "update" },
      { noun: "desktop", verb: "e2e" },
      { noun: "talk", verb: "courier" },
      { noun: "supervisor", verb: "tick-capture" },
      { noun: "supervisor", verb: "tick" },
    ]);
  });

  it("refuses the fallback for every declared verb", () => {
    expect(BUILT_TREE_VERBS.map((entry) => sourceFallbackAllowed({ argv: argvOf(entry) }))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("allows it for an ordinary verb, a sibling of a declared one, `dev build`, and no verb at all", () => {
    expect([
      sourceFallbackAllowed({ argv: argvOf({ noun: "github", verb: "push" }) }),
      sourceFallbackAllowed({ argv: argvOf({ noun: "desktop", verb: "prebuild" }) }),
      sourceFallbackAllowed({ argv: argvOf({ noun: "supervisor", verb: "tick-record" }) }),
      sourceFallbackAllowed({ argv: argvOf({ noun: "dev", verb: "build" }) }),
      sourceFallbackAllowed({ argv: ["node", "dist-cli/cli/index.js"] }),
    ]).toEqual([true, true, true, true, true]);
  });

  it("agrees with the router: a protected verb the router would run is refused, and an option shape it lets through the router refuses to parse", () => {
    const shapes = BUILT_TREE_VERBS.map(({ noun, verb }) => [
      judged({ argv: ["node", "e", noun, verb, "--home", "/h"] }),
      judged({ argv: ["node", "e", "--home", "/h", noun, verb] }),
      judged({ argv: ["node", "e", noun, "--home", "/h", verb] }),
    ]);

    expect(shapes).toEqual(
      BUILT_TREE_VERBS.map(({ noun, verb }) => [
        { route: `${noun} ${verb}`, sourceAllowed: false },
        { route: "usage", sourceAllowed: true },
        { route: "usage", sourceAllowed: true },
      ]),
    );
  });
});
