/**
 * The help-flag-opt-out gate's pure core: reading the opt-out register, resolving a verb to the module its
 * manifest loads, following relative imports, spotting a declarative flag spec, and the ratchet comparison.
 *
 * Every case here is a string in, a value out — the IO edge (`runHelpFlagOptOut`) reads the tree and is
 * exercised by running the gate, not by a test that would have to build a repository to do it.
 */
import { describe, expect, it } from "vitest";
import {
  loaderModulesIn,
  localImportsOf,
  nounForManifestFile,
  parsesWithFlagSpec,
  ratchetOf,
  reachableModules,
} from "../../../devLint/helpFlagOptOut.js";
import { optOutsIn, parseBaselineJson } from "../../../devLint/helpFlagOptOutInputs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const REGISTER = [
  "const UNGUARDED: Readonly<Record<string, string>> = {",
  '  ask: "hand-rolled parser; no exported flag spec yet",',
  '  "slack edit": "hand-rolled parser; no exported flag spec yet",',
  '  subset: "bare noun aliases `subset status`, which is guarded",',
  "};",
].join("\n");

describe("reading the opt-out register", () => {
  it("names every address and the reason beside it", () => {
    const optOuts = unwrap(optOutsIn({ source: REGISTER }));

    expect(optOuts).toEqual([
      { address: "ask", reason: "hand-rolled parser; no exported flag spec yet" },
      { address: "slack edit", reason: "hand-rolled parser; no exported flag spec yet" },
      { address: "subset", reason: "bare noun aliases `subset status`, which is guarded" },
    ]);
  });

  it("fails rather than reporting an empty register when the declaration is gone", () => {
    const read = optOutsIn({ source: "const SOMETHING_ELSE = {};" });

    expect(read.isOk()).toBe(false);
    expect(unwrapErr(read).code).toBe("REGISTER_DECLARATION_MISSING");
    expect(unwrapErr(read).message).toBe(
      "src/__tests__/unit/cli/helpTruth.test.ts no longer declares `const UNGUARDED: Readonly<Record<string, string>> = {`",
    );
  });

  it("fails rather than reporting clean when the register is present but empty", () => {
    const read = optOutsIn({ source: "const UNGUARDED: Readonly<Record<string, string>> = {\n};" });

    expect(read.isOk()).toBe(false);
    expect(unwrapErr(read).message).toBe(
      "src/__tests__/unit/cli/helpTruth.test.ts's UNGUARDED register parsed as empty",
    );
  });
});

describe("resolving a verb to the module its manifest loads", () => {
  it("reads an inline import, a named loader, and the default verb's bare-noun address", () => {
    const source = [
      'const loadBrief = () => import("../commands/turn/brief.js").then((m) => m.turnBriefCommand);',
      "export const turnManifest = {",
      "  [DEFAULT_VERB]: lazy({ load: loadBrief, meta: briefMeta }),",
      '  answer: lazy({ load: () => import("../commands/turn/answer.js").then((m) => m.a), meta: answerMeta }),',
      '  "read-thread": lazy({ load: loadBrief, meta: briefMeta }),',
      "};",
    ].join("\n");

    expect([...loaderModulesIn({ noun: "turn", source })]).toEqual([
      ["turn", "src/cli/commands/turn/brief.ts"],
      ["turn answer", "src/cli/commands/turn/answer.ts"],
      ["turn read-thread", "src/cli/commands/turn/brief.ts"],
    ]);
  });

  it("still finds the import when a long comment sits between the key and it", () => {
    const source = [
      "export const vantaManifest = {",
      "  sync: lazy({",
      '    load: () => import("../commands/vanta/syncRun.js").then((m) => m.vantaSyncCommand),',
      "    meta: {",
      `      // ${"a".repeat(400)}`,
      '      usage: "usage: slopweaver atlas vanta sync",',
      "    },",
      "  }),",
      "};",
    ].join("\n");

    expect(loaderModulesIn({ noun: "vanta", source }).get("vanta sync")).toBe("src/cli/commands/vanta/syncRun.ts");
  });

  it("runs the last entry's body to the end of the manifest, so an import after its key is still found", () => {
    const source = [
      "export const turnManifest = {",
      '  answer: lazy({ load: () => import("../commands/turn/answer.js").then((m) => m.a), meta: answerMeta }),',
      "  brief: lazy({",
      "    meta: briefMeta,",
      '    load: () => import("../commands/turn/brief.js").then((m) => m.b),',
      "  }),",
      "};",
    ].join("\n");

    expect([...loaderModulesIn({ noun: "turn", source })]).toEqual([
      ["turn answer", "src/cli/commands/turn/answer.ts"],
      ["turn brief", "src/cli/commands/turn/brief.ts"],
    ]);
  });
});

