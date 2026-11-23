/**
 * The `claude pause` and `claude resume` shells: take one plan out of the fleet, or put it back.
 *
 * ## Why a paused plan is a ROW and not a deletion
 *
 * The obvious way to stop spending a plan is to remove it from `accounts.json`, and it is wrong twice. A
 * plan's alias IS its store directory name, and `storeService.ts` hashes that path to derive Claude Code's
 * own keychain service — so a row that leaves and comes back is a RE-ENROLLMENT, not a toggle. And a
 * deleted row takes its reason with it: the fleet would simply have four plans, with nothing anywhere
 * saying a fifth is waiting on somebody's approval.
 *
 * ## What the pause actually buys, measured
 *
 * `readRepairedGauges` probes every configured plan on EVERY spawn and attempts a repair on each refusal.
 * `plan-one`'s claude.ai subscription was paused for a bounced Airwallex charge, and its
 * store holds a setup token — which carries no refresh grant, so that repair can never succeed. The cost
 * per spawn was one round trip and one doomed repair, a red line in the routing render that no reader can
 * act on, and `acceptance: UNMEASURABLE` forever, because `acceptanceShortfall` grades the fleet unreadable
 * whenever a gauge is missing for a configured plan. Reproduce the before state on any install by pointing
 * a plan at an empty store directory and running `slopweaver claude route --model fable`.
 *
 * ## It writes the REGISTER, because that is what routing reads
 *
 * Once `plans.json` is adopted, `claude-accounts/accounts.json` is a generated projection and every reader —
 * `readSpawnAccounts`, so every spawn — takes its rows from the register. A pause written only to the
 * projection is divergence: plan-four, paused that way, still took three
 * spawns, each printing `claude routing: plan-four`. So an adopted install goes through
 * `writePlanRegister`, exactly as `plans pause --provider claude` does; only an install with no register
 * still rewrites the accounts file, because there it IS the source. Reproduce the divergence with
 * `slopweaver plans validate`, which prints `PROJECTION_DIVERGED`.
 *
 * ## This verb never decides whether the resulting config is usable
 *
 * `applyPlanPause` hands the would-be file back to `parseClaudeAccounts`, the one validating reader, and a
 * config that reader refuses is never written. So "you cannot pause the pinned plan" is stated once, there, and
 * this verb prints whatever it said. Pausing an install's last live plan is allowed: a deliberate stop, which
 * every spawn then names (`everyPlanPaused`) until a resume.
 */
import { parseClaudeAccounts, pausedPlanLine } from "../../../claude/config.js";
import type { ClaudeAccount } from "../../../claude/contracts.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { applyPlanPause, type ClaudePauseChange } from "../../../claude/pausePlan.js";
import { EMPTIED_SOURCE_PROBLEM } from "../../../claude/spawnAccounts.js";
import { slopweaverHome } from "../../../homeDir.js";
import { readJsonFile, writeJsonFile } from "../../../lib/jsonFile.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { projectClaudeRows } from "../../../plans/projection.js";
import type { PlanMutation } from "../../../plans/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { ClaudeCommandErrors, type ClaudeCommandResult, claudeCommandErrorLines } from "./errors.js";

/** Where the configured plans live, relative to the Slopweaver home. */
const ACCOUNTS_FILE = "claude-accounts/accounts.json";

/** The flags `claude pause` accepts, and the ONLY place they are named — `helpTruth` holds its usage to this. */
const PAUSE_FLAG_SPEC = { boolean: [], string: ["reason"] } as const;

/** Where a verb's own arguments start in `process.argv`: `[node, cli, claude, pause, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag `claude pause` advertises, derived from the spec it parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_PAUSE_FLAG_NAMES: readonly string[] = PAUSE_FLAG_SPEC.string.map((name) => `--${name}`);

/**
 * `claude resume` advertises no flags, and the empty list is the CLAIM rather than an omission: the ratchet
 * reads this and holds the usage line to it, so a flag added later without updating the usage fails CI.
 *
 * @internal — read by `helpTruth.test.ts`.
 */
export const CLAUDE_RESUME_FLAG_NAMES: readonly string[] = [];

