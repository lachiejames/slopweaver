/**
 * `slopweaver supervisor tick seat|open|fill|close` — one chair sweep as two verbs and a typed file, in place of the
 * per-pass shell script (`skills/supervisor/reference/sweep-contract.md`). `fill` writes that file
 * (`./tickFillRun.ts`), so no pass reaches for jq to patch it.
 *
 * ## The traps this makes impossible
 *
 * - **An over-cap headline.** `--headline-strong` plus `--headline-rest` joined to five sentences and were
 *   refused AFTER the pass had composed everything else. The headline is now `headline.sentences`, refused at
 *   parse time by `../../../briefing/headlineSentences.ts`, before any reading is interpreted.
 * - **Prefix lines before JSON.** `github landing --register --json` printed a receipt line ahead of its
 *   document and the chair's `jq` failed on it; the verb now keeps stdout pure, and every document here is
 *   read whole with `safeJsonParse`, never by scraping for the first `{`.
 * - **Timeouts under load.** Every reading and the session-start refresh run under their own budget, killed
 *   when spent (`./scratchChild.ts` says why the kill reaches the direct child only), and a spent budget is a NAMED outcome (`../../../supervisor/scratch/
 *   childOutcome.ts`) — never a hang, never a bare `null`.
 * - **Publishing before refusing.** A malformed action used to be refused at `tick-record`, after the page
 *   had already been published. Close validates the input, the sweep block, the tick row, the record gates,
 *   the next prompt AND the rendered page before its first durable write.
 * - **Retyped constants.** The header and loop key live in `seat.json`, written once.
 * - **A global bare-reference rewrite.** Qualifying every bare `#<number>` in `run.json` by number
 *   range is wrong; each row now resolves against its own repository on the page, so the refresh is promoted as
 *   `session-start` printed it.
 *
 * ## Where this stops
 *
 * Close does NOT arm the next wakeup — it prints the exact prompt last on stdout, and scheduling stays the
 * chair's. It does not git-commit the state home, and it freezes the page under its own local URL
 * (`../../../pages/publish.ts`), not an artifact id the chair carried in a text file.
 */
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../../../homeDir.js";
import { checkoutForRunningRepo } from "../../../live/checkout/checkoutForRepo.js";
import { productionPublishPage } from "../../../pages/productionPublish.js";
import { readLaneShapes } from "../../../plans/laneShapeRead.js";
import { planRegisterPort } from "../../../plans/port.js";
import { stateHomePaths } from "../../../stateHome.js";
import type { DigestReading } from "../../../supervisor/digestRead.js";
import { supervisorCoreErrorLines } from "../../../supervisor/errors.js";
import { LANDING_DRAFTS_READING, LANDING_READING, openHeadLines } from "../../../supervisor/scratch/tickCapture.js";
import { tickDigestLines } from "../../../supervisor/tickDigest.js";
import { tickInputTemplate } from "../../../supervisor/tickInput.js";
import { landingActions, nextTickNumber, tickIdOf } from "../../../supervisor/tickPlan.js";
import { handoffOfDir, newTickSeat, SEAT_FILE } from "../../../supervisor/tickSeat.js";
import { appendSupervisorTick, supervisorTickLedgerPath } from "../../../supervisor/tickStore.js";
import { tickWorkflowErrorLines } from "../../../supervisor/tickWorkflowErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { gateChairThenRun, productionChairGateDeps } from "./chairGateRun.js";
import { fleetHealthHatchOpen, readFleetHealthLive } from "./fleetHealthRead.js";
import { sweepContractPath } from "./run.js";
import { productionScratchDeps } from "./scratchDeps.js";
import { captureTick } from "./scratchRun.js";
import { readSteerRiskLive, steerRiskHatchOpen } from "./steerRiskRead.js";
import { tickOpenReadings } from "./tickBumpDrive.js";
import { commitClose } from "./tickCloseCommit.js";
import { noWorkClaimHatchOpen } from "./tickCloseNoWorkClaim.js";
import { prepareClose } from "./tickClosePrepare.js";
import { stoppedRecipesHatchOpen } from "./tickCloseStoppedRecipes.js";
import {
  parseSupervisorTickArgs,
  SUPERVISOR_TICK_USAGE,
  type TickCloseArgs,
  type TickOpenArgs,
  type TickSeatArgs,
} from "./tickCore.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { readPriorHolds, readRecipeFixCheckout, tickDigestShown } from "./tickDigestEdge.js";
import { digestReadings, fileAgeMinutes, readSeat, runAgeMinutes, TICK_INPUT_FILE } from "./tickFiles.js";
import { runFill } from "./tickFillRun.js";
import { sayJsonFallbacks } from "./tickOpenFallbacks.js";
import { type StoppedSeatOutcome, seatStoppedRecipes } from "./tickOpenStoppedRecipes.js";
import { openHatches, productionSupervisorTickRecordDeps } from "./tickRecordRun.js";
import { renderInProcess } from "./tickRender.js";

