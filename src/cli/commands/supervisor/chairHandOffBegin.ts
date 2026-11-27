/**
 * The first step of `supervisor hand-off` (`./chairHandOffRun.ts`): re-read the watch fresh, refuse unless it says
 * `hand-off` or the owner passed `--now --reason`, name the outgoing chair's run and the successor's plan, and
 * journal `started` with every reason. `--now` never hands off a chair outside the desktop app.
 */
import { realpathSync } from "node:fs";

import { err, ok, type Result } from "../../../lib/result.js";
import { foldSessions, parseSessionLog } from "../../../sessions/session.js";
import { readSessionLogText } from "../../../sessions/sessionStore.js";
import { appPinLabel } from "../../../supervisor/appPin.js";
import type { ChairHandOffBasis, ChairHandOffStarted, ChairHandOffVendor } from "../../../supervisor/chairHandOff.js";
import { type ChairWatchReport, withoutAddresses } from "../../../supervisor/chairWatch.js";
import { appPredecessorLedgerRow } from "../../../supervisor/takeoverSeat.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";
import type { ChairHandOffOptions } from "./chairHandOffArgs.js";
import { type Ctx, journal, type Refusal, say } from "./chairHandOffContext.js";

/** The successor's plan as the episode journals it. */
interface SuccessorPlan {
  readonly alias: string;
  readonly vendor: ChairHandOffVendor;
  readonly override: ChairHandOffStarted["planOverride"];
}

/** A directory spelled one way, a symlinked root resolved; the literal when it cannot be resolved. */
function realDirOrLiteral({ dir }: { dir: string }): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/**
 * The watch's verdict as a refusal, or undefined when it lets the hand-off run.
 *
 * @param report the fresh watch pass
 * @param pinned the app session id the pin names
 * @param now the owner's `--now` reason, when given
 * @returns the refusal naming its override, or undefined
 */
export function watchRefusal({
  report,
  pinned,
  now,
}: {
  report: ChairWatchReport;
  pinned: string;
  now: string | undefined;
}): Refusal | undefined {
  const { chair } = report;
  if (chair.kind === "unresolved") {
    return {
      exit: EXIT_ERROR,
      line: `refused: the watch could not resolve the chair (${withoutAddresses({ text: chair.why })}); no override hands off a chair nobody can name — fix what it names, then re-run \`slopweaver supervisor chair-watch\``,
    };
  }
  if (chair.kind !== "app" || report.status === "unsupported") {
    return {
      exit: EXIT_ERROR,
      line: `refused: the chair is a ${chair.kind} chair and the control plane hands off only a desktop-app chair, which can take a \`later\` message; even --now does not — hand it off from the chair itself (\`/slopweaver:supervisor\` § Successor handoff)`,
    };
  }
  if (chair.appSessionId !== pinned) {
    return {
      exit: EXIT_DEFERRED,
      line: `not yet: the watch read chair app:${chair.appSessionId} while the pin names app:${pinned}; re-run once they agree`,
    };
  }
  if (report.status === "hand-off" || now !== undefined) {
    return undefined;
  }
  if (report.status === "stay") {
    return {
      exit: EXIT_EXPECTED_EMPTY,
      line: 'nothing to do: the watch says the chair stays; override with --now --reason "<why>"',
    };
  }
  if (report.status === "held") {
    let held = "no reason recorded";
    if (report.hold !== undefined) {
      held = withoutAddresses({ text: report.hold.reason });
    }
    return {
      exit: EXIT_ERROR,
      line: `refused: automatic hand-off is HELD (${held}); lift it with \`slopweaver supervisor hand-off release --reason "<why>"\`, or hand off anyway with --now --reason "<why>"`,
    };
  }
  return {
    exit: EXIT_DEFERRED,
    line: 'not yet: the watch could not measure the chair, so nothing is handed off on it; re-run once it measures, or hand off anyway with --now --reason "<why>" --plan <alias>',
  };
}

/**
 * The successor's plan and vendor: `--plan` over the watch's choice, the vendor from the watch's readings.
 *
 * @param report the fresh watch pass, whose readings name each plan's vendor
 * @param options the run's overrides
 * @returns the plan, or the refusal when none can be named
 */
export function successorPlan({
  report,
  options,
}: {
  report: ChairWatchReport;
  options: ChairHandOffOptions;
}): Result<SuccessorPlan, Refusal> {
  const watchAlias = report.successor?.alias;
  let alias = watchAlias;
  let override: ChairHandOffStarted["planOverride"];
  if (options.plan !== undefined) {
    alias = options.plan;
    let reason = `the owner named --plan ${options.plan}`;
    if (options.reason !== undefined) {
      reason = withoutAddresses({ text: options.reason });
    } else if (options.now !== undefined) {
      reason = withoutAddresses({ text: options.now });
    }
    override = { alias: options.plan, reason, watchAlias };
  }
  if (alias === undefined) {
    return err({
      exit: EXIT_ERROR,
      line: "refused: the watch named no successor plan with room; name one with --plan <alias>",
    });
  }
  const reading = report.readings.find((one) => one.alias === alias);
  const target = report.successor?.target;
  let vendor: ChairHandOffVendor | undefined = reading?.vendor;
  if (vendor === undefined && alias === watchAlias && target !== undefined && target.kind !== "none") {
    vendor = target.kind;
  }
  if (vendor === undefined) {
    return err({
      exit: EXIT_ERROR,
      line: `refused: plan ${alias} is not one the watch read, so its vendor is unknown; name a registered plan with --plan <alias>`,
    });
  }
  return ok({ alias, override, vendor });
}

