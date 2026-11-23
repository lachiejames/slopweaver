/**
 * A standing ruling gate holds on every path to the verb it rules on, not only when that verb is typed.
 *
 * `src/cli/main.ts` asks the gate before it dispatches, but a verb that calls ANOTHER verb in-process imports
 * that verb's function and calls it directly, so the dispatch boundary never sees the inner verb at all. The scheduled automation drain is the worked case:
 * `automation run-due`'s production edges register a dead-letter row, read a channel and post a card by calling
 * `handover register`, `slack alert-summary` and `slack post` straight.
 *
 * Two halves, and both are needed:
 *
 * - **The witness.** The drain's REAL production `register` edge, over a throwaway home whose projection gates
 *   `handover register`. Before the fix it wrote the row and exited 0; now it is refused and writes nothing.
 * - **The structural guard.** `../../inProcessVerbPaths.ts` reads every in-process path into a verb body off the
 *   TypeScript AST, and every body one reaches must open with `refuseRunnerOnStandingRuling` naming a pair the
 *   registry carries — so a NEW path is held to it the day it is written rather than found by the next audit.
 *   What that scanner does not see is in its own header.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { productionRecipeRunDueDeps } from "../../../cli/commands/automation/rowRunners.js";
import { runHandoverWithdraw } from "../../../cli/commands/handover/withdrawRun.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { NOUN_GROUPS } from "../../../cli/nounGroups.js";
import { standingGatesOf } from "../../../handover/rulingGate.js";
import { writeStandingGates } from "../../../handover/rulingGateStore.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { OpeningGate } from "../../inProcessVerbBodies.js";
import { scanInProcessPaths } from "../../inProcessVerbPaths.js";

const PLACED = "2026-10-18T03:00:00.000Z";

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A throwaway state home with a board directory, whose projection gates one verb. */
function homeGating({ noun, verb }: { noun: string; verb: string }): string {
  const home = mkdtempSync(join(tmpdir(), "sw-inproc-"));
  fixtures.push(home);
  mkdirSync(join(home, "handovers"), { recursive: true });
  const gates = standingGatesOf({
    events: [
      {
        anchor: "talk-call:a0000051-0000-4000-8000-000000000054",
        atIso: PLACED,
        decidedIso: PLACED,
        gate: { subjects: [], verbs: [{ noun, verb }] },
        kind: "ruling",
        ruling: "no new rows on the board today",
      },
    ],
    slug: "a-row",
  });
  unwrap(writeStandingGates({ builtAtIso: PLACED, gates, indexPath: stateHomePaths({ home }).rulingGatesJson }));
  return home;
}

describe("the automation drain's in-process handover register", () => {
  it("is refused by a gate on handover register, and writes no row", async () => {
    const home = homeGating({ noun: "handover", verb: "register" });

    const code = await productionRecipeRunDueDeps().register({
      argv: [
        "--ask",
        "a dead-letter row",
        "--slug",
        "dead-letter-row",
        "--dispatch",
        "--branch",
        "a-branch",
        "--asked-iso",
        PLACED,
        "--home",
        home,
      ],
    });

    expect(code).toBe(EXIT_ERROR);
    expect(existsSync(join(home, "handovers", "dead-letter-row.md"))).toBe(false);
  });
});

describe("the fleet-ceiling delivery's in-process handover withdraw", () => {
  /** A gated home holding one board row, so the verb resolves its slug and reaches its own --why check. */
  function homeWithRow({ verb }: { verb: string }): string {
    const home = homeGating({ noun: "handover", verb });
    writeFileSync(
      join(home, "handovers", "a-row.md"),
      ["---", "slug: a-row", "summary: a row", "status: ready", "---", "", "# A row", ""].join("\n"),
    );
    return home;
  }

  /** `handover withdraw a-row` with no --why: a usage error once it runs, so only a gate answers anything else. */
  const withdrawArgv = ({ home }: { home: string }): readonly string[] => [
    "node",
    "slopweaver",
    "handover",
    "withdraw",
    "a-row",
    "--home",
    home,
  ];

  it("runs the body when another verb is gated — the control", async () => {
    expect(await runHandoverWithdraw(withdrawArgv({ home: homeWithRow({ verb: "close" }) }))).toBe(EXIT_USAGE);
  });

  it("is refused by a gate on handover withdraw before the body runs", async () => {
    expect(await runHandoverWithdraw(withdrawArgv({ home: homeWithRow({ verb: "withdraw" }) }))).toBe(EXIT_ERROR);
  });
});

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const srcRoot = join(repoRoot, "src");

/** Every production `.ts` file under a directory, recursively, skipping the test tree. */
function productionFiles({ dir }: { dir: string }): readonly string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__") {
      continue;
    }
    if (statSync(path).isDirectory()) {
      files.push(...productionFiles({ dir: path }));
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files;
}

/**
 * Whether a gate call names a pair the registry carries. A non-literal verb needs only its noun registered here;
 * the test below pins which bodies may pass one, so a new one is a decision rather than an inheritance. OWN keys
 * only: `in` would accept `slack toString` off `Object.prototype`.
 */
function namesRegisteredVerb({ gate }: { gate: OpeningGate }): boolean {
  if (!Object.hasOwn(NOUN_GROUPS, gate.noun)) {
    return false;
  }
  return gate.verb === null || Object.hasOwn(NOUN_GROUPS[gate.noun]!, gate.verb);
}

describe("every in-process path to a verb body crosses the ruling gate", () => {
  const files = new Map(productionFiles({ dir: srcRoot }).map((path) => [path, readFileSync(path, "utf8")]));
  const scan = scanInProcessPaths({ commandsRoot: join(srcRoot, "cli", "commands"), files });

  it("finds the in-process paths it guards, the automation drain's among them", () => {
    expect(scan.paths.length).toBeGreaterThan(0);
    expect(
      scan.paths
        .filter((path) => relative(repoRoot, path.importer) === "src/cli/commands/automation/rowRunners.ts")
        .map((path) => path.body)
        .toSorted(),
    ).toEqual(["runDatadogAlertDigestWith", "runHandoverRegister", "runSlackAlertSummary", "runSlackWrite"]);
  });

  it("opens every body an in-process path reaches with the gate, naming a registered verb", () => {
    expect(scan.reached.length).toBeGreaterThan(0);

    const ungated = scan.reached
      .filter((body) => body.gate === null || !namesRegisteredVerb({ gate: body.gate }))
      .map((body) => `${relative(repoRoot, body.target)}#${body.body}`)
      .toSorted();

    expect(ungated).toEqual([]);
  });

  it("refuses a pair the registry carries only by inheritance, so an Object.prototype name is no verb", () => {
    expect([
      namesRegisteredVerb({ gate: { noun: "slack", verb: "post" } }),
      namesRegisteredVerb({ gate: { noun: "slack", verb: "toString" } }),
      namesRegisteredVerb({ gate: { noun: "constructor", verb: null } }),
    ]).toEqual([true, false, false]);
  });

  it("lets only slack's shared write body name its verb by expression, and both of its verbs are registered", () => {
    const byExpression = scan.reached
      .filter((body) => body.gate?.verb === null)
      .map((body) => `${relative(repoRoot, body.target)}#${body.body}`);

    expect(byExpression).toEqual(["src/cli/commands/slack/run.ts#runSlackWrite"]);
    expect(Object.keys(NOUN_GROUPS["slack"]!)).toEqual(expect.arrayContaining(["post", "reply"]));
  });
});
