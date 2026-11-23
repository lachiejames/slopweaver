/**
 * The `investigate` kind's executor: ask the row's question in its own channel, then brief the posted
 * message as an ask.
 *
 * Beside `./rowRunners.ts` rather than in it for the reason `./metricsPushRowRunner.ts` is: everything a
 * kind's executor needs arrives through `RecipeRunDueDeps`, so an executor is a leaf that dispatch can name,
 * and the dispatcher's file stays about dispatch.
 */

import { shellCommandLine } from "#lib/shellCommandLine.js";

import { hatchOpen } from "../../../hatch/open.js";
import { err, type Result } from "../../../lib/result.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import {
  type InvestigateOpenReport,
  type InvestigatePlan,
  investigateBriefArgv,
  investigateOpenRest,
  investigateOpenTs,
  planInvestigate,
} from "../../../live/automation/investigate.js";
import { type InvestigateError, InvestigateErrors } from "../../../live/automation/investigateErrors.js";
import { slotDeliveryKey } from "../../../live/automation/slotLedger.js";
import { appendVerbFailureWhy } from "../../../live/automation/verbFailureWhy.js";
import { defaultBriefPath } from "../../../live/turn/briefStore.js";
import { VOICE_RULES_HATCH } from "../../../outbound/voice/exactRules.js";
import { EXIT_OK } from "../../exitCodes.js";
import { notePosting } from "./cardPostingNote.js";
import { admitScheduledPostTarget } from "./postTargetLeg.js";
import type { RecipeRunDueDeps, RowOutcome } from "./rowRunners.js";

/**
 * Ask one `investigate` row's question out loud, and answer where it landed.
 *
 * The post goes through the ordinary `slack post` door as the bot. Its `--json` document is the only thing
 * read back, and it is refused rather than guessed at: a tick that invented an address would brief an ask
 * against a message nobody can find.
 *
 * @param deps the injected edges
 * @param dryRun whether to go down the real send path and stop at the wire
 * @param home the state home this tick is running over
 * @param plan the resolved plan
 * @returns where the question landed, or the error saying why it was never asked — with what the post wrote to
 *   stderr, which only a failed ending's line closes on
 */
async function askInvestigateQuestion({
  deps,
  dryRun,
  home,
  plan,
  idempotencyKey,
}: {
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  home: string;
  plan: InvestigatePlan;
  /** The firing's own delivery id, so the door refuses a second delivery of one firing. */
  idempotencyKey: string;
}): Promise<{ readonly asked: Result<InvestigateOpenReport, InvestigateError>; readonly diagnostics: string }> {
  const posted = await deps.runSlackPost({ rest: investigateOpenRest({ dryRun, home, idempotencyKey, plan }) });
  if (posted.exitCode !== EXIT_OK) {
    const why = `slack post --as bot exited ${String(posted.exitCode)}`;
    return {
      asked: err(InvestigateErrors.postFailed({ channel: plan.channel, recipeId: plan.recipeId, why })),
      diagnostics: posted.diagnostics,
    };
  }
  // `--json` emits the whole report in ONE write, exactly as `--form` does on the read legs above, so
  // anything else on that channel means the document this leg read and the one the door wrote differ.
  const document = posted.lines.length === 1 ? posted.lines[0] : undefined;
  if (document === undefined) {
    return {
      asked: err(
        InvestigateErrors.reportUnreadable({
          recipeId: plan.recipeId,
          why: `slack post emitted ${String(posted.lines.length)} document(s) on stdout, expected exactly 1`,
        }),
      ),
      diagnostics: posted.diagnostics,
    };
  }
  // A zero exit whose report names no message is still this leg's failure, so its stderr rides along; the line
  // reads it only on a failed ending.
  return { asked: investigateOpenTs({ document, recipeId: plan.recipeId }), diagnostics: posted.diagnostics };
}

/**
 * What the ask leg settled to: the posted question's `ts`, or the outcome to print instead of briefing it.
 *
 * Three endings the briefing step must not be reached through, kept together because each is a different
 * reason the same next step cannot happen: the ask failed, the run was a dry one that deliberately stopped
 * at the wire, or the door reported success with no message to brief. The last is the one worth naming —
 * a brief pointed at a message that does not exist is an ask nobody can ever answer.
 *
 * @param asked what the ask leg answered
 * @param base the shared not-yet-run outcome fields
 * @param diagnostics what the post wrote to stderr, closing an ASK FAILED line as its why
 * @param dryRun whether the send was withheld at the wire
 * @param plan the resolved plan, for the channel and preview a stopped run reports
 * @returns the message to brief, or the outcome that ends the row here
 */
function settledAskTs({
  asked,
  base,
  diagnostics,
  dryRun,
  plan,
}: {
  asked: Result<InvestigateOpenReport, InvestigateError>;
  base: Omit<RowOutcome, "line">;
  diagnostics: string;
  dryRun: boolean;
  plan: InvestigatePlan;
}): { readonly messageTs: string } | { readonly outcome: RowOutcome } {
  if (asked.isErr()) {
    return {
      outcome: {
        ...base,
        failed: true,
        line: appendVerbFailureWhy({
          diagnostics,
          line: `recipe ${plan.recipeId} · ASK FAILED · ${asked.error.message} · nothing was asked`,
        }),
      },
    };
  }
  if (dryRun) {
    return {
      outcome: {
        ...base,
        line: `recipe ${plan.recipeId} · would ask · #${plan.channel} · ${asked.value.preview.join(" ⏎ ")}`,
      },
    };
  }
  const messageTs = asked.value.ts;
  if (messageTs === null) {
    return {
      outcome: {
        ...base,
        failed: true,
        line: appendVerbFailureWhy({
          diagnostics,
          line: `recipe ${plan.recipeId} · ASK FAILED · the door reported no sent message · nothing was asked`,
        }),
      },
    };
  }
  return { messageTs };
}

