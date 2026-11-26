/**
 * Every `plans` verb's behaviour, over injected seams so the whole surface is driven without a filesystem.
 *
 * ## Three exit shapes, and why each one
 *
 * A read that could not decide which destinations this install has exits `EXIT_ERROR`: seating a session on
 * an unknown fleet means seating it on whatever credential happens to be ambient. A register that decodes to
 * NO destinations exits `EXIT_EXPECTED_EMPTY` — the verb worked, there is nothing there. And `validate` is a
 * DIAGNOSTIC: it exits non-zero when it finds something, which is the verb succeeding, so `DERIVED_REGISTER`
 * is deliberately NOT a finding — an install that has adopted nothing is normal, not broken.
 *
 * ## One verb asks a provider something
 *
 * `sync-accounts` is the one verb here that reads beyond this machine's files: it asks each Codex store's own
 * app-server which account it is signed into (`codex/accountLive.ts`). That read is a seam too, so every test
 * drives it with a fake and none can reach a real account. `list` reads one more local file per Codex row it
 * prints — that store's own `auth.json`, for the paid-through date its sign-in states — through a seam as well.
 *
 * ## The clock is a seam, not an import
 *
 * A pause records the instant it was recorded, and that is the only clock any of these verbs reads. It
 * arrives through {@link PlansDeps} so the pause tests assert an exact `sinceIso` rather than a shape.
 */
import { runningCheckoutRoot } from "#lib/gitRepo.js";
import { logger } from "#lib/logger.js";
import type { Result } from "#lib/result.js";

import { type ReadCodexAccountsLive, readCodexAccountsLive } from "../../../codex/accountLive.js";
import { readCodexSubscriptionDates } from "../../../codex/subscriptionDates.js";
import type { SyncOutcome } from "../../../codexPlugin/plan.js";
import { slopweaverHome } from "../../../homeDir.js";
import type { PlanRegisterError } from "../../../plans/errors.js";
import { laneShapeReadOf } from "../../../plans/laneShape.js";
import type { PlanPaidThrough } from "../../../plans/lapse.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { plansForProvider } from "../../../plans/register.js";
import type { PlanMutation, PlanProvider, PlanRegisterSnapshot } from "../../../plans/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { addedCodexHome, ensureCodexHome, syncAddedCodexHome, syncIfRowCommitted } from "./codexAdd.js";
import { syncCodexPluginHomeLive } from "./codexPluginSyncLive.js";
import { type PlansInvocation, parsePlansArgs, VERB_ARG_OFFSET } from "./core.js";
import {
  codexPaidThrough,
  listedSnapshot,
  planChangeLines,
  planLaneLines,
  planListLines,
  planValidateLines,
} from "./lines.js";
import { plansUsage } from "./plansUsage.js";
import { didWord, mutationFor } from "./requestMutation.js";
import { judgedRevision, type ResolveStore } from "./storeAlias.js";
import { ensureStoreDirLive, resolveStoreLive } from "./storeDirLive.js";
import { type AccountSyncRow, planAccountSync } from "./syncAccounts.js";

/** Everything the `plans` verbs touch outside themselves, injected so a test drives the whole surface. */
export interface PlansDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  readonly readRegister: (input: {
    readonly home: string | undefined;
  }) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;
  readonly writeRegister: (input: {
    readonly home: string | undefined;
    readonly mutation: PlanMutation;
    /** The revision a check made before the write read — the write refuses if the register moved past it. */
    readonly judgedAtRevision?: number | null | undefined;
  }) => Promise<Result<PlanRegisterSnapshot, PlanRegisterError>>;
  readonly nowIso: () => string;
  /**
   * Create a newly registered Codex home when it does not exist yet. `created` or `existed` on success, the
   * reason on failure. A seam so a test drives `add` without touching the operator's real home directory.
   */
  readonly ensureStoreDir: (input: { readonly storeDir: string }) => Result<"created" | "existed", string>;
  /** The directory a store path names on disk, so `add` refuses a second row over one sign-in (`./storeAlias.ts`). */
  readonly resolveStore: ResolveStore;
  /** Ask each Codex store's own app-server which account it is signed into — `sync-accounts` only. */
  readonly readLive: ReadCodexAccountsLive;
  /**
   * What one Codex store's own sign-in states about its paid period — a local file read, no network
   * (`codex/subscriptionDates.ts`). `list` only, once per Codex row it prints.
   */
  readonly readPaidThrough: (input: { readonly codexHome: string }) => PlanPaidThrough;
  /**
   * Install Slopweaver into the one Codex home `add` has just registered, after the row is published — the
   * foreground plugin-sync core over that home alone (`./codexPluginSyncLive.ts`). `add` only.
   */
  readonly syncCodexPluginHome: (input: {
    readonly codexHome: string;
    readonly home: string | undefined;
  }) => SyncOutcome;
}