/** What one `claude pause` invocation asked for. */
export interface ClaudePauseArgs {
  /** The plan to take out of the fleet. */
  readonly alias: string;
  /** What it is out for — printed by every surface that would otherwise print the provider's refusal. */
  readonly reason: string;
}

/**
 * Parse `claude pause`'s argument tail, strictly, before any configuration is read.
 *
 * `--reason` is REQUIRED and that is the whole point of the shape: a pause with no reason is the forgotten
 * pause, indistinguishable a month later from a typo nobody noticed.
 *
 * @param rest the argv tail, after `claude pause`
 * @returns the plan and the reason, or every rejection at once
 */
export function parseClaudePauseArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): ClaudeCommandResult<ClaudePauseArgs> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: PAUSE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const [alias, ...extra] = parsed.value.positionals;
  const reason = parsed.value.values["reason"];
  const problems = [
    ...(alias === undefined ? [ClaudeCommandErrors.aliasMissingForPause()] : []),
    ...(extra.length > 0 ? [ClaudeCommandErrors.extraPlans({ extra })] : []),
    ...(typeof reason === "string" && reason.length > 0 ? [] : [ClaudeCommandErrors.pauseReasonMissing()]),
  ];
  if (problems.length > 0 || alias === undefined || typeof reason !== "string") {
    return err(ClaudeCommandErrors.argumentsRefused({ problems }));
  }
  return ok({ alias, reason });
}

/**
 * Parse `claude resume`'s argument tail: one alias, and nothing else.
 *
 * @param rest the argv tail, after `claude resume`
 * @returns the plan to put back, or every rejection at once
 */
