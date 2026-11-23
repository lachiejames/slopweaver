/**
 * `slopweaver codex quota clear|show` — the explicit recovery path for a stale Codex exhaustion refusal.
 *
 * Its own file rather than a section of `./run.ts`, and the seam is real: the plan and review verbs run
 * Codex, and this one never does. It reads four local sources — one destination's cached record, its clear
 * mark, that destination's own rollout log, and this home's pass records — so recovering from a stale refusal
 * is never "delete a JSON file by hand".
 *
 * `clear` records a clear instant and deletes nothing, because the refusal it is named in can stand on
 * rollout-log evidence this verb cannot delete: an unscoped spend-cap event in Codex's own log kept a
 * destination out of routing while its live read showed 0% weekly use, and `clear` answered "had no cached
 * record" and changed nothing (`codex/quotaGate.ts` § The explicit clear is a WATERMARK).
 *
 * STDOUT CARRIES THE MACHINE RESULT, as in `./run.ts`: `show` writes one JSON document a caller parses, and
 * every refusal and usage line goes to stderr.
 */

import { existsSync } from "node:fs";

import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { type CodexDestination, codexDestinationFor } from "../../../codex/destinations.js";
import { scanPassRecords } from "../../../codex/ledgerStore.js";
import {
  codexQuotaCacheStanding,
  listCodexQuotaCaches,
  readCodexQuotaCache,
  readCodexQuotaClearMark,
  writeCodexQuotaClearMark,
} from "../../../codex/quotaCache.js";
import { readLatestCodexQuotaEvidence } from "../../../codex/quotaLog.js";
import { currentCodexQuotaDecision } from "../../../codex/quotaNow.js";
import { newestPassReport } from "../../../codex/quotaPassEvidence.js";
import type { CodexQuotaEvidence } from "../../../codex/quotaTypes.js";
import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { PlanRegisterError } from "../../../plans/errors.js";
import { type PlanRegisterPort, planRegisterPort } from "../../../plans/port.js";
import { stateHomePaths } from "../../../stateHome.js";
import { talkPlanRefusal } from "../../../talk/planRoute.js";
import { decideTalkSeat } from "../../../talk/talkSeat.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, type ParsedFlags, parseFlags } from "../../parseFlags.js";

/**
 * Where a `codex <verb>` flag tail begins in `process.argv` — `[node, cli, codex, quota, ...]`, so 4.
 *
 * Its own copy rather than an import from `./run.ts`: that module loads the Codex client and every pass
 * profile, and this verb runs no pass. `../../../__tests__/unit/cli/helpTruth.test.ts` probes the REAL
 * parser, which is what keeps the two in step.
 */
const VERB_ARG_OFFSET = 4;

/** The value-taking flags `codex quota` accepts, regardless of its `clear|show` sub-verb. */
const QUOTA_STRING_FLAGS: readonly string[] = ["home", "plan"];

/** The switches `codex quota` accepts: `--routed` names the row a Talk call would spend, for `show` only. */
const QUOTA_BOOLEAN_FLAGS: readonly string[] = ["routed"];

/** The parser's spec, built from the two lists above so the spec and the advertised names cannot disagree. */
const QUOTA_FLAGS: FlagSpec = { boolean: [...QUOTA_BOOLEAN_FLAGS], string: [...QUOTA_STRING_FLAGS] };

