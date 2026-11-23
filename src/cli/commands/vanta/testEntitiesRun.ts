/**
 * `slopweaver atlas vanta test-entities --status FAILING|DEACTIVATED [--test <id>]` — the live read of which
 * resources a Vanta test fails on or has had deactivated, with the reason recorded against each. Named with
 * `--test` it reads that one test; without it, it sweeps every test the stored `test` kind holds, one at a
 * time, and names each one it could not read. `testEntitiesCore.ts` carries what a zero here does and does
 * not prove.
 *
 * ## The exit-code contract
 *
 * | situation                                                          | code |
 * | ------------------------------------------------------------------ | ---- |
 * | a bad flag                                                         | `2`  |
 * | credentials not configured, or no stored test list to sweep        | `3`  |
 * | the stored list or the credentials could not be read               | `1`  |
 * | any test could not be read (the rest is still printed)             | `1`  |
 * | every test asked for was read, entities or not                     | `0`  |
 */
import { createVantaManageClient, type VantaTestEntityClient } from "../../../atlas/vanta/client.js";
import {
  isVantaCredentialUnset,
  type VantaCredentialError,
  vantaCredentialErrorsLines,
} from "../../../atlas/vanta/credentialErrors.js";
import { readVantaKindFile, vantaAtlasPaths } from "../../../atlas/vanta/store.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { bindVanta } from "./binding.js";
import {
  exitCodeForVantaTestEntitySweep,
  parseVantaTestEntitiesOptions,
  renderVantaTestEntitySweep,
  sweepPlanFromKindFile,
  type VantaSweepPlan,
  type VantaSweepTarget,
  type VantaTestEntitiesOptions,
  type VantaTestEntitySweep,
  type VantaTestRead,
  vantaTestEntitySweepDocument,
} from "./testEntitiesCore.js";

/** Where a Vanta verb sits: past the runtime, the script, the `atlas` noun and the `vanta` platform. */
const VANTA_VERB_INDEX = 4;

/** The one copy. The manifest row names the platform's verbs; each verb's own usage lives with the verb. */
export const VANTA_TEST_ENTITIES_USAGE =
  "usage: slopweaver atlas vanta test-entities --status FAILING|DEACTIVATED [--test <id>] [--limit <n>]\n" +
  "       [--json] [--home <dir>] [--client-id-file <path> --client-secret-file <path>]\n" +
  "  Reads which resources a Vanta test fails on, or has had deactivated, LIVE — with the reason Vanta\n" +
  "  recorded against each deactivated one\n" +
  "  --status     Vanta's entityStatus filter; required, because Vanta answers FAILING when it is absent\n" +
  "  --test       read one test; omit it to sweep every test in the stored test list (atlas vanta sync)\n" +
  "  --limit      the most entity rows printed (default 200); the counts always cover every row read\n" +
  "  The API records no author or date for a deactivation: lastUpdatedDate is the last change of any kind";

/**
 * The one seam this verb injects: how a bound entity client is obtained, so the sweep's coverage and exit
 * grading are testable at the command boundary without a mock.
 *
 * @internal
 */
export interface VantaTestEntitiesDeps {
  /** Bind credentials and build the client, or report every typed reason it could not be built. */
  readonly createClient: (input: {
    options: VantaTestEntitiesOptions;
  }) => Result<VantaTestEntityClient, readonly VantaCredentialError[]>;
}

/** The production seam: resolve the credential pair the usual way and build the real HTTP client. */
const PRODUCTION_DEPS: VantaTestEntitiesDeps = {
  createClient: ({ options }) =>
    bindVanta({
      clientIdFile: options.clientIdFile,
      clientSecretFile: options.clientSecretFile,
      env: process.env,
      home: options.home,
    }).map((binding) => createVantaManageClient(binding)),
};

/** The stored test list a sweep walks — or that there is none, which is expected, or that it is unreadable, which is not. */
type StoredPlan =
  | { readonly kind: "plan"; readonly plan: VantaSweepPlan }
  | { readonly kind: "empty"; readonly problems: readonly string[] }
  | { readonly kind: "unreadable"; readonly problems: readonly string[] };