/**
 * Print one failure's lines under the verb's name.
 *
 * @param lines what to say
 * @param deps the injected lanes
 * @returns the error exit code
 */
function refuse({ lines, deps }: { lines: readonly string[]; deps: SupervisorTickDeps }): number {
  for (const line of lines) {
    deps.scratch.writeDiagnostic(`supervisor tick: ${line}`);
  }
  return EXIT_ERROR;
}

/**
 * Print lines to stdout, one write each.
 *
 * @param lines what to print, already shaped
 * @param deps the injected lanes
 */
function say({ lines, deps }: { lines: readonly string[]; deps: SupervisorTickDeps }): void {
  for (const line of lines) {
    deps.scratch.writeOut(line);
  }
}

/**
 * `tick seat`: write `seat.json` once.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns the exit code
 */
function runSeat({ args, deps }: { args: TickSeatArgs; deps: SupervisorTickDeps }): number {
  const dir = resolve(args.dir);
  const path = join(dir, SEAT_FILE);
  if (existsSync(path) && !args.replace) {
    return refuse({ deps, lines: [`${path} already exists — pass --replace to rewrite this seat's constants`] });
  }
  const { handoff = handoffOfDir({ dir }) } = args;
  if (handoff === undefined) {
    return refuse({ deps, lines: [`${dir} is not named handoff-<n>; pass --handoff`] });
  }
  const seat = newTickSeat({
    dir,
    path,
    seat: {
      handoff,
      landingRepos: [...args.landingRepos],
      loopSessionKey: args.loopSessionKey,
      model: args.model,
      pinnedAtIso: args.pinnedAt,
      workspace: args.workspace,
    },
  });
  if (seat.isErr()) {
    return refuse({ deps, lines: tickWorkflowErrorLines({ error: seat.error }) });
  }
  writeFileAtomic({ contents: `${JSON.stringify(seat.value, null, 2)}\n`, path });
  deps.scratch.writeOut(
    `supervisor tick seat: wrote ${path} — ${seat.value.handoff} at ${seat.value.workspace}, ${seat.value.model}`,
  );
  return EXIT_OK;
}

/** Seat this tick's stopped recipe set from its readings, the children writing into the open's own home. */
async function seatFromReadings({
  args,
  bin,
  captureDir,
  deps,
  readings,
  tickId,
}: {
  args: TickOpenArgs;
  bin: string;
  captureDir: string;
  deps: SupervisorTickDeps;
  readings: ReadonlyMap<string, DigestReading>;
  tickId: string;
}): Promise<StoppedSeatOutcome> {
  const { home = deps.defaultHome() } = args;
  return seatStoppedRecipes({
    bin,
    captureDir,
    checkout: () => deps.repairCheckout({ home }),
    deps: deps.scratch,
    handoverDir: stateHomePaths({ home }).handovers,
    home: args.home,
    reconcile: readings.get("reconcile"),
    runsDir: stateHomePaths({ home }).runs,
    stopped: readings.get("recipe-stopped"),
    tickId,
  });
}