/** `codex quota`'s advertised flags, for the help-truth ratchet. Derived from the same two lists. */
export const CODEX_QUOTA_FLAG_NAMES: readonly string[] = [...QUOTA_STRING_FLAGS, ...QUOTA_BOOLEAN_FLAGS]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex quota`, kept beside the verb so `--help` and the parser share one string. */
const QUOTA_USAGE =
  "usage: slopweaver codex quota <clear|show> (--plan <alias> | --routed) [--home <dir>]\n" +
  "\n" +
  "  clear   record one destination's clear instant, deleting nothing:\n" +
  "          cached and rollout-log evidence observed before it stops refusing, so routing and\n" +
  "          `cmux spawn --driver codex` re-check from scratch. A cap observed later, or one the live\n" +
  "          read reports, still refuses. The rollout log itself is never touched.\n" +
  "  show    print that destination's cached record, its clear instant (`clearedAtIso`), the freshest\n" +
  "          evidence from Codex's own rollout log (raw, even when the clear disregards it), the combined\n" +
  "          decision `cmux spawn` would currently make, every alias holding a cap, and the newest\n" +
  "          Codex pass record with the cause it recorded if it failed outright. That pass is reported\n" +
  "          only: `decision` does not read it, and `clear` never removes a pass record.\n" +
  "\n" +
  "  --plan  which registered Codex plan to act on, by register alias; required unless `show --routed`.\n" +
  "          There is no default: a login merely found in `$CODEX_HOME` is never a plan. `caches` in\n" +
  "          `show` names every alias holding a record no clear covers, a de-registered one included.\n" +
  "  --routed  `show` only: act on the register row a Talk call would spend now, routed by the same decision\n" +
  "          `talk offer` takes (no `--force`, so a paused or usage-limited row is never it). The call widget's\n" +
  "          Plan left row reads this. No row may pay: the refusal `talk offer` gives, on stderr, exit 1.";

/**
 * One parsed flag as the string it was given, or undefined when it was not given at all.
 *
 * The parser types every value `unknown`, and a flag absent and a flag holding a non-string are the same
 * answer to this verb: there is nothing to act on. A function rather than a ternary at each call site, so
 * the narrowing reads once.
 *
 * @param value the parsed flag
 * @returns the string, or undefined
 */
function stringFlagValue({ value }: { value: unknown }): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value;
}

/**
 * The home the pass records are read from: the one `--home` named, or this install's own.
 *
 * An `if` that RETURNS rather than an operator: the substitution of the ambient home for an unnamed one is
 * a real decision, and `.claude/rules/typescript-patterns.md` § No silent fallback is why it is spelled.
 *
 * @param home the `--home` the caller passed, if any
 * @returns the home to read
 */
function resolvedHomeOf({ home }: { home: string | undefined }): string {
  if (home === undefined) {
    return slopweaverHome();
  }
  return home;
}

/**
 * Which destination `codex quota` acts on: the registered Codex plan `--plan` names, and only that.
 *
 * There is no default destination. A Codex plan exists here only because the user registered it
 * (`plans add --provider codex`), never because a login was found in `$CODEX_HOME`, so an unnamed `--plan` names nothing to act on.
 *
 * A register read, so a store that cannot be read is that read's own failure — never `undefined`, which means
 * only "the register read fine and no Codex row carries that alias".
 *
 * @param home the state home whose register resolves an alias
 * @param port where the register is read
 * @param requested the `--plan` alias
 * @returns the destination; `ok(undefined)` when no Codex row carries that alias; or the read failure
 */
export async function codexQuotaDestination({
  home,
  port,
  requested,
}: {
  home: string;
  port: PlanRegisterPort;
  requested: string;
}): Promise<Result<CodexDestination | undefined, PlanRegisterError>> {
  return codexDestinationFor({ alias: requested, home, port });
}

/**
 * Parse `codex quota` flags. Exported so the help-truth ratchet can probe the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexQuotaArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: QUOTA_FLAGS });
}

/**
 * The `pass` section of `codex quota show`: the newest pass record that reached the transport, or why none is named.
 *
 * A pass refused before Codex's own session started writes no rollout log, so this is the only source that saw
 * the spend cap. A scan that failed or skipped records says so — "could not read the records" must never
 * print the same thing as "no pass has run".
 *
 * @param home the state home whose `orchestration` directory holds the pass records
 * @returns the report plus the scan's unreadable count, or a stated absence
 */
function newestPassSection({ home }: { home: string }): Record<string, unknown> {
  const orchestrationRoot = stateHomePaths({ home }).orchestration;
  if (!existsSync(orchestrationRoot)) {
    return { newest: null, note: "no pass has run under this home" };
  }
  const scan = scanPassRecords({ orchestrationRoot });
  if (scan.isErr()) {
    return { newest: null, note: `the pass records could not be read: ${scan.error.message}` };
  }
  const newest = newestPassReport({ records: scan.value.records });
  if (newest === undefined) {
    return { newest: null, unreadable: scan.value.unreadable };
  }
  return { newest, unreadable: scan.value.unreadable };
}

/**
 * One quota-evidence field of `codex quota show`, reported as an explicit `null` when nothing was recorded —
 * no cached exhaustion record, or no rollout reading — rather than by omitting the key.
 */
function quotaEvidenceJson({ evidence }: { evidence: CodexQuotaEvidence | undefined }): CodexQuotaEvidence | null {
  if (evidence === undefined) {
    return null;
  }
  return evidence;
}

/** The sub-verb a refusal quotes back: the JSON of what was typed, or `null` when none was. */
function quotedSubVerb({ sub }: { sub: string | undefined }): string {
  if (sub === undefined) {
    return "null";
  }
  return JSON.stringify(sub);
}

/** `show`'s `clearedAtIso`: the recorded instant, or an explicit `null` when the destination was never cleared. */
function clearMarkJson({ clearedAtIso }: { clearedAtIso: string | undefined }): string | null {
  if (clearedAtIso === undefined) {
    return null;
  }
  return clearedAtIso;
}

/**
 * `codex quota clear` over one destination: record the clear instant that makes older cached and rollout-log
 * evidence stop refusing, and say which state the cached record is left in.
 *
 * The mark is written whether or not a cached record existed — the case the old verb got wrong, since an
 * unscoped rollout-log cap refuses with no cached record at all — and success is printed only once it is.
 * Nothing is deleted: the mark IS the clear, and every deletion order lost a cap observed after it on some
 * crash or interleaving (`codexQuotaCacheStanding` carries the counterexamples).
 *
 * @param alias the destination acted on
 * @param home the state home the cached records and clear marks live under
 * @returns the process exit code
 */
function runQuotaClear({ alias, home }: { alias: string; home: string | undefined }): number {
  const homeArg = home === undefined ? {} : { home };
  const clearedAtIso = new Date().toISOString();
  if (!writeCodexQuotaClearMark({ alias, clearedAtIso, ...homeArg })) {
    logger.error({ msg: `codex quota clear: ${alias} is not an alias a clear mark can be written for` });
    return EXIT_ERROR;
  }
  const cache = codexQuotaCacheStanding({ alias, ...homeArg });
  if (cache === "covered") {
    logger.out({
      line: `codex quota clear: ${alias}'s cached record is disregarded; evidence observed before ${clearedAtIso} no longer refuses`,
    });
    return EXIT_OK;
  }
  if (cache === "standing") {
    logger.out({
      line: `codex quota clear: ${alias}'s cached record was observed after ${clearedAtIso}, so it still refuses; older evidence is disregarded`,
    });
    return EXIT_OK;
  }
  logger.out({
    line: `codex quota clear: ${alias} had no cached record; rollout-log evidence observed before ${clearedAtIso} is disregarded`,
  });
  return EXIT_OK;
}