/** The one diagnostic `validate` does not treat as a finding — see this module's header. */
const NOT_A_FINDING = "DERIVED_REGISTER";

/** Print the whole snapshot as one JSON document — one register, bounded by the rows it holds. */
function emitJson({ deps, snapshot }: { deps: PlansDeps; snapshot: PlanRegisterSnapshot }): void {
  deps.writeOut(JSON.stringify(snapshot));
}

/**
 * Run a read-only verb: `list`, or `validate` without a repair.
 *
 * @param deps the injected seams
 * @param invocation the parsed command line
 * @returns the process exit code
 */
async function runRead({ deps, invocation }: { deps: PlansDeps; invocation: PlansInvocation }): Promise<number> {
  const read = await deps.readRegister({ home: invocation.home });
  if (read.isErr()) {
    deps.writeDiagnostic(`plans: ${read.error.message}`);
    return EXIT_ERROR;
  }
  if (invocation.request.verb === "validate") {
    return runValidate({ deps, invocation, snapshot: read.value });
  }
  return runList({ deps, invocation, snapshot: read.value });
}

/**
 * `validate` without a repair: print what the read found, and exit non-zero only on a real finding.
 *
 * @param deps the injected seams
 * @param invocation the parsed command line
 * @param snapshot the register as it was read
 * @returns `EXIT_OK` with no finding, else `EXIT_ERROR`
 */