/**
 * Run one `investigate` row: ask its question in its own channel, then brief the posted message as an ask.
 *
 * ## It stops at the brief, and that is the whole point
 *
 * `turn brief` captures the ask onto `asks.jsonl` and writes the brief a routing judgement is composed
 * against. What happens next — inline, a read-only subagent, a fresh visible session — is the ask lane's
 * own decision, taken by a session the owner can see (doctrine rule 2). This tick
 * never spawns a model, and the row it just created is indistinguishable from a tag by every verb below it.
 *
 * ## A posted question with a failed brief still counts as RUN
 *
 * The message is in the channel. Reporting the row as not-run would leave it due, and the next tick would
 * ask the same question again — so the outcome carries `ran` with the brief's own exit code, which is what
 * `./runDue.ts` stamps on, and `failed` so the tick's exit code still says something went wrong. The line
 * names the exact `turn brief` to re-run by hand; nothing here retries.
 *
 * @param definition the due row
 * @param deps the injected edges
 * @param dryRun whether to withhold the question at the wire
 * @param home the state home this tick is running over
 * @param base the shared not-yet-run outcome fields
 * @returns what happened, ready to print
 */
export async function runInvestigateRow({
  definition,
  deps,
  dryRun,
  home,
  base,
  slotIso,
}: {
  definition: RecipeDefinition;
  deps: RecipeRunDueDeps;
  dryRun: boolean;
  home: string;
  base: Omit<RowOutcome, "line">;
  /** The cadence firing this run covers — what every write leg delivers under. */
  slotIso: string;
}): Promise<RowOutcome> {
  const plan = planInvestigate({
    definition,
    promptChannel: deps.promptChannel({ home }),
    voiceOverridden: hatchOpen({ env: deps.doorEnv(), home, id: VOICE_RULES_HATCH, nowIso: new Date().toISOString() }),
  });
  if (plan.isErr()) {
    return { ...base, failed: true, line: `recipe ${definition.recipeId} · REFUSED · ${plan.error.message}` };
  }
  // The QUESTION goes to the owner's DM and the ANSWER goes there too. `plan.channel` is already the DM
  // by that rule, so the only thing left to admit is the audience the row named for the finished
  // card. The resolved value is deliberately NOT written back over `postTo`: an absent one means "stays
  // where it was asked", and spelling the DM into it would put a redundant destination line on a message
  // whose whole budget is one no-fold question.
  const shareTo = admitScheduledPostTarget({
    definition,
    dmChannel: deps.promptChannel({ home }),
    requested: plan.value.postTo,
    where: "params.postTo",
  });
  if ("refusal" in shareTo) {
    return { ...base, failed: true, line: shareTo.refusal };
  }
  const { asked, diagnostics } = await askInvestigateQuestion({
    deps,
    dryRun,
    home,
    idempotencyKey: slotDeliveryKey({ recipeId: definition.recipeId, slotIso }),
    plan: plan.value,
  });
  const settled = settledAskTs({ asked, base, diagnostics, dryRun, plan: plan.value });
  if ("outcome" in settled) {
    return settled.outcome;
  }
  notePosting({
    channel: plan.value.channel,
    deps,
    home,
    recipeId: definition.recipeId,
    slotIso,
    ts: settled.messageTs,
  });
  return briefInvestigateAsk({ base, deps, home, messageTs: settled.messageTs, plan: plan.value });
}

/**
 * Brief an already-posted question as an ask, and report the one command the supervisor takes next.
 *
 * @param base the shared not-yet-run outcome fields
 * @param deps the injected edges
 * @param home the state home this tick is running over
 * @param messageTs the posted message's own ts — the ask's address
 * @param plan the resolved plan
 * @returns what happened, ready to print
 */
async function briefInvestigateAsk({
  base,
  deps,
  home,
  messageTs,
  plan,
}: {
  base: Omit<RowOutcome, "line">;
  deps: RecipeRunDueDeps;
  home: string;
  messageTs: string;
  plan: InvestigatePlan;
}): Promise<RowOutcome> {
  const argv = investigateBriefArgv({ home, messageTs, plan });
  const { diagnostics, exitCode: briefed } = await deps.runVerbKeepingDiagnostics(argv);
  const ask = `${plan.channel}/${messageTs}`;
  if (briefed !== EXIT_OK) {
    return {
      ...base,
      exitCode: briefed,
      failed: true,
      line: appendVerbFailureWhy({
        diagnostics,
        line:
          `recipe ${plan.recipeId} · ASKED, NOT BRIEFED · ${ask} · turn brief exited ${String(briefed)} · ` +
          `the question is posted; brief it by hand: ${shellCommandLine({ command: argv.slice(1) })}`,
      }),
      ran: true,
    };
  }
  const briefPath = defaultBriefPath({ askIdentity: { channel: plan.channel, messageTs, threadTs: messageTs }, home });
  return {
    ...base,
    exitCode: briefed,
    line: `recipe ${plan.recipeId} · asked · ${ask} · in the ask lane · judge it and dispatch: ${briefPath}`,
    ran: true,
  };
}