/**
 * `codex quota show` over one destination: the decision, and the raw inputs a reader checks it against.
 *
 * The decision is the SAME one `cmux spawn --driver codex` and the loop floor make
 * (`codex/quotaNow.ts`), so this verb can never print a state the gates disagree with.
 *
 * @param destination the alias acted on, paired with its own `$CODEX_HOME`
 * @param home the `--home` the caller passed, if any
 * @param resolvedHome that home with the ambient one already substituted, for the pass records
 * @param deadlineAtMs the instant the live read must be over by — `--routed`'s one command deadline — if any
 * @returns the process exit code
 */
function runQuotaShow({
  deadlineAtMs,
  destination,
  home,
  resolvedHome,
}: {
  deadlineAtMs: number | undefined;
  destination: CodexDestination;
  home: string | undefined;
  resolvedHome: string;
}): number {
  const homeArg = home === undefined ? {} : { home };
  const cached = readCodexQuotaCache({ alias: destination.alias, ...homeArg });
  const fresh = readLatestCodexQuotaEvidence({ codexHome: destination.codexHome });
  const nowIso = new Date().toISOString();
  const deadlineArg = deadlineAtMs === undefined ? {} : { deadlineAtMs };
  const [live] = readCodexAccountsLive({ codexHomes: [destination.codexHome], readAtIso: nowIso, ...deadlineArg });
  const decision = currentCodexQuotaDecision({
    alias: destination.alias,
    codexHome: destination.codexHome,
    home,
    live: live!,
    nowIso,
  });
  logger.out({
    line: JSON.stringify({
      alias: destination.alias,
      cached: quotaEvidenceJson({ evidence: cached }),
      caches: listCodexQuotaCaches(homeArg),
      clearedAtIso: clearMarkJson({ clearedAtIso: readCodexQuotaClearMark({ alias: destination.alias, ...homeArg }) }),
      decision,
      fresh: quotaEvidenceJson({ evidence: fresh }),
      live,
      pass: newestPassSection({ home: resolvedHome }),
    }),
  });
  return EXIT_OK;
}