describe("following relative imports inside the commands tree", () => {
  it("resolves a sibling and a parent import, and drops anything outside the tree", () => {
    const content = [
      'import { parseFlagTail } from "../../optionParsers.js";',
      'import { parseEditArgs } from "./lifecycleCore.js";',
      'import { shared } from "../queryArgs.js";',
      'import { logger } from "../../../lib/logger.js";',
    ].join("\n");

    expect(localImportsOf({ content, path: "src/cli/commands/slack/lifecycleRun.ts" })).toEqual([
      "src/cli/commands/slack/lifecycleCore.ts",
      "src/cli/commands/queryArgs.ts",
    ]);
  });

  it("walks transitively and never revisits a module in an import cycle", () => {
    const tree: Record<string, string> = {
      "src/cli/commands/slack/lifecycleRun.ts": 'import { a } from "./lifecycleCore.js";',
      "src/cli/commands/slack/lifecycleCore.ts": 'import { b } from "./core.js";',
      "src/cli/commands/slack/core.ts": 'import { c } from "./lifecycleRun.js";',
    };

    const walk = reachableModules({
      entry: "src/cli/commands/slack/lifecycleRun.ts",
      readText: ({ path }) => tree[path]!,
    });

    expect(walk.paths).toEqual([
      "src/cli/commands/slack/core.ts",
      "src/cli/commands/slack/lifecycleCore.ts",
      "src/cli/commands/slack/lifecycleRun.ts",
    ]);
    expect(walk.unreadable).toEqual([]);
  });

  // A type-only edge is erased at compile time, so it cannot carry a parser: `dev lint` reached a spec parse
  // through `import type` alone and was reported readable. Each case is the same chain with one edge changed.
  const SPEC_PARSE = 'import { parseFlags } from "../../parseFlags.js";\nparseFlags({ args, spec });';
  const specEvidence = ({ edge }: { edge: string }): readonly string[] => {
    const tree: Record<string, string> = {
      "src/cli/commands/dev/lint.ts": 'import { readLock } from "../github/lapLock.js";',
      "src/cli/commands/github/lapLock.ts": edge,
      "src/cli/commands/github/lapDeps.ts": 'import type { LapStep } from "./core.js";',
      "src/cli/commands/github/core.ts": SPEC_PARSE,
    };
    const walk = reachableModules({ entry: "src/cli/commands/dev/lint.ts", readText: ({ path }) => tree[path]! });
    return walk.paths.filter((path) => parsesWithFlagSpec({ content: tree[path]! }));
  };

  it("reads a verb clean when its only path to a spec parse is whole-statement type imports", () => {
    expect(specEvidence({ edge: 'import type {\n  LapLockHandle,\n  LapResource,\n} from "./lapDeps.js";' })).toEqual(
      [],
    );
  });

  it("still reports the spec parse when one edge in that chain is a value import", () => {
    expect(specEvidence({ edge: 'import { LapErrors } from "./core.js";' })).toEqual([
      "src/cli/commands/github/core.ts",
    ]);
  });

  it("still follows a mixed import that names a type and a value", () => {
    expect(specEvidence({ edge: 'import { type LapStep, lapSteps } from "./core.js";' })).toEqual([
      "src/cli/commands/github/core.ts",
    ]);
  });

  it("skips a type-only re-export but follows a value re-export", () => {
    const content = ['export type { LapStep } from "./lapCore.js";', 'export { lapSteps } from "./lapSteps.js";'].join(
      "\n",
    );
    expect(localImportsOf({ content, path: "src/cli/commands/github/lapDeps.ts" })).toEqual([
      "src/cli/commands/github/lapSteps.ts",
    ]);
  });

  it("reports a module it could not read rather than treating it as spec-free", () => {
    const walk = reachableModules({
      entry: "src/cli/commands/gone/run.ts",
      readText: () => {
        throw new Error("ENOENT");
      },
    });

    expect(walk.unreadable).toEqual(["src/cli/commands/gone/run.ts"]);
  });
});