/** Read the stored test list a sweep walks. */
function storedPlan({ home }: { home: string }): StoredPlan {
  const file = readVantaKindFile({ kind: "test", paths: vantaAtlasPaths({ home }) });
  if (file.isErr()) {
    return { kind: "unreadable", problems: file.error };
  }
  if (file.value === null) {
    return {
      kind: "empty",
      problems: [
        "no stored Vanta test list to sweep — run `slopweaver atlas vanta sync` first, or name one test with --test",
      ],
    };
  }
  const plan = sweepPlanFromKindFile({ file: file.value });
  if (plan.targets.length === 0) {
    return {
      kind: "empty",
      problems: [
        `the stored Vanta test list (stored ${plan.storedAt}) holds no test the last sync observed — ` +
          "re-sync with `slopweaver atlas vanta sync`, or name one test with --test",
      ],
    };
  }
  return { kind: "plan", plan };
}

/** Read every target in turn — sequential, so one sweep never bursts past Vanta's rate limit. */
async function readTargets({
  client,
  status,
  targets,
}: {
  client: VantaTestEntityClient;
  status: VantaTestEntitiesOptions["status"];
  targets: readonly VantaSweepTarget[];
}): Promise<readonly VantaTestRead[]> {
  const reads: VantaTestRead[] = [];
  for (const target of targets) {
    const listed = await client.listTestEntities({ entityStatus: status, testId: target.testId });
    reads.push(
      listed.isOk()
        ? { entities: listed.value, kind: "read", target }
        : { kind: "failed", reasons: listed.error, target },
    );
  }
  return reads;
}

/** Print the finished read in whichever form the caller asked for. */
function printSweep({ options, sweep }: { options: VantaTestEntitiesOptions; sweep: VantaTestEntitySweep }): void {
  if (options.json) {
    logger.out({ line: JSON.stringify(vantaTestEntitySweepDocument({ limit: options.limit, sweep }), null, 2) });
    return;
  }
  for (const line of renderVantaTestEntitySweep({ limit: options.limit, sweep })) {
    logger.out({ line });
  }
}

/** Report every line of a refusal on stderr. */
function reportProblems({ problems }: { problems: readonly string[] }): void {
  problems.forEach((problem) => {
    logger.error({ msg: problem });
  });
}

/**
 * Run the `vanta test-entities` verb against an injected provider seam.
 *
 * @param argv the full process argv
 * @param deps how the entity client is obtained
 * @returns the process exit code
 * @internal
 */
export async function runVantaTestEntitiesWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: VantaTestEntitiesDeps;
}): Promise<number> {
  const rest = verbTail({ argv, at: VANTA_VERB_INDEX, verbs: ["test-entities"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: VANTA_TEST_ENTITIES_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVantaTestEntitiesOptions({ defaultHome: slopweaverHome(), rest });
  if (parsed.isErr()) {
    reportProblems({ problems: parsed.error });
    logger.error({ msg: VANTA_TEST_ENTITIES_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  let plan: VantaSweepPlan | null = null;
  let targets: readonly VantaSweepTarget[] = [];
  if (options.testId === null) {
    const stored = storedPlan({ home: options.home });
    if (stored.kind !== "plan") {
      reportProblems({ problems: stored.problems });
      return stored.kind === "empty" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
    }
    plan = stored.plan;
    targets = plan.targets;
  } else {
    targets = [{ testId: options.testId, testName: null }];
  }

  const bound = deps.createClient({ options });
  if (bound.isErr()) {
    reportProblems({ problems: vantaCredentialErrorsLines({ errors: bound.error }) });
    // A credential that is simply absent is an expected empty, as `vanta vulnerabilities` grades it; any
    // other binding failure is a broken run. Graded by code, never by the sentence a factory wrote.
    return bound.error.some((error) => isVantaCredentialUnset({ error })) ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  const reads = await readTargets({ client: bound.value, status: options.status, targets });
  const sweep: VantaTestEntitySweep = { plan, reads, status: options.status };
  printSweep({ options, sweep });
  return exitCodeForVantaTestEntitySweep({ exitError: EXIT_ERROR, exitOk: EXIT_OK, sweep });
}

/**
 * Run the `vanta test-entities` verb against the real Vanta client.
 *
 * @param argv the full process argv
 * @returns the process exit code
 * @internal
 */
export async function runVantaTestEntities(argv: readonly string[]): Promise<number> {
  return runVantaTestEntitiesWith({ argv, deps: PRODUCTION_DEPS });
}

export const vantaTestEntitiesCommand = defineCommand({ run: runVantaTestEntities });