/** Every act the press read and the drafts read took, each witnessed by its own reading's file — never overlapping. */
function landedActs({
  dir,
  readings,
}: {
  dir: string;
  readings: ReadonlyMap<string, DigestReading>;
}): ReturnType<typeof landingActions> {
  return [LANDING_READING, LANDING_DRAFTS_READING].flatMap((name) => {
    const landing = readings.get(name);
    const witnessPath = join(dir, `${name}.json`);
    return landing?.kind === "json" ? landingActions({ landing: landing.value, witnessPath }) : [];
  });
}

/**
 * `tick open`: the next tick's readings, a digest of them, and the template the chair fills.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @returns the exit code
 */
async function runOpen({ args, deps }: { args: TickOpenArgs; deps: SupervisorTickDeps }): Promise<number> {
  const dir = resolve(args.dir);
  const seat = readSeat({ dir });
  if (seat.isErr()) {
    return refuse({ deps, lines: tickWorkflowErrorLines({ error: seat.error }) });
  }
  const { tick = nextTickNumber({ names: readdirSync(dir) }), bin = deps.scratch.defaultBin() } = args;
  const driven = tickOpenReadings({ home: deps.defaultHome(), nowIso: deps.scratch.now(), seat: seat.value });
  const captured = await captureTick({
    bin,
    deps: deps.scratch,
    home: args.home,
    readings: driven.readings,
    scratch: dir,
    tick: String(tick),
  });
  if (captured.isErr()) {
    return refuse({ deps, lines: [captured.error.message] });
  }
  const { capture } = captured.value;
  const nowIso = deps.scratch.now();
  const readings = digestReadings({ dir: capture.dir, readings: capture.readings });
  const landed = landedActs({ dir: capture.dir, readings });
  const repaired = await seatFromReadings({
    args,
    bin,
    captureDir: capture.dir,
    deps,
    readings,
    tickId: tickIdOf({ handoff: seat.value.handoff, tick }),
  });
  const templatePath = join(capture.dir, TICK_INPUT_FILE);
  writeFileAtomic({
    contents: `${JSON.stringify(tickInputTemplate({ derivedActions: [...landed, ...repaired.actions] }), null, 2)}\n`,
    path: templatePath,
  });
  say({ deps, lines: openHeadLines({ capture }) });
  sayJsonFallbacks({ deps, digested: readings, readings: capture.readings });
  const lines = tickDigestLines({
    inputs: {
      openPagesAgeMinutes: fileAgeMinutes({ nowIso, path: join(dir, "open-pages.json") }),
      priorHolds: readPriorHolds({ dir, tick }),
      readings,
      // The ambient home, never `--home`: every reading above ran against it, and `--home` names only the ledger
      // they are recorded in, so the checkout a printed set-repo names is resolved on the same board.
      recipeFixCheckout: readRecipeFixCheckout({ home: deps.defaultHome() }),
      runAgeMinutes: runAgeMinutes({ nowIso, path: join(dir, "run.json") }),
    },
  });
  const shown = tickDigestShown({ captureDir: capture.dir, dir, lines, tick });
  if (shown.isErr()) {
    return refuse({ deps, lines: [shown.error.message] });
  }
  // The acts this open took itself are never compared: each is new by construction.
  say({ deps, lines: [...shown.value, ...driven.lines, ...repaired.lines].map((line) => `  ${line}`) });
  deps.scratch.writeOut(`fill ${templatePath}, then: slopweaver supervisor tick close --dir ${dir}`);
  return EXIT_OK;
}

/**
 * `tick close`: prepare everything, then commit behind the chair gate.
 *
 * @param args the parsed invocation
 * @param deps the injected seams
 * @param rest the argv tail, which the chair gate reads for `--help`
 * @returns the exit code
 */
async function runClose({
  args,
  deps,
  rest,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
  rest: readonly string[];
}): Promise<number> {
  const prepared = await prepareClose({ args, deps });
  if (prepared.isErr()) {
    return refuse({ deps, lines: tickWorkflowErrorLines({ error: prepared.error }) });
  }
  return deps.gate({
    argv: rest,
    commit: ({ evidence }) => commitClose({ deps, evidence, prepared: prepared.value }),
  });
}