/**
 * Why `--routed` cannot be honoured on this argv, or undefined when it can (or was not passed).
 *
 * `--routed` names the row a Talk call would spend, so it is meaningless beside a `--plan` that names one by
 * hand, and it is refused on `clear`: clearing a refusal is a decision about one named alias, never about
 * whichever row the router happens to rank first this second.
 *
 * @param routed whether `--routed` was passed
 * @param plan the raw `--plan` value, which the flag parser types as unknown
 * @param sub the sub-verb typed, if any
 * @returns the refusal, after `codex quota: `, or undefined
 */
export function routedFlagRefusal({
  plan,
  routed,
  sub,
}: {
  plan: unknown;
  routed: boolean;
  sub: string | undefined;
}): string | undefined {
  if (!routed) {
    return undefined;
  }
  if (plan !== undefined) {
    return "--routed names the row a Talk call would spend, so it cannot be given beside --plan";
  }
  if (sub !== "show") {
    return "--routed is for `show` only; `clear` acts on one named --plan";
  }
  return undefined;
}

/**
 * How long `show --routed` may take end to end, both live batches included. The console kills its `codex-quota`
 * poll at `SLOW_TIMEOUT_MS` (90s, `site/lib/liveVerbs.ts`), so the reads end by 60s and leave 30s for CLI start-up
 * and printing: a register of any size then answers, a store past the deadline reported `unreadable`, rather than
 * being killed with no JSON. MEASURED: 12.0s wall on five stores, with
 * `time ./bin/slopweaver codex quota show --routed`.
 */
export const ROUTED_QUOTA_DEADLINE_MS = 60_000;

/**
 * The one deadline `--routed` holds both its live reads to, or undefined without `--routed`, whose reads keep
 * their standing bounds.
 *
 * @param nowMs the instant the verb started, epoch milliseconds
 * @param routed whether `--routed` was passed
 * @returns the epoch-millisecond deadline, or undefined
 */
export function routedQuotaDeadlineAtMs({ nowMs, routed }: { nowMs: number; routed: boolean }): number | undefined {
  if (!routed) {
    return undefined;
  }
  return nowMs + ROUTED_QUOTA_DEADLINE_MS;
}