/** The refusal for an outgoing chair whose run cannot be named. */
function unnamedRun({ why }: { why: string }): Refusal {
  return {
    exit: EXIT_ERROR,
    line: `refused: the outgoing chair's run cannot be named (${why}); takeover could not seat a successor over it either`,
  };
}

/**
 * The outgoing chair's handover slug, read off its ledger row once the app answers for it. `begin` names the run with
 * it, and `closeRow` (`./chairHandOffSeat.ts`) re-reads it so it never closes a run the chair no longer holds.
 *
 * @returns the slug, a deferral when the app does not answer for the chair, or a refusal when its run cannot be named
 */
export async function predecessorSlugOf({ ctx }: { ctx: Ctx }): Promise<Result<string, Refusal>> {
  const label = appPinLabel({ appSessionId: ctx.predecessor });
  const target = await ctx.harness.resolve({ handle: label });
  if (target.isErr()) {
    return err({
      exit: EXIT_DEFERRED,
      line: `not yet: the app does not answer for ${label} (${target.error.message}); re-run once it does`,
    });
  }
  const rows = foldSessions(parseSessionLog({ text: readSessionLogText({ home: ctx.options.home }) }));
  const row = appPredecessorLedgerRow({
    appSessionId: ctx.predecessor,
    canonicalDir: realDirOrLiteral,
    directory: target.value.session.directory,
    rows,
  });
  if (row.isErr()) {
    return err(unnamedRun({ why: row.error.message }));
  }
  if (row.value.slug === undefined) {
    return err(unnamedRun({ why: "its ledger row names no handover slug" }));
  }
  return ok(row.value.slug);
}

/** The `started` event: the basis, the predecessor's run, the successor's plan and every reason, scrubbed. */
function startedEvent({
  ctx,
  report,
  plan,
  predecessorSlug,
}: {
  ctx: Ctx;
  report: ChairWatchReport;
  plan: SuccessorPlan;
  predecessorSlug: string;
}): ChairHandOffStarted {
  let basis: ChairHandOffBasis = { kind: "auto" };
  if (ctx.options.now !== undefined) {
    basis = { kind: "now", reason: withoutAddresses({ text: ctx.options.now }) };
  }
  return {
    alias: plan.alias,
    atIso: ctx.deps.nowIso(),
    basis,
    episodeId: ctx.episodeId,
    kind: "started",
    noteWaitSeconds: ctx.options.noteWaitSeconds,
    predecessor: ctx.predecessor,
    predecessorSlug,
    reasons: report.reasons.map((reason) => withoutAddresses({ text: reason })),
    vendor: plan.vendor,
    ...(plan.override === undefined ? {} : { planOverride: plan.override }),
  };
}

/** Print why the episode started, and the plan override when there is one. */
function announceStarted({ ctx, started }: { ctx: Ctx; started: ChairHandOffStarted }): void {
  let why = `the watch says hand-off (${started.reasons.join("; ")})`;
  if (started.basis.kind === "now") {
    why = `the owner's --now (${started.basis.reason})`;
  }
  say({ ctx, line: `started ${ctx.episodeId} because ${why}; successor plan ${started.alias}` });
  const override = started.planOverride;
  if (override === undefined) {
    return;
  }
  let chose = "no plan";
  if (override.watchAlias !== undefined) {
    chose = override.watchAlias;
  }
  say({ ctx, line: `plan overridden to ${started.alias} (${override.reason}); the watch chose ${chose}` });
}

/**
 * Begin the episode: the watch's gate, the predecessor's slug, the successor's plan.
 *
 * @returns the exit code to stop with, or undefined once `started` is journalled
 */
export async function begin({ ctx }: { ctx: Ctx }): Promise<number | undefined> {
  const report = await ctx.deps.watch({ home: ctx.options.home });
  const refused = watchRefusal({ now: ctx.options.now, pinned: ctx.predecessor, report });
  if (refused !== undefined) {
    say({ ctx, line: refused.line });
    return refused.exit;
  }
  const plan = successorPlan({ options: ctx.options, report });
  if (plan.isErr()) {
    say({ ctx, line: plan.error.line });
    return plan.error.exit;
  }
  const predecessorSlug = await predecessorSlugOf({ ctx });
  if (predecessorSlug.isErr()) {
    say({ ctx, line: predecessorSlug.error.line });
    return predecessorSlug.error.exit;
  }
  const started = startedEvent({ ctx, plan: plan.value, predecessorSlug: predecessorSlug.value, report });
  if (!journal({ ctx, event: started })) {
    return EXIT_ERROR;
  }
  announceStarted({ ctx, started });
  return undefined;
}
