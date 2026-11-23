/**
 * `slopweaver cmux reseat` — stop one workspace's `claude` and relaunch the SAME session in the same surface with
 * `--resume`, booted on a routed plan's credential. The chair included. `--all` does every seat whose screen shows
 * a wall (logged out after a restore, or retrying on a spent limit), the chair first.
 *
 * The disaster-recovery command the owner asked for after a restore locked the owner out of their own chair:
 * runnable from ANY cmux terminal tab, a plain shell included, because no Claude session and so no seat hook
 * stands between the owner and it. What it decides is `../../../sessions/reseat.ts`; the pass and its order are
 * `./reseatPass.ts`; the production effects — the socket, the registry, the routing gate, the stop — are
 * `./reseatEffects.ts`; this file is the verb.
 */
import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";

import { readConsoleBuild } from "../../../checkouts/consoleBuildRead.js";
import { slopweaverHome } from "../../../config.js";
import { BOOT_WINDOW_SECONDS } from "../../../live/machine/recentBoots.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { withCmuxSessionHost } from "../../../sessionHarness/cmuxHost.js";
import { pinnedModelsByWorkspace } from "../../../sessions/reseat.js";
import { ReseatErrors } from "../../../sessions/reseatErrors.js";
import { type ReseatOutcome, renderReseatOutcome, reseatPassVerdict } from "../../../sessions/reseatOutcome.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { mainCheckoutRoot as checkoutRootOf } from "../../../worktree/shell.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import type { ParsedFlags } from "../../parseFlags.js";
import { claudePlanStoreFor } from "./claudePlanFlag.js";
import { cmuxUsage, numberFlag, parseCmuxVerb, stringFlag } from "./core.js";
import { reseatProductionDeps } from "./reseatEffects.js";
import { type ReseatDeps, reseatAll, reseatWallOf, reseatWorkspace } from "./reseatPass.js";

/**
 * The console line `--all` ends on: the console died with the restore and nothing named it.
 *
 * @returns the line, naming the serve command when nothing is serving
 */
function consoleLine(): string {
  const tree = installedTreeRoot({ importMetaUrl: import.meta.url });
  const root = checkoutRootOf({ cwd: tree });
  if (root === undefined) {
    return `console\tnot read — ${tree} is not inside a git checkout`;
  }
  const report = readConsoleBuild({ cwd: root, nowMs: Date.now() });
  if (report.served.kind === "none" || !report.served.live) {
    return `console\tnot serving — bring it back with: bash ${root}/scripts/docs-site.sh --serve`;
  }
  return `console\tserving on :${String(report.served.port)}`;
}

/** What one invocation asked for, once its flags parsed. */
interface ReseatRequest {
  readonly target: { readonly kind: "all" } | { readonly kind: "one"; readonly ref: string };
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly json: boolean;
  readonly model: string | undefined;
  /** The store `--plan` named, resolved off the register; undefined when the plan is routed. */
  readonly namedStoreDir: string | undefined;
  readonly home: string;
  readonly timeoutSeconds: number;
}

/**
 * The store `--plan` names for ONE relaunched seat, or the usage problem. Refused beside `--all`: one plan for every
 * walled seat at once is the pile-up onto one plan that naming a plan exists to step around.
 *
 * @returns the store, undefined when no plan was named, or the exit code to stop on
 */
async function readNamedStore({
  all,
  home,
  parsed,
  port,
}: {
  all: boolean;
  home: string;
  parsed: ParsedFlags;
  port: PlanRegisterPort;
}): Promise<{ readonly storeDir: string | undefined } | number> {
  const alias = stringFlag({ name: "plan", parsed });
  if (alias === undefined) {
    return { storeDir: undefined };
  }
  if (all) {
    logger.error({ msg: "cmux reseat: --plan names one seat's plan, so it takes one workspace, never --all" });
    return EXIT_USAGE;
  }
  const named = await claudePlanStoreFor({ alias, command: "cmux reseat", home, port });
  return typeof named === "number" ? named : { storeDir: named };
}

/**
 * Read the invocation's flags: exactly one of a workspace or `--all`.
 *
 * @returns the request, or the usage problem
 */