/**
 * The destination this invocation acts on, or the exit code once its refusal is printed.
 *
 * Resolved to BOTH its terms before anything reads: the alias keys the cached record and that destination's
 * own `$CODEX_HOME` holds the rollout log reported beside it. A `--plan` no row carries is refused rather than
 * substituted, because reading the ambient log under another alias's name is exactly the two-accounts-one-answer
 * report `codex/destinations.ts` exists to prevent. `--routed` asks the Talk call's own decision
 * (`talk/talkSeat.ts`), so the widget reports the plan the next call spends rather than the ambient store.
 *
 * @param deadlineAtMs `--routed`'s command deadline, which the route's live read is bounded by
 * @param flags the parsed argv
 * @param resolvedHome the state home whose register resolves an alias or a route
 * @param sub the sub-verb typed, if any
 * @returns the destination, or the exit code
 */
async function quotaDestinationOrExit({
  deadlineAtMs,
  flags,
  resolvedHome,
  sub,
}: {
  deadlineAtMs: number | undefined;
  flags: ParsedFlags;
  resolvedHome: string;
  sub: string | undefined;
}): Promise<CodexDestination | number> {
  const routed = flags.values["routed"] === true;
  const refusal = routedFlagRefusal({ plan: flags.values["plan"], routed, sub });
  if (refusal !== undefined) {
    logger.error({ msg: `codex quota: ${refusal}` });
    logger.error({ msg: QUOTA_USAGE });
    return EXIT_USAGE;
  }
  if (routed) {
    const deadlineArg = deadlineAtMs === undefined ? {} : { deadlineAtMs };
    const route = await decideTalkSeat({ home: resolvedHome, nowIso: new Date().toISOString(), ...deadlineArg });
    if (route.isErr()) {
      logger.error({ msg: `codex quota: ${talkPlanRefusal({ error: route.error })}` });
      return EXIT_ERROR;
    }
    return route.value.destination;
  }
  const plan = stringFlagValue({ value: flags.values["plan"] });
  if (plan === undefined) {
    logger.error({
      msg: "codex quota: name the registered Codex plan to act on with --plan <alias> (`slopweaver plans list --provider codex`), or `show --routed`",
    });
    logger.error({ msg: QUOTA_USAGE });
    return EXIT_USAGE;
  }
  const resolved = await codexQuotaDestination({ home: resolvedHome, port: planRegisterPort(), requested: plan });
  if (resolved.isErr()) {
    logger.error({ msg: `codex quota: ${resolved.error.message}` });
    return EXIT_ERROR;
  }
  if (resolved.value === undefined) {
    logger.error({ msg: `codex quota: no registered Codex plan is called ${JSON.stringify(plan)}` });
    logger.error({ msg: QUOTA_USAGE });
    return EXIT_USAGE;
  }
  return resolved.value;
}

/**
 * `codex quota clear|show` — the explicit recovery path for a stale exhaustion refusal, whether it stands on
 * the cached record `cmux spawn`'s post-boot check writes or on Codex's own rollout log, so recovering from a
 * stale refusal is never "delete a JSON file by hand".
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexQuota(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: QUOTA_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexQuotaArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: QUOTA_USAGE });
    return EXIT_USAGE;
  }
  const sub = parsed.value.positionals[0];
  const home = stringFlagValue({ value: parsed.value.values["home"] });
  const resolvedHome = resolvedHomeOf({ home });
  const deadlineAtMs = routedQuotaDeadlineAtMs({ nowMs: Date.now(), routed: parsed.value.values["routed"] === true });
  const destination = await quotaDestinationOrExit({ deadlineAtMs, flags: parsed.value, resolvedHome, sub });
  if (typeof destination === "number") {
    return destination;
  }
  if (sub === "clear") {
    return runQuotaClear({ alias: destination.alias, home });
  }
  if (sub === "show") {
    return runQuotaShow({ deadlineAtMs, destination, home, resolvedHome });
  }
  logger.error({ msg: `codex quota: expected "clear" or "show", got ${quotedSubVerb({ sub })}` });
  logger.error({ msg: QUOTA_USAGE });
  return EXIT_USAGE;
}

export const codexQuotaCommand = defineCommand({ run: runCodexQuota });
