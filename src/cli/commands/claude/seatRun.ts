/**
 * `slopweaver claude seat` — is this Claude session booted on one of the configured plans, and if not, refuse its
 * turn. The spawn half of the owner's ask; the judgement is `claude/seatAttest.ts`.
 *
 * ## Two callers, two exit contracts
 *
 * By hand, `--session <id>` prints the verdict and exits 1 on a refusal, the policy-refusal convention.
 *
 * As the `UserPromptSubmit` hook, `--from-payload` reads the harness's JSON on stdin and ALWAYS exits 0. A refusal is
 * the one stdout line {@link hookBlockLine} writes — `{"decision":"block","reason":…}`, which Claude Code reads as
 * "erase this prompt and show the human the reason", before a single request is made. The refusal is never spelled
 * as exit 2, because exit 2 is not only ours to spell: `cli/main.ts` answers a noun with an unknown verb with
 * `EXIT_USAGE`, which is 2, so a seat whose `hooks.json` carries this entry while its CLI predates the verb would have
 * every prompt blocked on a usage banner. `hooks/hooks.json` ends the entry `|| true` for the same reason. A pass
 * prints nothing on stdout, which this event would add to the model's context, unless the session's context lacks
 * their profile: then the one line is their profile as `additionalContext` (`./seatProfile.ts`). `scripts/hook.sh` bounds the whole
 * run and releases the prompt on a timeout, so a hang costs seconds, never a wedged session.
 *
 * ## Two gates, and only one of them has a hatch
 *
 * The identity gate refuses a seat off every plan, and `unrouted-seat` overrides it. A seat ON a plan whose usage
 * limit is below 100 then meets the per-turn usage gate (`../../../claude/seatUsageGate.ts`, read by
 * `./seatUsageRead.ts`), which holds the prompt at the owner's limit or when no recent reading says the plan is under
 * it. That hold goes through {@link seatUsageOutcome}, which accepts no hatch argument at all, so nothing that
 * releases the identity gate can release it. A plan at 100% reads nothing and passes exactly as before.
 */
import { z } from "zod";

import { resolveAmbientCredential } from "../../../claude/ambientCredentialRead.js";
import {
  judgeSeat,
  refusesTurn,
  type SeatReading,
  type SeatVerdict,
  seatRemedyLines,
  seatVerdictLine,
} from "../../../claude/seatAttest.js";
import { readOwnSeat } from "../../../claude/seatAttestRead.js";
import { type SeatPassCachePolicy, seatPassPath, seatPassWrite } from "../../../claude/seatPass.js";
import { removeSeatPasses, writeDatedSeatPass } from "../../../claude/seatPassMarker.js";
import { type ClaudeSeatUsageRefusal, seatUsageHoldLines } from "../../../claude/seatUsageGate.js";
import { type ClaudeFleetRead, readClaudeFleet } from "../../../claude/spawnAccounts.js";
import { slopweaverHome } from "../../../config.js";
import { type DeliveryContext, deliveryContextOf } from "../../../context/profileDelivery.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchOpen } from "../../../hatch/open.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok } from "../../../lib/result.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import type { PlanAllowance, UsageLimitPercent } from "../../../plans/usageLimit.js";
import { stateHomePaths } from "../../../stateHome.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { ClaudeCommandErrors, type ClaudeCommandResult, claudeCommandErrorLines } from "./errors.js";
import { markPromptDelivery, promptProfile } from "./seatProfile.js";
import { judgeSeatUsage, type SeatUsageJudgement, seatPassCacheFor } from "./seatUsageRead.js";