async function readRequest({
  argv,
  port,
}: {
  argv: readonly string[];
  port: PlanRegisterPort;
}): Promise<ReseatRequest | number> {
  const parsed = parseCmuxVerb({ argv, verb: "reseat" });
  if (typeof parsed === "number") {
    return parsed;
  }
  const all = parsed.values["all"] === true;
  const [ref, ...extra] = parsed.positionals;
  if (all === (ref !== undefined) || extra.length > 0) {
    logger.error({ msg: "cmux reseat: name exactly one workspace, or pass --all" });
    logger.error({ msg: cmuxUsage({ verb: "reseat" }) });
    return EXIT_USAGE;
  }
  const timeout = numberFlag({ name: "timeout-seconds", parsed });
  if ("error" in timeout) {
    logger.error({ msg: `cmux reseat: ${timeout.error}` });
    return EXIT_USAGE;
  }
  let timeoutSeconds = BOOT_WINDOW_SECONDS;
  if (timeout.value !== undefined) {
    timeoutSeconds = timeout.value;
  }
  let home = slopweaverHome();
  const namedHome = stringFlag({ name: "home", parsed });
  if (namedHome !== undefined) {
    home = namedHome;
  }
  const named = await readNamedStore({ all, home, parsed, port });
  if (typeof named === "number") {
    return named;
  }
  return {
    dryRun: parsed.values["dry-run"] === true,
    force: parsed.values["force"] === true,
    home,
    json: parsed.values["json"] === true,
    model: stringFlag({ name: "model", parsed }),
    namedStoreDir: named.storeDir,
    target: ref === undefined ? { kind: "all" } : { kind: "one", ref },
    timeoutSeconds,
  };
}

/** Reseat the one named workspace, reading its screen first so a walled seat is never refused as busy. */
async function reseatNamed({ deps, ref }: { deps: ReseatDeps; ref: string }): Promise<readonly ReseatOutcome[]> {
  const resolved = await deps.client.resolveWorkspace({ ref });
  if (resolved.isErr()) {
    const error = ReseatErrors.cmuxReadFailed({ cause: resolved.error.message, what: ref });
    return [{ error, kind: "refused", workspaceRef: ref }];
  }
  const screen = await deps.client.readScreen({ target: { workspaceId: resolved.value.workspaceId } });
  const wall = screen.isOk()
    ? await reseatWallOf({ deps, screen: screen.value, workspace: resolved.value })
    : undefined;
  return [await reseatWorkspace({ deps, wall, workspace: resolved.value })];
}

/** Print a pass's outcomes, then `--all`'s console line, as lines or as one `--json` document. */
function printOutcomes({ outcomes, request }: { outcomes: readonly ReseatOutcome[]; request: ReseatRequest }): void {
  const tail = request.target.kind === "all" ? [consoleLine()] : [];
  if (request.json) {
    logger.out({ line: JSON.stringify({ dryRun: request.dryRun, outcomes, tail }) });
    return;
  }
  for (const outcome of outcomes) {
    logger.out({ line: renderReseatOutcome({ outcome }) });
  }
  if (outcomes.length === 0) {
    logger.out({ line: "cmux reseat: no seat shows a wall — nothing to relaunch" });
  }
  for (const line of tail) {
    logger.out({ line });
  }
}

/**
 * `cmux reseat` — relaunch one seat, or every walled one, in place on a routed plan.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCmuxReseat(argv: readonly string[]): Promise<number> {
  return runCmuxReseatOver({ argv, port: planRegisterPort() });
}

/**
 * {@link runCmuxReseat} over an injected plan-register port — the seam a test reaches the verb through without a
 * store, and the one register every read of the pass shares.
 *
 * @param argv the full process argv
 * @param port where `--plan`, the routing gate and the seat readings read the plan register
 * @returns the process exit code
 */
export async function runCmuxReseatOver({
  argv,
  port,
}: {
  argv: readonly string[];
  port: PlanRegisterPort;
}): Promise<number> {
  const request = await readRequest({ argv, port });
  if (typeof request === "number") {
    return request;
  }
  const passed = await withCmuxSessionHost({
    body: async ({ host: client }): Promise<Result<readonly ReseatOutcome[], string>> => {
      const listed = await client.listWorkspaces();
      if (listed.isErr()) {
        return err(listed.error.message);
      }
      const { events } = parseSessionLog({ text: readSessionLogText({ home: request.home }) });
      const deps = reseatProductionDeps({
        client,
        flags: {
          dryRun: request.dryRun,
          force: request.force,
          model: request.model,
          namedStoreDir: request.namedStoreDir,
        },
        home: request.home,
        ledgerModels: pinnedModelsByWorkspace({ rows: foldSessions({ events }), workspaces: listed.value }),
        port,
        timeoutSeconds: request.timeoutSeconds,
      });
      if (request.target.kind === "all") {
        return ok(await reseatAll({ deps, workspaces: listed.value }));
      }
      return ok(await reseatNamed({ deps, ref: request.target.ref }));
    },
  });
  if (passed.isErr()) {
    logger.error({
      msg: `cmux reseat: cmux did not answer (${passed.error}) — cmux only takes a client started inside it, so open a cmux terminal tab and run this there`,
    });
    return EXIT_ERROR;
  }
  const outcomes = passed.value;
  printOutcomes({ outcomes, request });
  if (reseatPassVerdict({ outcomes }) === "error") {
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const cmuxReseatCommand = defineCommand({ run: runCmuxReseat });
