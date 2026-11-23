/**
 * The decision half of `cmux spawn`: every refusal and lookup that runs BEFORE it is safe to touch a worktree
 * or a workspace, folded into one resolved {@link SpawnTarget}.
 *
 * A leaf of `./run.ts` for the reason `./spawnPins.ts`, `./spawnTemplate.ts` and `./spawnPlanBuild.ts` are:
 * `run.ts` opens the session and reports how that went, and this is the part that decides whether it may.
 * Splitting them keeps both under the repo's max-function-lines and file-size ratchets.
 */
import { readFileSync } from "node:fs";

import type { LaunchTemplate } from "../../../cmux/launchTemplate.js";
import type { CmuxDriver } from "../../../cmux/pickupCommand.js";
import type { SpawnPlan } from "../../../cmux/plan.js";
import type { CodexSeatRoute } from "../../../cmux/seatRoute.js";
import type { SpawnDeps } from "../../../cmux/spawn.js";
import { type CodexFleetCapPort, codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { type CodexSignInPort, codexSignInPort } from "../../../codex/signInPort.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { logger } from "../../../lib/logger.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import type { HarnessName } from "../../../sessionHarness/harnessChoice.js";
import { productionSpawnDeps } from "../../../sessionHarness/recordedSpawn.js";
import type { WaitOptions } from "../../../wait/flags.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { claudeSeatNamedStore } from "./claudePlanFlag.js";
import { resolveCodexSeat } from "./codexSeat.js";
import { stringFlag } from "./core.js";
import { resolveSpawnArgv, type SpawnArgv } from "./spawnArgv.js";
import { spawnDefaultDriver } from "./spawnDriver.js";
import { resolveSpawnPins, type SpawnPins } from "./spawnPins.js";
import { buildSpawnPlan } from "./spawnPlanBuild.js";
import { findDoc, spawnPreflight } from "./spawnPreflight.js";
import { refuseSpawnTemplate, resolveSpawnTemplate } from "./spawnTemplate.js";
import type { SpawnWorktreeOptions } from "./spawnWorktreeOptions.js";

/** Everything `runCmuxSpawn` needs to actually open the session, once every preflight has passed. */
export interface SpawnTarget {
  readonly doc: HandoverDoc;
  readonly docText: string;
  readonly plan: SpawnPlan;
  readonly driver: CmuxDriver;
  /** `--harness`: a cmux workspace (the default) or a card in the desktop app. */
  readonly harness: HarnessName;
  /** The routed Codex account this seat spends, or undefined for a Claude spawn, which routes none. */
  readonly codexSeat: CodexSeatRoute | undefined;
  readonly home: string | undefined;
  /** The Claude store `--plan` named, resolved against {@link home}, or undefined when routing decides. */
  readonly namedStore: string | undefined;
  /** Whether `--require-current-base` was passed, turning the base-freshness advisory into a refusal. */
  readonly requireCurrentBase: boolean;
  /** Whether `--force` was passed, which lets a spawn open onto a plan the live gauges say is spent. */
  readonly forceRouting: boolean;
  /** Whether `--full` was passed, printing the worktree and boot detail lines instead of the one receipt line. */
  readonly full: boolean;
  /** The `worktree create` options this spawn passes through when it has a worktree to provision. */
  readonly worktree: SpawnWorktreeOptions;
  /** `--wait`/`--timeout-seconds`: hold the spawn until no machine capacity HOLD stands. */
  readonly wait: WaitOptions;
  /** The doc's run journal as the preflight read it — whether this spawn OPENS a run or RESUMES one. */
  readonly runEvents: readonly RunEvent[];
}

/**
 * The account a spawn spends, by driver: the routed Codex seat, or the Claude store `--plan` named.
 *
 * @param driver the already-resolved `--driver`, which decides which of the two can be set
 * @param home the `--home` value both registers live under
 * @param parsed the verb's parsed flags
 * @param port where both drivers' plan register is read
 * @param fleetCap where a Codex seat's fleet read files its conclusion
 * @param signInPort where a Codex seat's fleet read files each store's sign-in observation
 * @returns both, either undefined when its driver is not this spawn's, or the exit code to stop on
 */
async function resolveSeatAccounts({
  driver,
  fleetCap,
  home,
  parsed,
  port,
  signInPort,
}: {
  driver: CmuxDriver;
  fleetCap: CodexFleetCapPort;
  home: string | undefined;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
}): Promise<{ namedStore: string | undefined; seat: CodexSeatRoute | undefined } | number> {
  const seat = await resolveCodexSeat({ driver, fleetCap, home, parsed, port, signInPort });
  if (typeof seat === "number") {
    return seat;
  }
  const namedStore = await claudeSeatNamedStore({ driver, home, parsed, port });
  if (typeof namedStore === "number") {
    return namedStore;
  }
  return { namedStore, seat };
}

/**
 * The production deps one spawn runs on. A Claude `--plan` was resolved against `--home`, so the gate judging that
 * store reads the same register, and measures that store with or without an explicit home; with no store named, the
 * gate keeps reading the ambient home exactly as it always has.
 *
 * Which ACCOUNT a seat boots on is decided in `cmux/spawn.ts`'s credential gate, never here: `--force`
 * travels as one half of the escape hatch, and `productionSpawnDeps` ORs in `SLOPWEAVER_ALLOW_SPENT_PLAN`, so
 * `false` here does not close the hatch the refusal names — `claude/spawnStore.ts`'s `spentPlanHatchOpen`.
 *
 * @param target the resolved spawn, for its worktree options, `--force`, `--home` and named store
 * @returns the deps, which the caller MUST close
 */
export function spawnDepsFor({ target }: { target: SpawnTarget }): SpawnDeps {
  const namedPin = target.namedStore !== undefined;
  const gateHome = namedPin ? target.home : undefined;
  return productionSpawnDeps({
    ...target.worktree,
    allowSpentPlan: target.forceRouting,
    namedPin,
    ...(gateHome === undefined ? {} : { home: gateHome }),
  });
}

/**
 * The refusals that need nothing but the argv and the board: every argv-only refusal (`./spawnArgv.ts`), finding
 * the doc, its preflight against the run journal, the host-free template checks — then, last, the register read
 * an omitted `--driver` makes, and the pins and template that need its host.
 *
 * Ahead of the Codex seat route on purpose: a refused `--template` must stop before its live read starts an
 * app-server.
 *
 * @param argv the full process argv
 * @param port where the plan register is read when `--driver` is omitted — the spawn's own port
 * @returns what the argv settled, with the doc, pins and template they resolved to, or the exit code to stop on
 */
async function resolveSpawnInputs({ argv, port }: { argv: readonly string[]; port: PlanRegisterPort }): Promise<
  | (SpawnArgv & {
      doc: HandoverDoc;
      pins: SpawnPins;
      preflight: Exclude<ReturnType<typeof spawnPreflight>, number>;
      template: LaunchTemplate;
    })
  | number
> {
  const settled = resolveSpawnArgv({ argv });
  if (typeof settled === "number") {
    return settled;
  }
  const { parsed, slug } = settled;
  const doc = findDoc({ parsed, slug });
  if (typeof doc === "number") {
    return doc;
  }
  const preflight = spawnPreflight({ doc, home: stringFlag({ name: "home", parsed }), slug });
  if (typeof preflight === "number") {
    return preflight;
  }
  const templateRefusal = refuseSpawnTemplate({ doc, parsed });
  if (templateRefusal !== undefined) {
    return templateRefusal;
  }
  // Read only once every argv and doc refusal has declined: a spawn refused on what it was handed never waits on
  // the store an omitted `--driver` reads, nor has that refusal masked by the store's error.
  const defaultDriver = await spawnDefaultDriver({ home: stringFlag({ name: "home", parsed }), parsed, port });
  if (typeof defaultDriver === "number") {
    return defaultDriver;
  }
  const pins = resolveSpawnPins({ argvPins: settled.argvPins, defaultDriver, parsed });
  if (typeof pins === "number") {
    return pins;
  }
  const template = resolveSpawnTemplate({ doc, driver: pins.driver, parsed });
  if (typeof template === "number") {
    return template;
  }
  return { ...settled, doc, pins, preflight, template };
}

/**
 * Every refusal and lookup `cmux spawn` runs BEFORE it is safe to touch a worktree or a workspace: flag
 * parsing, `--driver` validation, the Codex quota fast-fail, finding the doc, and reading its run journal.
 *
 * Split out purely to keep `runCmuxSpawn` itself under the repo's max-function-lines ratchet — every early
 * return here is one `runCmuxSpawn` used to have inline.
 *
 * @param argv the full process argv
 * @returns the resolved {@link SpawnTarget}, or the exit code to stop on
 */
export async function resolveSpawnTarget({ argv }: { argv: readonly string[] }): Promise<SpawnTarget | number> {
  // One port for every register read this spawn makes before launch — the omitted-driver default included; the
  // credential gate in `productionSpawnDeps` names its own, as the production deps factory it is.
  const ports = { fleetCap: codexFleetCapPort(), port: planRegisterPort(), signInPort: codexSignInPort() };
  const inputs = await resolveSpawnInputs({ argv, port: ports.port });
  if (typeof inputs === "number") {
    return inputs;
  }
  const { doc, harness, parsed, pins, preflight, template, wait, worktree } = inputs;
  const home = stringFlag({ name: "home", parsed });
  const seats = await resolveSeatAccounts({ driver: pins.driver, home, parsed, ...ports });
  if (typeof seats === "number") {
    return seats;
  }
  const { namedStore, seat } = seats;
  const docText = readFileSync(doc.path, "utf8");
  const plan = await buildSpawnPlan({
    codexSeat: seat,
    doc,
    namedStore,
    parsed,
    pins,
    port: ports.port,
    preflight,
    template,
  });
  if (plan.isErr()) {
    // Before any worktree or workspace: a pinned seat whose store could not be read never boots storeless.
    logger.error({ msg: `cmux spawn: refusing — the pinned Claude store could not be read: ${plan.error.message}` });
    return EXIT_ERROR;
  }
  return {
    codexSeat: seat,
    doc,
    docText,
    driver: pins.driver,
    harness,
    home,
    plan: plan.value,
    forceRouting: parsed.values["force"] === true,
    full: parsed.values["full"] === true,
    namedStore,
    requireCurrentBase: parsed.values["require-current-base"] === true,
    runEvents: preflight.runEvents,
    wait,
    worktree,
  };
}
