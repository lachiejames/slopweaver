/**
 * `slopweaver fresh-cut produce|verify|accept` — the effectful shell. Flag grammar and output lines are pure
 * ({@link ./core}); the cut itself is `../../../freshCut/`.
 *
 * `produce` makes ONE network call: the GitHub viewer read through the door, which supplies the login and numeric
 * id the no-reply address is built from, so no address is ever a literal. Everything else is local git. Nothing here
 * creates a remote repository, adds a remote or pushes: a cut leaves this machine only by a later, separate act.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { githubToken } from "../../../config.js";
import { acceptReviewedResidue } from "../../../freshCut/accept.js";
import { verificationLines } from "../../../freshCut/core.js";
import { type FreshCutError, FreshCutErrors } from "../../../freshCut/errors.js";
import { type FreshCutIdentity, produceFreshCut } from "../../../freshCut/produce.js";
import { readFreshCutRecord, writeFreshCutRecord, writeFreshCutVerification } from "../../../freshCut/store.js";
import { verifyFreshCut } from "../../../freshCut/verify.js";
import { grantSessionId } from "../../../hatch/grantSession.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { githubNoReplyAddress, viewerIdentity } from "../../../live/github/viewerIdentity.js";
import { claudeHomeDir } from "../../../supervisor/chairRead.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { acceptLines, parseAcceptOptions, parseProduceOptions, parseVerifyOptions } from "./core.js";
import { FRESH_CUT_ACCEPT_USAGE, FRESH_CUT_PRODUCE_USAGE, FRESH_CUT_VERIFY_USAGE } from "./freshCutUsage.js";

/**
 * Report every parse rejection, then the usage line.
 *
 * @param errors each rejection
 * @param usage the verb's usage line
 * @returns the usage exit code
 */