export function parseClaudeResumeArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): ClaudeCommandResult<{ alias: string }> {
  const parsed = parseFlags({ allowPositionals: true, args: rest, spec: { boolean: [], string: [] } });
  if (parsed.isErr()) {
    return err(ClaudeCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const [alias, ...extra] = parsed.value.positionals;
  const problems = [
    ...(alias === undefined ? [ClaudeCommandErrors.aliasMissingForResume()] : []),
    ...(extra.length > 0 ? [ClaudeCommandErrors.extraPlans({ extra })] : []),
  ];
  if (problems.length > 0 || alias === undefined) {
    return err(ClaudeCommandErrors.argumentsRefused({ problems }));
  }
  return ok({ alias });
}

/**
 * Publish the change through the plan register's own locked writer — the path `plans pause|resume` takes.
 *
 * It writes `plans.json` and then regenerates the projection, and it re-validates the Claude rows through
 * `parseClaudeAccounts` first, so the pinned-plan rule holds here without being restated. The read-back uses
 * the same parser, so a landed pause of an install's only plan reads back as the success it is.
 *
 * @param alias the plan to take out of the fleet, or put back
 * @param change what to do to that plan's row
 * @param home the Slopweaver home whose register is changed
 * @param port where the plan register is written — the same port the caller read it through
 * @returns the Claude accounts as published, or the register's refusal
 */
async function writeToRegister({
  alias,
  change,
  home,
  port,
}: {
  alias: string;
  change: ClaudePauseChange;
  home: string;
  port: PlanRegisterPort;
}): Promise<Result<readonly ClaudeAccount[], string>> {
  const mutation: PlanMutation =
    change.kind === "pause"
      ? { alias, kind: "pause", paused: change.paused, provider: "claude" }
      : { alias, kind: "resume", provider: "claude" };
  const published = await port.write({
    home,
    mutation,
    nowIso: new Date().toISOString(),
  });
  if (published.isErr()) {
    return err(published.error.message);
  }
  const accounts = parseClaudeAccounts({ value: projectClaudeRows({ document: published.value.document }) });
  if (accounts.isErr()) {
    return err(accounts.error.message);
  }
  return ok(accounts.value);
}

/**
 * Rewrite the Claude accounts file directly — correct ONLY while no register is adopted, when that file is
 * still the source rather than a projection of one.
 *
 * @param alias the plan to take out of the fleet, or put back
 * @param change what to do to that plan's row
 * @param home the Slopweaver home whose `claude-accounts/accounts.json` is rewritten
 * @returns the Claude accounts as written, or why nothing was
 */
function writeToAccountsFile({
  alias,
  change,
  home,
}: {
  alias: string;
  change: ClaudePauseChange;
  home: string;
}): Result<readonly ClaudeAccount[], string> {
  const path = `${home}/${ACCOUNTS_FILE}`;
  const value = readJsonFile({ path });
  // An emptied file names itself here as it does in every other reader, rather than surfacing
  // as an unknown alias the operator then hunts for.
  if (Array.isArray(value) && value.length === 0) {
    return err(ClaudeRotationErrors.accountConfigInvalid({ problems: [EMPTIED_SOURCE_PROBLEM] }).message);
  }
  const applied = applyPlanPause({ alias, change, value });
  if (applied.isErr()) {
    return err(applied.error.message);
  }
  writeJsonFile({ path, value: applied.value.rows });
  return ok(applied.value.accounts);
}

/**
 * Apply one change to an install's plans and report what the fleet now looks like.
 *
 * The write goes wherever the SOURCE is: the plan register once one is adopted, the Claude accounts file
 * only before. `home` is a PARAMETER rather than a `slopweaverHome()` read, because that is the seam a test
 * drives: the writes here are the whole behaviour, and a runner that can only ever write into the
 * operator's own home can only be tested by restating what it would have written.
 *
 * @param alias the plan to take out of the fleet, or put back
 * @param change what to do to that plan's row
 * @param home the Slopweaver home whose plans are changed
 * @param port where the plan register is read and written — one port for both, so the write lands where the read looked
 * @param verb which verb is speaking, so the refusal names the command the caller actually ran
 * @returns the process exit code
 */
export async function applyAndWrite({
  alias,
  change,
  home,
  port,
  verb,
}: {
  alias: string;
  change: ClaudePauseChange;
  home: string;
  port: PlanRegisterPort;
  verb: string;
}): Promise<number> {
  const register = await port.read({ home });
  if (register.isErr()) {
    logger.error({ msg: `claude ${verb}: ${register.error.message}` });
    return EXIT_ERROR;
  }
  const written =
    register.value.source === "registered"
      ? await writeToRegister({ alias, change, home, port })
      : writeToAccountsFile({ alias, change, home });
  if (written.isErr()) {
    logger.error({ msg: `claude ${verb}: ${written.error}` });
    return EXIT_ERROR;
  }
  const account = written.value.find((candidate) => candidate.alias === alias)!;
  const line = pausedPlanLine({ account });
  if (line === undefined) {
    logger.out({
      line:
        `${alias} is back in the fleet: it is probed, routed and counted again from the next spawn. Its ` +
        `store still holds whatever credential it held while it was out, so read it once with ` +
        `\`slopweaver claude gauge --plan ${alias}\` before trusting the fleet's acceptance grade.`,
    });
    return EXIT_OK;
  }
  logger.out({ line });
  return EXIT_OK;
}

/**
 * Take one plan out of the fleet.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudePause(argv: readonly string[]): Promise<number> {
  const args = parseClaudePauseArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (args.isErr()) {
    logger.error({ msg: `claude pause: ${claudeCommandErrorLines({ error: args.error }).join("; ")}` });
    return EXIT_USAGE;
  }
  const change: ClaudePauseChange = {
    kind: "pause",
    paused: { reason: args.value.reason, sinceIso: new Date().toISOString() },
  };
  return applyAndWrite({
    alias: args.value.alias,
    change,
    home: slopweaverHome(),
    port: planRegisterPort(),
    verb: "pause",
  });
}

/**
 * Put one paused plan back into the fleet.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudeResume(argv: readonly string[]): Promise<number> {
  const args = parseClaudeResumeArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (args.isErr()) {
    logger.error({ msg: `claude resume: ${claudeCommandErrorLines({ error: args.error }).join("; ")}` });
    return EXIT_USAGE;
  }
  return applyAndWrite({
    alias: args.value.alias,
    change: { kind: "resume" },
    home: slopweaverHome(),
    port: planRegisterPort(),
    verb: "resume",
  });
}

export const claudePauseCommand = defineCommand({ run: runClaudePause });
export const claudeResumeCommand = defineCommand({ run: runClaudeResume });
