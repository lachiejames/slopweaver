/**
 * `slopweaver plans usage` — every registered plan's recorded usage, its reset, and whether it needs a sign-in, read
 * off this machine's own records and nothing else (`../../../plans/planUsageRead.ts`). `--json` is the document the
 * console serves the desktop app's menu bar (`site/lib/liveVerbs.ts`, slug `plan-usage`).
 *
 * Its own shell rather than a branch of `./run.ts`: that file's {@link ./run.PlansDeps} is the register's read and
 * write seams, and none of them is what this verb reads.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";

import { slopweaverHome } from "../../../homeDir.js";
import { productionPlanUsageReadDeps, readPlanUsageReport } from "../../../plans/planUsageRead.js";
import type { PlanUsageReport } from "../../../plans/planUsageTypes.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";

import { VERB_ARG_OFFSET } from "./core.js";
import { PLANS_SPECS, plansUsage } from "./plansUsage.js";
import { planUsageLines } from "./usageLines.js";

/** What `plans usage` was asked for. */
export interface PlansUsageInvocation {
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `plans usage`'s flags.
 *
 * @param rest the argv tail after `plans usage`
 * @returns the invocation, or every flag problem
 */
export function parsePlansUsageArgs({ rest }: { rest: readonly string[] }): Result<PlansUsageInvocation> {
  const parsed = parseFlags({ args: rest, spec: PLANS_SPECS["usage"]! });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { home, json } = parsed.value.values;
  let resolvedHome: string | undefined;
  if (typeof home === "string") {
    resolvedHome = home;
  }
  return ok({ home: resolvedHome, json: json === true });
}

/** What the verb touches outside itself. */
export interface PlansUsageDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The report for `home`, stamped by the reader once its reads have returned. */
  readonly readReport: (request: { readonly home: string | undefined }) => Promise<Result<PlanUsageReport>>;
}

/**
 * Run `plans usage` end to end.
 *
 * @param deps the injected seams
 * @param rest the argv tail after `plans usage`
 * @returns the exit code — `3` when nothing is registered, which is the verb working
 */
export async function runPlansUsage({
  deps,
  rest,
}: {
  deps: PlansUsageDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(plansUsage({ verb: "usage" }));
    return EXIT_OK;
  }
  const parsed = parsePlansUsageArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(plansUsage({ verb: "usage" }));
    return EXIT_USAGE;
  }
  const read = await deps.readReport({ home: parsed.value.home });
  if (read.isErr()) {
    read.error.forEach((problem) => {
      deps.writeDiagnostic(`plans usage: ${problem}`);
    });
    return EXIT_ERROR;
  }
  if (parsed.value.json) {
    deps.writeOut(JSON.stringify(read.value));
  } else {
    planUsageLines({ report: read.value }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  return read.value.rows.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * The home a read resolves against: the flag's, else the ambient one. An `if` that RETURNS rather than an operator,
 * so the substitution is a decision a reader sees (`no-silent-fallback`, as `./run.ts`'s `plansDepsOver`).
 *
 * @param home the `--home` flag's value, when one was passed
 * @returns the home to read
 */
function homeOrAmbient({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * The real seams: the local readers, the wall clock, and the two output channels.
 *
 * @returns the production dependencies for {@link runPlansUsage}
 */
export function productionPlansUsageDeps(): PlansUsageDeps {
  return {
    readReport: ({ home }) =>
      readPlanUsageReport({
        deps: productionPlanUsageReadDeps(),
        home: homeOrAmbient({ home }),
        nowIso: () => new Date().toISOString(),
      }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver plans usage`. */
export const plansUsageCommand = defineCommand({
  run: (argv) => runPlansUsage({ deps: productionPlansUsageDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