describe("spotting a declarative flag spec", () => {
  it("sees each of the three parse helpers", () => {
    expect(parsesWithFlagSpec({ content: "parseFlagTail({ rest, spec: EDIT_FLAGS })" })).toBe(true);
    expect(parsesWithFlagSpec({ content: "parseFlags({\n  args,\n  spec,\n})" })).toBe(true);
    expect(parsesWithFlagSpec({ content: "tokenizeFlags({ args, spec })" })).toBe(true);
  });

  it("does not see a hand-rolled scan of argv", () => {
    expect(parsesWithFlagSpec({ content: 'const i = rest.indexOf("--home");' })).toBe(false);
  });
});

describe("the ratchet comparison", () => {
  const offender = { address: "slack edit", evidence: "src/cli/commands/slack/lifecycleCore.ts", reason: "stale" };

  it("reports an offender absent from the committed list", () => {
    const ratchet = ratchetOf({ baseline: ["ask"], offenders: [offender] });

    expect(ratchet.unbaselined).toEqual([offender]);
    expect(ratchet.stale).toEqual(["ask"]);
  });

  it("is clean when the committed list is exactly the offender set", () => {
    const ratchet = ratchetOf({ baseline: ["slack edit"], offenders: [offender] });

    expect(ratchet.unbaselined).toEqual([]);
    expect(ratchet.stale).toEqual([]);
  });
});

describe("the committed baseline file", () => {
  it("reads the offender list", () => {
    expect(unwrap(parseBaselineJson({ text: '{ "offenders": ["ask", "seed"] }' }))).toEqual(["ask", "seed"]);
  });

  it("refuses a file that is not the expected shape", () => {
    const parsed = parseBaselineJson({ text: '{ "offenders": [1] }' });

    expect(parsed.isOk()).toBe(false);
    expect(unwrapErr(parsed).message).toBe('help-flag-optout-baseline.json: expected { "offenders": string[] }');
  });

  it("refuses a file that is not JSON at all", () => {
    const parsed = parseBaselineJson({ text: "not json" });

    expect(parsed.isOk()).toBe(false);
    expect(unwrapErr(parsed).message).toBe("help-flag-optout-baseline.json: invalid JSON");
  });
});

describe("nounForManifestFile", () => {
  it("keeps a manifest that is nobody's split under its own name", () => {
    expect(nounForManifestFile({ file: "slack", manifestFiles: ["atlas", "slack", "github"] })).toBe("slack");
  });

  it("publishes a split-out manifest under the noun whose file it feeds", () => {
    expect(nounForManifestFile({ file: "atlasEstate", manifestFiles: ["atlas", "atlasEstate"] })).toBe("atlas");
  });

  it("takes the LONGEST matching prefix, so a split of a split lands on the nearer parent", () => {
    expect(
      nounForManifestFile({ file: "atlasSlackDrive", manifestFiles: ["atlas", "atlasSlack", "atlasSlackDrive"] }),
    ).toBe("atlasSlack");
  });

  it("never treats a file as its own prefix", () => {
    expect(nounForManifestFile({ file: "atlas", manifestFiles: ["atlas"] })).toBe("atlas");
  });
});
