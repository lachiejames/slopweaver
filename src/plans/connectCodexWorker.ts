/**
 * The Codex Connect worker: hold the sign-in an attempt started, then register the plan and finish the record. Runs in
 * the background, launched by `./connectCodex.ts`'s `startCodexConnect`.
 *
 * Every effect arrives through {@link CodexConnectDeps}; the record moves are `./connectCodexRecord.ts`, whether the
 * store is the worker's own is `./connectCodexStore.ts`, and the pure decisions are `./connectPlan.ts` and
 * `../codex/loginExchangeParse.ts`.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";
import { err, type Result } from "#lib/result.js";

import { parseCodexLoginExchange } from "../codex/loginExchangeParse.js";

import {
  CONNECT_SIGN_IN_MS,
  type CodexConnectDeps,
  finished,
  isoAt,
  whileCurrent,
  writeHeld,
  writeIfCurrent,
} from "./connectCodexRecord.js";
import { removeOwnStore, storeIsConnects } from "./connectCodexStore.js";
import type { ConnectionFailure, PlanConnection } from "./connection.js";
import { type PlanConnectionError, PlanConnectionErrors, registerReason } from "./connectionErrors.js";
import { clearConnectionMarkers, connectionMarkerPaths, readPlanConnection } from "./connectionStore.js";
import { codexConnectRegistration } from "./connectPlan.js";
import type { PlanRegisterError } from "./errors.js";

/**
 * The worker: hold the sign-in an attempt started, then register the plan and finish the record.
 *
 * @param deps the injected effects
 * @param home the Slopweaver home
 * @param id the attempt to finish
 * @returns the finished record, or why the worker could not take the attempt up
 */
export async function runCodexConnectWorker({
  deps,
  home,
  id,
}: {
  deps: CodexConnectDeps;
  home: string;
  id: string;
}): Promise<Result<PlanConnection, PlanConnectionError>> {
  const read = readPlanConnection({ home, host: "codex" });
  if (read.isErr()) {
    return err(read.error);
  }
  const started = read.value;
  if (started?.id !== id || started.phase !== "starting") {
    return err(PlanConnectionErrors.notFound({ id }));
  }
  const owned = await storeIsConnects({ connection: started, deps, home });
  if (owned.isErr()) {
    return err(owned.error);
  }
  const signed = await signIn({ connection: started, deps, home });
  // Registering and the final record happen under the lock and only while this attempt is still the record, so an
  // attempt a later Connect replaced registers nothing. Whether `settle` ran decides who owns the store afterwards.
  const progress = { settled: false };
  const final = await whileCurrent({
    act: async ({ lock }) => {
      progress.settled = true;
      const end = await settle({ deps, home, signed });
      return writeHeld({ connection: end, home, lock }).map(() => end);
    },
    deps,
    home,
    id,
  });
  if (final.isErr() && !progress.settled) {
    // Nothing was registered for this attempt, so its fresh store is nobody's plan. Its record is not this worker's to
    // write any more, so a removal that fails is named in the error the worker ends on rather than lost.
    const removed = await removeOwnStore({ alias: started.alias, deps, home, id, storeDir: started.storeDir });
    if (removed.isErr()) {
      clearConnectionMarkers({ home, id });
      return err(
        PlanConnectionErrors.storeLeft({
          cause: final.error,
          removal: removed.error.message,
          storeDir: started.storeDir,
        }),
      );
    }
  }
  clearConnectionMarkers({ home, id });
  return final;
}

/**
 * How long before its deadline an attempt still registers: a minute, against a register write the console allows
 * twenty seconds (`site/lib/actVerbsPlans.ts`), and inside the two-minute margin past the sign-in window
 * (`./connectCodex.ts`), so an attempt whose sign-in ends on time always has it.
 */
const REGISTER_HEADROOM_MS = 60 * 1000;

/** Where a sign-in ended: at an end of its own, or signed in and waiting to be registered. */
type SignInEnd =
  | { readonly kind: "ended"; readonly connection: PlanConnection }
  | { readonly kind: "signed-in"; readonly connection: PlanConnection; readonly email: string | undefined };

/**
 * Register a signed-in plan and answer the record to store. The store is fresh — `startCodexConnect` created it
 * exclusively — so it belongs to this attempt alone, and every end but `connected` removes it: a store
 * left behind would hold the next Connect off its alias, and a cancelled or failed one is never a plan.
 */
async function settle({
  deps,
  home,
  signed,
}: {
  deps: CodexConnectDeps;
  home: string;
  signed: SignInEnd;
}): Promise<PlanConnection> {
  const final =
    signed.kind === "ended"
      ? signed.connection
      : await register({ connection: signed.connection, deps, email: signed.email });
  if (final.phase === "connected") {
    return final;
  }
  const removed = await removeOwnStore({ alias: final.alias, deps, home, id: final.id, storeDir: final.storeDir });
  if (removed.isOk()) {
    return final;
  }
  // The end stands as it is; a store left behind only moves the next Connect to the next alias. Its words go on the
  // record so the leftover is findable, after whatever the end already said.
  const left = `${final.storeDir} was left behind: ${removed.error.message}`;
  return { ...final, detail: final.detail === undefined ? left : `${final.detail}; ${left}` };
}