function runValidate({
  deps,
  invocation,
  snapshot,
}: {
  deps: PlansDeps;
  invocation: PlansInvocation;
  snapshot: PlanRegisterSnapshot;
}): number {
  if (invocation.json) {
    emitJson({ deps, snapshot });
  } else {
    planValidateLines({ snapshot }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  const findings = snapshot.diagnostics.filter((note) => note.code !== NOT_A_FINDING);
  return findings.length === 0 ? EXIT_OK : EXIT_ERROR;
}

/**
 * `list`: the table, the paid-through date each shown Codex row's sign-in states, and the judged lanes.
 *
 * @param deps the injected seams
 * @param invocation the parsed command line
 * @param snapshot the register as it was read, before any `--provider` filter
 * @returns `EXIT_EXPECTED_EMPTY` when nothing is shown, else `EXIT_OK`
 */
function runList({
  deps,
  invocation,
  snapshot,
}: {
  deps: PlansDeps;
  invocation: PlansInvocation;
  snapshot: PlanRegisterSnapshot;
}): number {
  // The lanes are a fact of the WHOLE register, so they are judged before any `--provider` filter narrows it.
  const lanes = laneShapeReadOf({ nowIso: deps.nowIso(), plans: snapshot.plans });
  if (invocation.json) {
    deps.writeOut(JSON.stringify({ ...snapshot, lanes }));
  }
  const shown = listedSnapshot({ request: invocation.request, snapshot });
  const only = invocation.request.verb === "list" ? invocation.request.provider : undefined;
  const providers: readonly PlanProvider[] = only === undefined ? ["claude", "codex"] : [only];
  if (!invocation.json) {
    const paidThroughReadings = plansForProvider({ plans: shown.plans, provider: "codex" }).map((plan) => ({
      alias: plan.alias,
      paidThrough: deps.readPaidThrough({ codexHome: plan.storeDir }),
    }));
    planListLines({ paidThroughReadings, providers, snapshot: shown }).forEach((line) => {
      deps.writeOut(line);
    });
    if (shown.plans.length > 0) {
      planLaneLines({ hosts: providers, lanes }).forEach((line) => {
        deps.writeOut(line);
      });
    }
  }
  return shown.plans.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Run a verb that publishes one change.
 *
 * @param deps the injected seams
 * @param invocation the parsed command line
 * @param mutation the single change to publish
 * @returns the process exit code
 */
async function runChange({
  deps,
  invocation,
  mutation,
}: {
  deps: PlansDeps;
  invocation: PlansInvocation;
  mutation: PlanMutation;
}): Promise<number> {
  const codexHome = addedCodexHome({ request: invocation.request });
  const ensured = codexHome === undefined ? undefined : ensureCodexHome({ deps, storeDir: codexHome });
  if (ensured?.isErr() === true) {
    deps.writeDiagnostic(ensured.error);
    return EXIT_ERROR;
  }
  const read = () => deps.readRegister({ home: invocation.home });
  const judged = await judgedRevision({ mutation, read, resolve: deps.resolveStore });
  if (judged.isErr()) {
    deps.writeDiagnostic(judged.error);
    return EXIT_ERROR;
  }
  const judgedAtRevision = judged.value;
  const published = await deps.writeRegister({ home: invocation.home, judgedAtRevision, mutation });
  if (published.isErr()) {
    deps.writeDiagnostic(`plans: ${published.error.message}`);
    syncIfRowCommitted({ codexHome, deps, error: published.error, home: invocation.home });
    return EXIT_ERROR;
  }
  if (invocation.json) {
    emitJson({ deps, snapshot: published.value });
  } else {
    const added = invocation.request.verb === "add" ? { added: invocation.request.row } : {};
    if (ensured?.isOk() === true) {
      deps.writeOut(`plans: ${ensured.value} the Codex home ${codexHome!}`);
    }
    planChangeLines({ ...added, did: didWord({ request: invocation.request }), snapshot: published.value }).forEach(
      (line) => {
        deps.writeOut(line);
      },
    );
  }
  if (codexHome === undefined) {
    return EXIT_OK;
  }
  return syncAddedCodexHome({ codexHome, deps, diagnosticsOnly: invocation.json, home: invocation.home });
}

/**
 * `sync-accounts`: read every Codex store live once, record each signed-in store's address on its row — one
 * locked change per row — and name the login for every store that is not signed in.
 *
 * A row whose change is refused (its store moved since the read, the lock was busy) is reported and the others
 * still land: each is its own exact change, and none depends on another.
 *
 * @param deps the injected seams
 * @param invocation the parsed command line
 * @returns the process exit code — non-zero only when a change that should have landed did not
 */
async function runSyncAccounts({
  deps,
  invocation,
}: {
  deps: PlansDeps;
  invocation: PlansInvocation;
}): Promise<number> {
  const read = await deps.readRegister({ home: invocation.home });
  if (read.isErr()) {
    deps.writeDiagnostic(`plans: ${read.error.message}`);
    return EXIT_ERROR;
  }
  const plans = plansForProvider({ plans: read.value.plans, provider: "codex" });
  if (plans.length === 0) {
    deps.writeOut("plans: no Codex destination is registered, so there is nothing to sync");
    return EXIT_EXPECTED_EMPTY;
  }
  const lives = deps.readLive({ codexHomes: plans.map((plan) => plan.storeDir), readAtIso: deps.nowIso() });
  // One row at a time, in order: each is its own locked change, and a concurrent pair would contend for the lock.
  const outcomes: (AccountSyncRow & { written: boolean })[] = [];
  for (const row of planAccountSync({ lives, plans })) {
    let written = false;
    if (row.update && row.liveEmail !== null) {
      const change = { alias: row.alias, email: row.liveEmail, provider: "codex", storeDir: row.storeDir } as const;
      const saved = await deps.writeRegister({ home: invocation.home, mutation: { ...change, kind: "record-email" } });
      if (saved.isErr()) {
        deps.writeDiagnostic(`plans: ${row.alias} was not updated — ${saved.error.message}`);
      }
      written = saved.isOk();
    }
    outcomes.push({ ...row, written });
  }
  if (invocation.json) {
    deps.writeOut(JSON.stringify({ accounts: outcomes }));
  } else {
    outcomes.forEach((outcome) => {
      deps.writeOut(outcome.line);
    });
  }
  return outcomes.some((outcome) => outcome.update && !outcome.written) ? EXIT_ERROR : EXIT_OK;
}

/**
 * Run one `plans` verb end to end.
 *
 * @param deps the injected seams
 * @param rest the argv tail after `plans <verb>`
 * @param verb which verb was dispatched
 * @returns the process exit code
 */
export async function runPlansVerb({
  deps,
  rest,
  verb,
}: {
  deps: PlansDeps;
  rest: readonly string[];
  verb: string;
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(plansUsage({ verb }));
    return EXIT_OK;
  }
  const parsed = parsePlansArgs({ rest, verb });
  if (parsed.isErr()) {
    const refusal = parsed.error;
    const lists =
      refusal.code === "PLANS_FLAGS_UNPARSED" ||
      refusal.code === "PLANS_USAGE_LIMIT_UNREADABLE" ||
      refusal.code === "PLANS_THRESHOLDS_UNREADABLE";
    const lines = lists ? refusal.problems : [refusal.message];
    lines.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(plansUsage({ verb }));
    return EXIT_USAGE;
  }
  if (parsed.value.request.verb === "sync-accounts") {
    return runSyncAccounts({ deps, invocation: parsed.value });
  }
  const mutation = mutationFor({ nowIso: deps.nowIso(), request: parsed.value.request });
  if (mutation === undefined) {
    return runRead({ deps, invocation: parsed.value });
  }
  return runChange({ deps, invocation: parsed.value, mutation });
}

/**
 * The real seams: two output channels, the store-backed register, and the wall clock.
 *
 * @returns the production dependencies for {@link runPlansVerb}
 */
export function productionPlansDeps(): PlansDeps {
  return plansDepsOver({ port: planRegisterPort() });
}

/**
 * The production seams over a register port the caller chooses — the real store in production, an in-memory
 * row in a test that drives the shipped verbs without a database.
 *
 * @param port where the register is read and written
 * @returns the dependencies for {@link runPlansVerb}
 */
export function plansDepsOver({ port }: { port: PlanRegisterPort }): PlansDeps {
  // An `if` that RETURNS rather than `home ?? slopweaverHome()`: the substitution of the ambient home for an
  // unspecified one is a decision a reader must see, not an operator (`no-silent-fallback`).
  const resolved = ({ home }: { home: string | undefined }): string => {
    if (home === undefined) {
      return slopweaverHome();
    }
    return home;
  };
  return {
    ensureStoreDir: ensureStoreDirLive,
    nowIso: () => new Date().toISOString(),
    readLive: readCodexAccountsLive,
    readPaidThrough: ({ codexHome }) => codexPaidThrough({ read: readCodexSubscriptionDates({ codexHome }) }),
    readRegister: ({ home }) => port.read({ home: resolved({ home }) }),
    resolveStore: resolveStoreLive,
    syncCodexPluginHome: ({ codexHome, home }) =>
      syncCodexPluginHomeLive({ checkout: runningCheckoutRoot(), codexHome, stateHome: resolved({ home }) }),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
    writeRegister: ({ home, judgedAtRevision, mutation }) =>
      port.write({
        home: resolved({ home }),
        judgedAtRevision,
        mutation,
        nowIso: new Date().toISOString(),
      }),
  };
}

/** One verb's `defineCommand`, so the exports below cannot drift from one another. */
function plansCommand({ verb }: { verb: string }): ReturnType<typeof defineCommand> {
  return defineCommand({
    run: (argv) => runPlansVerb({ deps: productionPlansDeps(), rest: argv.slice(VERB_ARG_OFFSET), verb }),
  });
}

/** `slopweaver plans adopt`. */
export const plansAdoptCommand = plansCommand({ verb: "adopt" });

/** `slopweaver plans add`. */
export const plansAddCommand = plansCommand({ verb: "add" });

/** `slopweaver plans list`. */
export const plansListCommand = plansCommand({ verb: "list" });

/** `slopweaver plans validate`. */
export const plansValidateCommand = plansCommand({ verb: "validate" });

/** `slopweaver plans pause`. */
export const plansPauseCommand = plansCommand({ verb: "pause" });

/** `slopweaver plans resume`. */
export const plansResumeCommand = plansCommand({ verb: "resume" });

/** `slopweaver plans remove`. */
export const plansRemoveCommand = plansCommand({ verb: "remove" });

/** `slopweaver plans unpin`. */
export const plansUnpinCommand = plansCommand({ verb: "unpin" });

/** `slopweaver plans clear-lapse`. */
export const plansClearLapseCommand = plansCommand({ verb: "clear-lapse" });

/** `slopweaver plans set-email`. */
export const plansSetEmailCommand = plansCommand({ verb: "set-email" });

/** `slopweaver plans set-store-dir`. */
export const plansSetStoreDirCommand = plansCommand({ verb: "set-store-dir" });

/** `slopweaver plans pin`. */
export const plansPinCommand = plansCommand({ verb: "pin" });

/** `slopweaver plans set-usage-limit`. */
export const plansSetUsageLimitCommand = plansCommand({ verb: "set-usage-limit" });

/** `slopweaver plans set-thresholds`. */
export const plansSetThresholdsCommand = plansCommand({ verb: "set-thresholds" });

/** `slopweaver plans lapse`. */
export const plansLapseCommand = plansCommand({ verb: "lapse" });

/** `slopweaver plans sync-accounts`. */
export const plansSyncAccountsCommand = plansCommand({ verb: "sync-accounts" });
