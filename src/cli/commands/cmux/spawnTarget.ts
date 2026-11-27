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
import type { CodexSeatRoute } from "../../../cmux/seatRoute.js";
import { type CodexFleetCapPort, codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { type CodexSignInPort, codexSignInPort } from "../../../codex/signInPort.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { logger } from "../../../lib/logger.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import {
  type AppContinuationPlan,
  continuedAppSession,
  inspectRecordedLaunch,
} from "../../../sessionHarness/appContinuation.js";
import { APP_SOCKET_ROOT, type AppTransport, socketAppTransport } from "../../../sessionHarness/appSocketTransport.js";
import type { HarnessName } from "../../../sessionHarness/harnessChoice.js";
import { type HarnessSpawnDeps, productionHarnessSpawnDeps } from "../../../sessionHarness/recordedSpawn.js";
import type { WaitOptions } from "../../../wait/flags.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { claudeSeatNamedStore } from "./claudePlanFlag.js";
import { resolveCodexSeat, resolveContinuingCodexSeat } from "./codexSeat.js";
import { stringFlag } from "./core.js";
import { resolveSpawnArgv, type SpawnArgv } from "./spawnArgv.js";
import { spawnDefaultDriver } from "./spawnDriver.js";
import { resolveSpawnPins, type SpawnPins } from "./spawnPins.js";
import { buildSpawnPlan, type ContinuingSpawnPlan } from "./spawnPlanBuild.js";
import { findDoc, spawnPreflight } from "./spawnPreflight.js";
import { refuseSpawnTemplate, resolveSpawnTemplate } from "./spawnTemplate.js";
import type { SpawnWorktreeOptions } from "./spawnWorktreeOptions.js";

/** Everything `runCmuxSpawn` needs to actually open the session, once every preflight has passed. */
export interface SpawnTarget {
  readonly doc: HandoverDoc;
  readonly docText: string;
  /** The plan, carrying the app session this spawn continues, decided before the Codex seat was routed. */
  readonly plan: ContinuingSpawnPlan;
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
 * The slug's open app session is found FIRST, before any Codex routing, so a continuing Codex app seat is decided on
 * the home its session opened on rather than routed afresh.
 *
 * @param driver the already-resolved `--driver`, which decides which of the two can be set
 * @param harness where the session opens; only an app spawn reads an open app row
 * @param home the `--home` value both registers live under
 * @param parsed the verb's parsed flags
 * @param port where both drivers' plan register is read
 * @param fleetCap where a Codex seat's fleet read files its conclusion
 * @param signInPort where a Codex seat's fleet read files each store's sign-in observation
 * @param slug the handover slug whose open app ledger row a continuation reads
 * @returns both, either undefined when its driver is not this spawn's, with the continuation the spawn carries, or
 *   the exit code to stop on
 */
async function resolveSeatAccounts({
  driver,
  fleetCap,
  harness,
  home,
  parsed,
  port,
  signInPort,
  slug,
}: {
  driver: CmuxDriver;
  fleetCap: CodexFleetCapPort;
  harness: HarnessName;
  home: string | undefined;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
  slug: string;
}): Promise<
  { continuation: AppContinuationPlan; namedStore: string | undefined; seat: CodexSeatRoute | undefined } | number
> {
  const transport = socketAppTransport({ root: APP_SOCKET_ROOT });
  const discovered = await discoverAppContinuation({ driver, harness, home, slug, transport });
  if (typeof discovered === "number") {
    return discovered;
  }
  const codex = await resolveSeatFor({ discovered, driver, fleetCap, home, parsed, port, signInPort });
  if (typeof codex === "number") {
    return codex;
  }
  const namedStore = await claudeSeatNamedStore({ driver, home, parsed, port });
  if (typeof namedStore === "number") {
    return namedStore;
  }
  return { ...codex, namedStore };
}

/**
 * The Codex seat and the continuation it carries: a continuing Codex app seat is decided on the home its session
 * opened on; any other seat routes as it always has, and a Claude app seat continues its open row unchanged, its
 * credential route being the credential gate's, which this does not re-decide.
 */
async function resolveSeatFor({
  discovered,
  driver,
  fleetCap,
  home,
  parsed,
  port,
  signInPort,
}: {
  discovered: DiscoveredContinuation;
  driver: CmuxDriver;
  fleetCap: CodexFleetCapPort;
  home: string | undefined;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
  signInPort: CodexSignInPort;
}): Promise<{ continuation: AppContinuationPlan; seat: CodexSeatRoute | undefined } | number> {
  if (discovered.kind === "codex") {
    const { codexHome, sessionId } = discovered;
    return resolveContinuingCodexSeat({
      continuing: { codexHome, sessionId },
      fleetCap,
      home,
      log: logger,
      parsed,
      port,
      signInPort,
    });
  }
  const seat = await resolveCodexSeat({ driver, fleetCap, home, log: logger, parsed, port, signInPort });
  if (typeof seat === "number") {
    return seat;
  }
  if (discovered.kind === "claude") {
    return { continuation: { kind: "resume", sessionId: discovered.sessionId }, seat };
  }
  return { continuation: { kind: "none" }, seat };
}

/**
 * The slug's open app session, found BEFORE any Codex routing: none for a cmux spawn or a slug with no open app row;
 * a Claude seat's id as it stands; a Codex seat's id with the `$CODEX_HOME` the app's recovery journal recorded it
 * opening on. Reading that launch is a request to the app, and any failure of it STOPS the spawn — an app refusal, a
 * torn journal or a malformed answer is never read as licence to open fresh.
 */
type DiscoveredContinuation =
  | { readonly kind: "none" }
  | { readonly kind: "claude"; readonly sessionId: string }
  | { readonly kind: "codex"; readonly sessionId: string; readonly codexHome: string };

/**
 * Find the slug's open app session and, for a Codex seat, the home it opened on.
 *
 * @param driver the already-resolved `--driver`
 * @param harness where the session opens
 * @param home the state home the ledger lives under
 * @param slug the handover slug the spawn is for
 * @param transport the request channel to the app
 * @returns what the spawn may continue, or the exit code to stop on
 */
async function discoverAppContinuation({
  driver,
  harness,
  home,
  slug,
  transport,
}: {
  driver: CmuxDriver;
  harness: HarnessName;
  home: string | undefined;
  slug: string;
  transport: AppTransport;
}): Promise<DiscoveredContinuation | number> {
  if (harness !== "app") {
    return { kind: "none" };
  }
  const sessionId = continuedAppSession({ home, slug });
  if (sessionId === undefined) {
    return { kind: "none" };
  }
  if (driver !== "codex") {
    return { kind: "claude", sessionId };
  }
  const recorded = await inspectRecordedLaunch({ sessionId, transport });
  if (recorded.isErr()) {
    logger.error({ msg: `cmux spawn: refusing — ${recorded.error.message}` });
    return EXIT_ERROR;
  }
  if (recorded.value.vendor !== "codex") {
    logger.error({
      msg:
        `cmux spawn: refusing — app session ${sessionId} was opened as a ${recorded.value.vendor} session, and a codex ` +
        `seat cannot resume it; close it (slopweaver cmux close app:${sessionId} --harness app) or spawn --driver ` +
        recorded.value.vendor,
    });
    return EXIT_ERROR;
  }
  return { codexHome: recorded.value.codexHome, kind: "codex", sessionId };
}

/**
 * The production deps one spawn runs on. A Claude `--plan` was resolved against `--home`, so the gate judging that
 * store reads the same register, and measures that store with or without an explicit home; with no store named, the
 * gate keeps reading the ambient home exactly as it always has.
 *
 * Which ACCOUNT a seat boots on is decided in `cmux/spawn.ts`'s credential gate, never here: `--force`
 * travels as one half of the escape hatch, and `productionHarnessSpawnDeps` ORs in `SLOPWEAVER_ALLOW_SPENT_PLAN`, so
 * `false` here does not close the hatch the refusal names — `claude/spawnStore.ts`'s `spentPlanHatchOpen`.
 *
 * Built for the spawn's harness alone: an app-hosted spawn gets deps that open no cmux connection and no event
 * stream, since the app launcher reads neither.
 *
 * @param target the resolved spawn, for its harness, worktree options, `--force`, `--home` and named store
 * @returns the deps tagged with their harness; the caller MUST close the cmux arm's
 */
export function spawnDepsFor({ target }: { target: SpawnTarget }): HarnessSpawnDeps {
  const namedPin = target.namedStore !== undefined;
  const gateHome = namedPin ? target.home : undefined;
  return productionHarnessSpawnDeps({
    harness: target.harness,
    options: {
      ...target.worktree,
      allowSpentPlan: target.forceRouting,
      namedPin,
      ...(gateHome === undefined ? {} : { home: gateHome }),
    },
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
  // credential gate in `productionHarnessSpawnDeps` names its own, as the production deps factory it is.
  const ports = { fleetCap: codexFleetCapPort(), port: planRegisterPort(), signInPort: codexSignInPort() };
  const inputs = await resolveSpawnInputs({ argv, port: ports.port });
  if (typeof inputs === "number") {
    return inputs;
  }
  const { doc, harness, parsed, pins, preflight, template, wait, worktree } = inputs;
  const home = stringFlag({ name: "home", parsed });
  const seats = await resolveSeatAccounts({ driver: pins.driver, harness, home, parsed, slug: doc.slug, ...ports });
  if (typeof seats === "number") {
    return seats;
  }
  const { continuation, namedStore, seat } = seats;
  const docText = readFileSync(doc.path, "utf8");
  const plan = await buildSpawnPlan({
    codexSeat: seat,
    continuation,
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