/** The sign-in on a fresh store this attempt makes, ending before anything is registered. */
async function signIn({
  connection,
  deps,
  home,
}: {
  connection: PlanConnection;
  deps: CodexConnectDeps;
  home: string;
}): Promise<SignInEnd> {
  const ended = (end: PlanConnection): SignInEnd => ({ connection: end, kind: "ended" });
  // The store already exists: the start reserved it, exclusively, before it wrote this record.
  const browser: PlanConnection = { ...connection, phase: "browser", updatedAtIso: isoAt({ ms: deps.nowMs() }) };
  const shown = await writeIfCurrent({ connection: browser, deps, home });
  if (shown.isErr() && shown.error.code === "CONNECTION_SUPERSEDED") {
    // A later Connect already replaced this attempt, so its sign-in is nobody's to finish.
    return ended(
      finished({ connection: browser, detail: shown.error.message, failure: "EXITED", nowMs: deps.nowMs() }),
    );
  }
  // Any other failure of this write is progress only, deliberately: the sign-in still runs and its end is written under
  // the lock, so a reader that missed `browser` sees `starting` until then. Abandoning a sign-in the owner may already
  // be completing because a progress note could not be written would be the worse failure.
  const paths = connectionMarkerPaths({ home, id: connection.id });
  const run = deps.runSignIn({
    cancelPath: paths.cancel,
    codexHome: connection.storeDir,
    deadlineMs: CONNECT_SIGN_IN_MS,
    signInUrlPath: paths.signInUrl,
  });
  const latest = readPlanConnection({ home, host: "codex" });
  const withUrl = latest.isOk() && latest.value?.id === connection.id ? latest.value : browser;
  if (run.kind === "cli-missing") {
    return ended(finished({ connection: withUrl, detail: run.reason, failure: "CLI_MISSING", nowMs: deps.nowMs() }));
  }
  if (run.kind === "not-run") {
    return ended(finished({ connection: withUrl, detail: run.reason, failure: "EXITED", nowMs: deps.nowMs() }));
  }
  const outcome = parseCodexLoginExchange({ lines: run.lines });
  if (outcome.kind === "cancelled") {
    return ended({ ...withUrl, phase: "cancelled", updatedAtIso: isoAt({ ms: deps.nowMs() }) });
  }
  if (outcome.kind === "failed") {
    return ended(
      finished({ connection: withUrl, detail: outcome.detail, failure: outcome.failure, nowMs: deps.nowMs() }),
    );
  }
  return { connection: withUrl, email: outcome.email, kind: "signed-in" };
}

/**
 * Whether a register write that answered an error committed its row all the same. `PROJECTION_WRITE_FAILED` is that
 * case by contract (`registerCommitted: true`, `./errors.ts`): the row is in and only a generated file lagged, which
 * `plans validate --repair-projection` regenerates. Read as a failure, the worker would remove the store a committed
 * row now names.
 */
function committedAnyway({ error }: { error: PlanRegisterError }): boolean {
  return error.code === "PROJECTION_WRITE_FAILED";
}

/** A failed register step as a record's detail: the closed clause, never the register's own message. */
function notRegistered({ error }: { error: PlanRegisterError }): string {
  return `${registerReason({ error })}, so nothing was registered`;
}

/** Write the signed-in plan into the register and answer the finished record. */
async function register({
  connection,
  deps,
  email,
}: {
  connection: PlanConnection;
  deps: CodexConnectDeps;
  email: string | undefined;
}): Promise<PlanConnection> {
  const failedWith = ({ detail, failure }: { detail: string; failure: ConnectionFailure }): PlanConnection =>
    finished({ connection, detail, failure, nowMs: deps.nowMs() });
  // A reader judges an active record past its deadline INTERRUPTED (`connectionAsOf`) without writing that down, so a
  // worker that resumes late — suspended, or slowed — must not turn that reported end into a plan. It registers only
  // with REGISTER_HEADROOM_MS still to run, far more than the register write takes, and otherwise ends where a
  // reader already says it ended.
  const deadlineMs = parseStrictIsoInstantMs({ text: connection.deadlineAtIso })!;
  if (deps.nowMs() + REGISTER_HEADROOM_MS >= deadlineMs) {
    return failedWith({ detail: "the attempt reached its deadline before it was registered", failure: "INTERRUPTED" });
  }
  const read = await deps.readRegister();
  if (read.isErr()) {
    return failedWith({ detail: notRegistered({ error: read.error }), failure: "REGISTER_FAILED" });
  }
  const destination = { alias: connection.alias, storeDir: connection.storeDir };
  const plan = codexConnectRegistration({ destination, email, snapshot: read.value });
  if (plan.kind === "refuse") {
    return failedWith({ detail: plan.detail, failure: plan.failure });
  }
  if (plan.adopt) {
    const adopted = await deps.writeRegister({ mutation: { kind: "adopt" } });
    if (adopted.isErr() && !committedAnyway({ error: adopted.error })) {
      return failedWith({ detail: notRegistered({ error: adopted.error }), failure: "REGISTER_FAILED" });
    }
  }
  const changed = await deps.writeRegister({ mutation: plan.change });
  if (changed.isErr() && !committedAnyway({ error: changed.error })) {
    return failedWith({ detail: notRegistered({ error: changed.error }), failure: "REGISTER_FAILED" });
  }
  return {
    ...connection,
    phase: "connected",
    updatedAtIso: isoAt({ ms: deps.nowMs() }),
    ...(email === undefined ? {} : { email }),
    ...(changed.isErr() ? { detail: registerReason({ error: changed.error }) } : {}),
  };
}