/** The flags this verb accepts, and the ONLY place they are named. */
const SEAT_FLAG_SPEC = { boolean: ["from-payload"], string: ["session"] } as const;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, seat, …]`. */
const VERB_ARG_OFFSET = 4;

/**
 * The stdout line Claude Code reads, on `UserPromptSubmit`, as "erase this prompt and show the human the reason".
 *
 * @param reason what the human reads in place of a turn
 * @returns one JSON line
 */
export function hookBlockLine({ reason }: { reason: string }): string {
  return JSON.stringify({ decision: "block", reason });
}

/** The ambient variable the `unrouted-seat` row declares, spelled so `escape-hatch` can see the read. */
const ALLOW_UNROUTED_SEAT_ENV = "SLOPWEAVER_ALLOW_UNROUTED_SEAT";

/**
 * Every flag this verb advertises, derived from the spec it parses with.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_SEAT_FLAG_NAMES: readonly string[] = [
  ...SEAT_FLAG_SPEC.string.map((name) => `--${name}`),
  ...SEAT_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** Which session to judge, and for which caller. */
export type SeatArgs = { readonly mode: "hand"; readonly sessionId: string } | { readonly mode: "hook" };

/**
 * Parse this verb's own argument tail, strictly.
 *
 * @param rest the argv tail, after `claude seat`
 * @returns the session to judge by hand, or the hook mode, or every rejection at once
 */
export function parseClaudeSeatArgs({ rest }: { rest: readonly string[] }): ClaudeCommandResult<SeatArgs> {
  const parsed = parseFlags({ args: rest, spec: SEAT_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const session = parsed.value.values["session"];
  const fromPayload = parsed.value.values["from-payload"] === true;
  if (fromPayload && typeof session === "string") {
    return err(ClaudeCommandErrors.argumentsRefused({ problems: [ClaudeCommandErrors.seatModesExclusive()] }));
  }
  if (fromPayload) {
    return ok({ mode: "hook" });
  }
  if (typeof session !== "string" || session.trim() === "") {
    return err(ClaudeCommandErrors.argumentsRefused({ problems: [ClaudeCommandErrors.seatSessionMissing()] }));
  }
  return ok({ mode: "hand", sessionId: session.trim() });
}

/** The one field of a `UserPromptSubmit` payload this verb reads. */
const SEAT_PAYLOAD = z.object({ session_id: z.string().min(1) });

/**
 * Read the session id out of a `UserPromptSubmit` payload, and the context a profile carried into its prompt reaches.
 *
 * @param raw the payload exactly as the harness wrote it to stdin
 * @returns the session id and its delivery context (`undefined` for an id no marker can be keyed on), or why the
 *   payload names no session
 */
export function parseSeatPayload({
  raw,
}: {
  raw: string;
}): ClaudeCommandResult<{ sessionId: string; delivery: DeliveryContext | undefined }> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error: unknown) {
    return err(ClaudeCommandErrors.seatPayloadNotJson({ cause: error }));
  }
  const parsed = SEAT_PAYLOAD.safeParse(json);
  if (!parsed.success) {
    return err(ClaudeCommandErrors.seatPayloadSessionMissing());
  }
  return ok({ delivery: deliveryContextOf({ payload: json }), sessionId: parsed.data.session_id });
}

/** What one run prints, and the code it exits with. */
export interface SeatOutcome {
  readonly code: number;
  /** Lines for stderr. */
  readonly lines: readonly string[];
  /** Lines for stdout: only ever a hook's block decision. */
  readonly stdout: readonly string[];
}

/**
 * Decide the exit code and the lines, from the verdict and whether the hatch is open.
 *
 * @param verdict the session's verdict
 * @param mode which caller asked, which decides how a refusal is spelled and whether a pass prints
 * @param hatchIsOpen whether `unrouted-seat` is open for this session
 * @returns what to print and the code to exit with
 */
export function seatOutcome({
  verdict,
  mode,
  hatchIsOpen,
}: {
  verdict: SeatVerdict;
  mode: SeatArgs["mode"];
  hatchIsOpen: boolean;
}): SeatOutcome {
  const line = seatVerdictLine({ verdict });
  if (!refusesTurn(verdict)) {
    return { code: EXIT_OK, lines: mode === "hand" ? [line] : [], stdout: [] };
  }
  if (hatchIsOpen) {
    return {
      code: EXIT_OK,
      lines: [`${line} — OVERRIDDEN by ${ALLOW_UNROUTED_SEAT_ENV}, so this turn proceeds`],
      stdout: [],
    };
  }
  // The refusal's detail already carries the verdict's `why`, so the verdict line is not repeated under it.
  const refusal = [
    ...hatchRefusalLines({ detail: verdict.why, hatch: hatchFor({ id: "unrouted-seat" }) }),
    ...seatRemedyLines({ verdict }),
  ];
  if (mode === "hook") {
    return { code: EXIT_OK, lines: [], stdout: [hookBlockLine({ reason: refusal.join("\n") })] };
  }
  return { code: EXIT_ERROR, lines: refusal, stdout: [] };
}

/**
 * The outcome of a prompt the per-turn usage gate holds. It takes NO hatch: `unrouted-seat` releases an identity
 * refusal and nothing else, and the owner's usage limit has no override (`../../../claude/seatUsageGate.ts`).
 *
 * @param allowance the plan's allowance, which decides the remedy the hold names
 * @param mode which caller asked, which decides how the hold is spelled
 * @param refusal the usage gate's refusal
 * @param usageLimitPercent the plan's usage limit
 * @returns what to print and the code to exit with
 */
export function seatUsageOutcome({
  allowance,
  mode,
  refusal,
  usageLimitPercent,
}: {
  allowance: PlanAllowance;
  mode: SeatArgs["mode"];
  refusal: ClaudeSeatUsageRefusal;
  usageLimitPercent: UsageLimitPercent;
}): SeatOutcome {
  const hold = seatUsageHoldLines({ allowance, usageLimitPercent, verdict: refusal });
  if (mode === "hook") {
    return { code: EXIT_OK, lines: [], stdout: [hookBlockLine({ reason: hold.join("\n") })] };
  }
  return { code: EXIT_ERROR, lines: hold, stdout: [] };
}

/** One seat read: what the boot credential established, and the register it was judged against when one was read. */
interface SeatRead {
  readonly reading: SeatReading;
  /** Present only when the register read and named Claude plans — the same revision the reading was judged against. */
  readonly fleet?: {
    readonly accounts: NonNullable<ClaudeFleetRead["accounts"]>;
  };
}

/**
 * Read one session's boot credential against this install's plans.
 *
 * @param home the state home the register lives under
 * @param sessionId the session to read
 * @param port where the plan register is read
 * @returns what the read established, and the plans it was read against
 */
async function readSeat({
  home,
  port,
  sessionId,
}: {
  home: string;
  port: PlanRegisterPort;
  sessionId: string;
}): Promise<SeatRead> {
  const fleet = await readClaudeFleet({ home, port });
  if (fleet.isErr()) {
    return { reading: { kind: "unread", why: `the plan register could not be read: ${fleet.error.message}` } };
  }
  const { accounts } = fleet.value;
  if (accounts === undefined) {
    return { reading: { kind: "unconfigured" } };
  }
  const reading = readOwnSeat({ accounts, claudeHome: claudeHomeDir(), sessionId });
  return { fleet: { accounts }, reading };
}

/**
 * Judge the seat's usage when its identity put it on a plan; any other verdict is the identity gate's alone.
 *
 * @param home the state home
 * @param nowIso the instant of the prompt
 * @param seat the seat read
 * @param verdict the identity verdict
 * @returns the usage judgement, `unlimited` whenever there is no on-plan seat to judge
 */
function usageOf({
  home,
  nowIso,
  seat,
  verdict,
}: {
  home: string;
  nowIso: string;
  seat: SeatRead;
  verdict: SeatVerdict;
}): SeatUsageJudgement {
  if (verdict.kind !== "on-plan" || seat.fleet === undefined) {
    return { kind: "unlimited" };
  }
  return judgeSeatUsage({ accounts: seat.fleet.accounts, alias: verdict.alias, home, nowIso });
}

/**
 * The session this invocation judges: named by hand, or read from the hook's payload on stdin.
 *
 * @param args the parsed verb arguments
 * @returns the session and, from a hook, its delivery context; undefined when the payload could not be read, which
 *   is said on stderr and never blocks the prompt
 */
async function seatSession({
  args,
}: {
  args: SeatArgs;
}): Promise<{ sessionId: string; delivery: DeliveryContext | undefined } | undefined> {
  if (args.mode === "hand") {
    return { delivery: undefined, sessionId: args.sessionId };
  }
  const payload = parseSeatPayload({ raw: await readStdin() });
  if (payload.isErr()) {
    // Never a block: a payload we cannot read is our defect, and blocking on it would block every prompt.
    logger.error({
      msg: `claude seat: ${claudeCommandErrorLines({ error: payload.error }).join("; ")} — this prompt was not judged`,
    });
    return undefined;
  }
  return { delivery: payload.value.delivery, sessionId: payload.value.sessionId };
}

/**
 * Judge a session and refuse its turn when it is off every plan.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
async function runClaudeSeat(argv: readonly string[]): Promise<number> {
  const parsed = parseClaudeSeatArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    logger.error({ msg: `claude seat: ${claudeCommandErrorLines({ error: parsed.error }).join("; ")}` });
    return EXIT_USAGE;
  }
  const session = await seatSession({ args: parsed.value });
  if (session === undefined) {
    return EXIT_OK;
  }
  const { delivery, sessionId } = session;
  const home = slopweaverHome();
  const nowIso = new Date().toISOString();
  const seat = await readSeat({ home, port: planRegisterPort(), sessionId });
  const { reading } = seat;
  const verdict = judgeSeat({ ambient: resolveAmbientCredential(), reading });
  const usage = usageOf({ home, nowIso, seat, verdict });
  let outcome: SeatOutcome;
  if (usage.kind === "limited" && usage.verdict.kind !== "open") {
    const { allowance, usageLimitPercent } = usage;
    outcome = seatUsageOutcome({ allowance, mode: parsed.value.mode, refusal: usage.verdict, usageLimitPercent });
  } else {
    const hatchIsOpen = hatchOpen({ env: process.env, id: "unrouted-seat", nowIso });
    outcome = seatOutcome({ hatchIsOpen, mode: parsed.value.mode, verdict });
  }
  for (const line of outcome.lines) {
    logger.error({ msg: line });
  }
  for (const line of outcome.stdout) {
    logger.out({ line });
  }
  if (parsed.value.mode === "hook") {
    rememberPass({ cache: seatPassCacheFor({ usage }), judgedAtIso: nowIso, reading, sessionId, verdict });
    // A refused prompt is erased, so only a passing one carries their profile in; one stdout line either way.
    if (outcome.stdout.length === 0 && delivery !== undefined) {
      await carryProfileIn({ delivery, sessionId });
    }
  }
  return outcome.code;
}

/**
 * Print their profile into a passing prompt whose session lacks it (`./seatProfile.ts`), then mark it delivered. A throw
 * is said on stderr and costs nothing else: the PreToolUse hold still guards every call the turn makes.
 *
 * @param sessionId the session the payload named
 * @param delivery the context its marker is read and written for
 */
async function carryProfileIn({
  sessionId,
  delivery,
}: {
  sessionId: string;
  delivery: DeliveryContext;
}): Promise<void> {
  try {
    const home = slopweaverHome();
    const carried = await promptProfile({ delivery, home, sessionId });
    if (carried.line !== undefined) {
      logger.out({ line: carried.line });
      markPromptDelivery({ deliversTo: carried.deliversTo, home });
    }
  } catch (error: unknown) {
    logger.error({ msg: `claude seat: their profile was not carried into this prompt (${String(error)})` });
  }
}

/**
 * Leave the cached pass `bin/slopweaver` answers the next prompt from, when this judgement earns one. A failed
 * write costs the next prompt a full check and is said on stderr; it never changes this prompt's outcome.
 *
 * A judgement that earns NO pass removes any marker the session already has, best effort, so a pass cached before a
 * plan reached its usage limit cannot outlive that by an odd mtime or a hand-edited file. Its removal failing is said
 * on stderr: the reader's own expiry and snapshot checks still stand behind it.
 *
 * The marker's mtime is set BACK to the instant this check began, before it read the register or any reading. The
 * reader passes only while the marker is newer than the Claude accounts file and the plan's snapshot, so anything
 * written after this check's reads began — a plan change that cleared every marker while this check was mid-flight,
 * a reading published meanwhile — outranks the pass this check is about to leave. A marker
 * whose mtime cannot be set is removed: one stamped at its write time would claim to postdate those reads.
 *
 * @param cache how long a pass may stand, from the usage gate
 * @param judgedAtIso the instant this check began, before any of its reads
 * @param sessionId the session the payload named
 * @param reading what the boot-credential read established
 * @param verdict the judgement this prompt just got
 */
function rememberPass({
  cache,
  judgedAtIso,
  sessionId,
  reading,
  verdict,
}: {
  cache: SeatPassCachePolicy;
  judgedAtIso: string;
  sessionId: string;
  reading: SeatReading;
  verdict: SeatVerdict;
}): void {
  const seatPassDir = stateHomePaths().live.seatPassDir;
  const marker = seatPassWrite({ cache, reading, seatPassDir, sessionId, verdict });
  if (marker === undefined) {
    forgetPass({ seatPassDir, sessionId });
    return;
  }
  const written = writeDatedSeatPass({ judgedAtIso, marker });
  if (written.isErr()) {
    logger.error({ msg: `claude seat: ${written.error.message}` });
  }
}

/**
 * Remove one session's cached pass, if it has one.
 *
 * @param seatPassDir the markers' directory
 * @param sessionId the session the payload named
 */
function forgetPass({ seatPassDir, sessionId }: { seatPassDir: string; sessionId: string }): void {
  const path = seatPassPath({ seatPassDir, sessionId });
  if (path === undefined) {
    return;
  }
  const removed = removeSeatPasses({ path });
  if (removed.isErr()) {
    logger.error({ msg: `claude seat: stale ${removed.error.message}` });
  }
}

export const claudeSeatCommand = defineCommand({ run: runClaudeSeat });
