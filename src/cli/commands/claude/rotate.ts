/**
 * The `claude rotate` shell: report which plan the owner named, and REFUSE to perform the credential copy that
 * used to be the act behind it.
 *
 * ## This verb no longer writes a credential, and that is the point
 *
 * It was the one verb in the repository that did. What it performed was a COPY: one store's credential written
 * into the shared default keychain slot, so that every session reading that slot would pick the new plan up.
 * That mechanism is retired, for a measured reason rather than a tidying one.
 *
 * **Refresh-token ROTATION is real on this provider.** MEASURED by fingerprinting one store's
 * credential either side of its own scheduled refresh: the access token was replaced AND the refresh token was
 * replaced with it, while `refreshTokenExpiresAt` did not move. So two slots holding one credential is a
 * credential that dies the moment either slot refreshes — and that is the one revocation mechanism in this
 * workstream with actual evidence behind it. It is what revoked `plan-one`, and it is the live
 * hypothesis for the `invalid_grant` deaths that turned two EXPIRED stores into SIGNED OUT ones.
 *
 * **And the copy was already vestigial.** Every session boots against a named store: a pinned seat through
 * `seatPinning.ts`, an allocated worker through the pre-spawn gate in `claude/spawnStore.ts`, both applied as a
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR=` prefix by `cmux/spawn.ts`. MEASURED: the shared default
 * slot's own access token had expired — four days earlier — while all four configured
 * stores were live and the whole fleet was running on them. Nothing was reading what the copy wrote.
 *
 * So "which plan does this session spend" is answered per spawn, by selecting a store, and never by moving
 * bytes. The refusal this verb now renders says that, and names the store override as the thing to do instead.
 *
 * **The report still works.** Naming a plan with `--to` prints what would be selected and writes nothing,
 * which is what it always did without `--commit`.
 */
import type { ClaudeRotationDecision } from "../../../claude/contracts.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { refusalReport, rotateReport } from "../../../claude/rotateReport.js";
import { readAccountsFile } from "../../../claude/spawnAccounts.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { ClaudeCommandErrors, type ClaudeCommandResult, claudeCommandErrorLines } from "./errors.js";

/** The flags this verb accepts, and the ONLY place they are named — its usage is held to this by `helpTruth`. */
const ROTATE_FLAG_SPEC = { boolean: ["commit"], string: ["to"] } as const;

/** Where this verb's own arguments start in `process.argv`: `[node, cli, claude, rotate, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Every flag this verb advertises, derived from the spec it actually parses with so the two cannot drift.
 *
 * @internal — read by `helpTruth.test.ts` to hold `meta.usage` to the real parser.
 */
export const CLAUDE_ROTATE_FLAG_NAMES: readonly string[] = [
  ...ROTATE_FLAG_SPEC.string.map((name) => `--${name}`),
  ...ROTATE_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** What one `claude rotate` invocation asked for. */
export interface ClaudeRotateArgs {
  /** The plan the caller named. */
  readonly to: string;
  /** Whether the caller asked for the retired credential copy to be performed. */
  readonly commit: boolean;
}

/**
 * Parse this verb's own argument tail, strictly, before any configuration is read.
 *
 * Still strict, and `--discard-unreturnable` is now REJECTED rather than ignored. It guarded the check-in that
 * returned the default slot's credential to a store, and that write is gone — so silently accepting it would
 * tell a caller their accepted risk had been applied to an act nothing performs.
 *
 * @param rest the argv tail, after `claude rotate`
 * @returns what was asked for, or every rejection at once
 */
export function parseClaudeRotateArgs({
  rest,
}: {
  readonly rest: readonly string[];
}): ClaudeCommandResult<ClaudeRotateArgs> {
  const parsed = parseFlags({ args: rest, spec: ROTATE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(ClaudeCommandErrors.flagsRefused({ reasons: parsed.error }));
  }
  const to = parsed.value.values["to"];
  if (typeof to !== "string" || to.length === 0) {
    return err(ClaudeCommandErrors.rotateTargetMissing());
  }
  return ok({ commit: parsed.value.values["commit"] === true, to });
}

/**
 * Rotate the fleet's active Claude plan.
 *
 * @param argv the FULL process argv — the router passes it whole
 * @returns the process exit code
 */
function runClaudeRotate(argv: readonly string[]): number {
  const args = parseClaudeRotateArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
  if (args.isErr()) {
    logger.error({ msg: `claude rotate: ${claudeCommandErrorLines({ error: args.error }).join("; ")}` });
    return EXIT_USAGE;
  }
  const { commit, to } = args.value;
  const home = slopweaverHome();
  const configured = readAccountsFile({ home });
  if (configured.isErr()) {
    logger.error({ msg: `claude rotate: ${configured.error.message}` });
    return EXIT_ERROR;
  }
  const account = configured.value.find((candidate) => candidate.alias === to);
  if (account === undefined) {
    const report = refusalReport({ error: ClaudeRotationErrors.unknownAccount({ alias: to }) });
    logger.out({ line: JSON.stringify(report) });
    return EXIT_ERROR;
  }
  const decision: ClaudeRotationDecision = { excluded: [], kind: "rotate", to: account.alias };
  if (commit) {
    // A POLICY refusal, not a failure of fact: the plan named is real and the configuration is fine. The copy
    // this used to perform is retired, so the refusal names what to do instead rather than how to force it —
    // there is no variable that reinstates a writer that no longer exists.
    logger.out({ line: JSON.stringify(rotateReport({ decision })) });
    logger.error({ msg: hatchRefusal({ hatch: hatchFor({ id: "rotation-copy-retired" }) }) });
    return EXIT_ERROR;
  }
  logger.out({ line: JSON.stringify(rotateReport({ decision })) });
  logger.error({
    msg:
      "nothing was written, and nothing would be: the credential copy is retired. A session spends a plan by " +
      "being booted against its store, which the pre-spawn gate chooses — read `slopweaver claude route " +
      "--model <model>` to see which plan that would be.",
  });
  return EXIT_OK;
}

export const claudeRotateCommand = defineCommand({ run: runClaudeRotate });