/**
 * Run `supervisor tick` against injected seams.
 *
 * @param rest the argv tail after `supervisor tick`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runSupervisorTick({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: SupervisorTickDeps;
}): Promise<number> {
  const args = parseSupervisorTickArgs({ rest });
  if (args.isErr()) {
    deps.scratch.writeDiagnostic(`supervisor tick: ${args.error.message}`);
    deps.scratch.writeDiagnostic(SUPERVISOR_TICK_USAGE);
    return EXIT_USAGE;
  }
  switch (args.value.subaction) {
    case "seat":
      return runSeat({ args: args.value, deps });
    case "open":
      return runOpen({ args: args.value, deps });
    case "fill":
      return runFill({ args: args.value, deps });
    case "close":
      return runClose({ args: args.value, deps, rest });
    default: {
      const unreachable: never = args.value;
      return unreachable;
    }
  }
}

/**
 * Whether the tick ledger already holds one id, streamed line by line — the ledger has no ceiling.
 *
 * @param home the state home
 * @param tickId the id to look for
 * @returns true when a row carries it
 */
async function ledgerHasTick({ home, tickId }: { home: string; tickId: string }): Promise<boolean> {
  const path = supervisorTickLedgerPath({ home });
  if (!existsSync(path)) {
    return false;
  }
  const needle = `"tickId":${JSON.stringify(tickId)}`;
  const lines = createInterface({ crlfDelay: Infinity, input: createReadStream(path, "utf8") });
  for await (const line of lines) {
    if (line.includes(needle)) {
      lines.close();
      return true;
    }
  }
  return false;
}

/**
 * The seams `supervisor tick` runs against in production.
 *
 * @returns the production dependencies
 */
export function productionSupervisorTickDeps(): SupervisorTickDeps {
  const record = productionSupervisorTickRecordDeps();
  return {
    appendTick: ({ row, home }) =>
      appendSupervisorTick({ home, row }).mapErr((error) => supervisorCoreErrorLines({ error })),
    cadenceReads: {
      readChairAutoCompactions: record.readChairAutoCompactions,
      readChairCanon: record.readChairCanon,
      readChairPlans: record.readChairPlans,
      readClaudeCode: record.readClaudeCode,
      readClaudeSide: record.readClaudeSide,
      readCodexChairCanon: record.readCodexChairCanon,
      readCodexSeat: record.readCodexSeat,
      readPlanRegister: record.readPlanRegister,
    },
    contractPath: sweepContractPath,
    defaultHome: slopweaverHome,
    gate: ({ argv, commit }) =>
      gateChairThenRun({
        argv,
        deps: productionChairGateDeps({ argv }),
        run: ({ evidence }) => commit({ evidence }),
        verb: "tick close",
      }),
    fleetHatchOpen: fleetHealthHatchOpen,
    hasTick: ledgerHasTick,
    repairCheckout: ({ home }) => checkoutForRunningRepo({ home, verb: "supervisor tick open" }),
    stoppedRecipesHatchOpen,
    noWorkClaimHatchOpen,
    hatches: () => openHatches({ deps: record }),
    publish: async ({ home, fragment, nowIso }) =>
      (await productionPublishPage({ fragment, home, nowIso, slug: "fleet-briefing" })).map(({ url }) => ({ url })),
    readFleetHealth: ({ home, nowIso }) =>
      readFleetHealthLive({ home, noteClock: () => new Date().toISOString(), nowIso }),
    readApprovedDrafts: record.readApprovedDrafts,
    readLanes: ({ home, nowIso }) => readLaneShapes({ home, nowIso, read: planRegisterPort().read }),
    readSteerRisk: ({ home, nowIso }) => readSteerRiskLive({ home, noteClock: () => new Date().toISOString(), nowIso }),
    readUnpickedSteers: record.readUnpickedSteers,
    readVoiceUnread: record.readVoiceUnread,
    render: renderInProcess,
    scratch: productionScratchDeps(),
    steerRiskHatchOpen,
  };
}

/** `slopweaver supervisor tick seat|open|fill|close`. */
export const supervisorTickCommand = defineCommand({
  run: (argv) => runSupervisorTick({ deps: productionSupervisorTickDeps(), rest: verbTail({ argv, verbs: ["tick"] }) }),
});