function reportUsage({ errors, usage }: { errors: readonly string[]; usage: string }): number {
  for (const error of errors) {
    logger.error({ msg: error });
  }
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/**
 * The exit code a typed failure maps to: a caller's wrong commit or destination is a usage refusal, everything a
 * read or a write could not do is an error.
 *
 * @param error the failure
 * @returns the exit code
 */
function exitFor({ error }: { error: FreshCutError }): number {
  logger.error({ msg: `fresh-cut: ${error.message}` });
  if (
    error.code === "COMMIT_INVALID" ||
    error.code === "COMMIT_NOT_ON_MAIN" ||
    error.code === "DESTINATION_REFUSED" ||
    error.code === "REVIEWED_RESIDUE_CANDIDATE_REFUSED" ||
    error.code === "OWNER_ANCHOR_REFUSED" ||
    error.code === "REVIEWER_SESSION_UNAVAILABLE"
  ) {
    return EXIT_USAGE;
  }
  return EXIT_ERROR;
}

/**
 * Read the GitHub token owner's identity through the door and build the no-reply address from it.
 *
 * @param home the state home whose stored token to read
 * @returns the identity, or why it is unavailable
 */
async function readIdentity({ home }: { home: string }): Promise<Result<FreshCutIdentity, string>> {
  const token = githubToken({ home });
  if (token === undefined) {
    return err("no GitHub token: `slopweaver secrets status` names where it is read from");
  }
  const identity = await viewerIdentity({ graphql: githubReadGraphql({ token }) });
  if (identity.isErr()) {
    return err(identity.error.message);
  }
  return ok({ address: githubNoReplyAddress({ identity: identity.value }), login: identity.value.login });
}

/**
 * Run `fresh-cut produce`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runFreshCutProduce(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["produce"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FRESH_CUT_PRODUCE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseProduceOptions({ rest });
  if (parsed.isErr()) {
    return reportUsage({ errors: parsed.error, usage: FRESH_CUT_PRODUCE_USAGE });
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  const identity = await readIdentity({ home });
  if (identity.isErr()) {
    logger.error({ msg: `fresh-cut: the commit identity is unavailable: ${identity.error}` });
    return EXIT_ERROR;
  }
  // With no --source, the cut is taken from the checkout the verb runs in.
  let source = process.cwd();
  if (options.source !== null) {
    source = options.source;
  }
  const produced = produceFreshCut({
    commit: options.commit,
    destination: options.out,
    identity: identity.value,
    now: new Date(),
    recordId: randomUUID(),
    source,
  });
  if (produced.isErr()) {
    return exitFor({ error: produced.error });
  }
  const written = writeFreshCutRecord({ home, record: produced.value });
  if (written.isErr()) {
    return exitFor({ error: written.error });
  }
  const record = produced.value;
  if (options.json) {
    logger.out({ line: JSON.stringify({ ...record, recordPath: written.value }, null, 2) });
    return EXIT_OK;
  }
  for (const line of [
    `fresh-cut produce: one root commit ${record.rootSha} at ${record.destination}`,
    `fresh-cut produce: tree ${record.treeSha} from ${record.sourceSha}, signed as ${record.login}'s no-reply address`,
    `fresh-cut produce: record ${record.recordId} — ${written.value}`,
    `fresh-cut produce: next, slopweaver fresh-cut verify --record ${record.recordId}`,
  ]) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run `fresh-cut verify`.
 *
 * @param argv the full process argv
 * @returns the process exit code: 0 clear, 1 on any finding or failure
 */
export function runFreshCutVerify(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["verify"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FRESH_CUT_VERIFY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseVerifyOptions({ rest });
  if (parsed.isErr()) {
    return reportUsage({ errors: parsed.error, usage: FRESH_CUT_VERIFY_USAGE });
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  const record = readFreshCutRecord({ home, recordId: options.recordId });
  if (record.isErr()) {
    return exitFor({ error: record.error });
  }
  // With no --source, the cut is verified against the checkout it was produced from.
  let source = record.value.source;
  if (options.source !== null) {
    source = options.source;
  }
  const verified = verifyFreshCut({
    home,
    now: new Date(),
    projectsDir: join(claudeHomeDir(), "projects"),
    record: record.value,
    source,
  });
  if (verified.isErr()) {
    return exitFor({ error: verified.error });
  }
  const written = writeFreshCutVerification({ home, verification: verified.value });
  if (written.isErr()) {
    return exitFor({ error: written.error });
  }
  if (options.json) {
    const { findings, ...summary } = verified.value;
    logger.out({
      line: JSON.stringify({ ...summary, findingCount: findings.length, reportPath: written.value }, null, 2),
    });
  } else {
    for (const line of verificationLines({ reportPath: written.value, verification: verified.value })) {
      logger.out({ line });
    }
  }
  return verified.value.status === "clear" ? EXIT_OK : EXIT_ERROR;
}

/**
 * Run `fresh-cut accept`.
 *
 * @param argv the full process argv
 * @returns the process exit code: 0 appended, 2 refused, 1 on a failed read or write
 */
export function runFreshCutAccept(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["accept"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: FRESH_CUT_ACCEPT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseAcceptOptions({ rest });
  if (parsed.isErr()) {
    return reportUsage({ errors: parsed.error, usage: FRESH_CUT_ACCEPT_USAGE });
  }
  const options = parsed.value;
  const sessionId = grantSessionId({ env: process.env });
  if (sessionId === undefined) {
    return exitFor({ error: FreshCutErrors.reviewerSessionUnavailable() });
  }
  const home = resolveHome({ named: options.home });
  const record = readFreshCutRecord({ home, recordId: options.recordId });
  if (record.isErr()) {
    return exitFor({ error: record.error });
  }
  // With no --source, the cut is re-derived from the checkout its record names.
  let source = record.value.source;
  if (options.source !== null) {
    source = options.source;
  }
  const accepted = acceptReviewedResidue({
    decision: options.decision,
    home,
    line: options.line,
    now: new Date(),
    path: options.path,
    projectsDir: join(claudeHomeDir(), "projects"),
    record: record.value,
    sessionId,
    source,
  });
  if (accepted.isErr()) {
    return exitFor({ error: accepted.error });
  }
  const { entry, listPath } = accepted.value;
  if (options.json) {
    // The anchor stays in the owner-only list: the output says only that the entry rests on one.
    const basis = entry.schemaVersion === 1 ? { judgement: entry.judgement } : { acceptedOn: "owner-anchor" as const };
    logger.out({
      line: JSON.stringify({ className: entry.className, entryId: entry.entryId, ...basis, listPath }, null, 2),
    });
    return EXIT_OK;
  }
  for (const line of acceptLines({ entry, listPath })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const freshCutAcceptCommand = defineCommand({ run: runFreshCutAccept });
export const freshCutProduceCommand = defineCommand({ run: runFreshCutProduce });
export const freshCutVerifyCommand = defineCommand({ run: runFreshCutVerify });
