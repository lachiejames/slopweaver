/**
 * `slopweaver codex supersede` — retire ONE recorded review pass whose property WORDING was unsatisfiable, or
 * ONE pass that recorded no tree (`../../../codex/supersession.ts` carries both).
 *
 * The alternative that was turned down was making
 * `codex status --check` read only the latest verdict per property id, which clears a blocking `BROKEN` the
 * moment anyone re-runs the id — including with weaker wording, silently. This verb costs a sentence and
 * leaves that sentence on the record forever.
 *
 * The decision is pure and lives in `../../../codex/supersession.ts`, including the refusal that makes a
 * retirement impossible unless a replacement pass already stands. This file is the shell: read the ledger,
 * ask, append, and print what the register now says.
 *
 * The ledger it reads is the SAME fold `codex status --check` and both landing verbs read — pass records
 * plus Claude fallback review receipts (`../../../codex/fallbackReview.ts`). MEASURED: reading
 * pass records alone made every receipt invisible to this verb, so a CURRENT BROKEN fallback receipt — a
 * review row the floor counts — answered `no pass with artifact id … ran on this
 * branch in this checkout` and could never be retired, blocking the landing floor permanently for as long
 * as Codex stayed capped. A row the floor counts has to be a row this verb can reach.
 */

import { err, ok, type Result } from "#lib/result.js";
import { worktreeDiffsForBranch } from "../../../codex/diffsNow.js";
import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { fallbackLedgerEntries } from "../../../codex/fallbackPlan.js";
import { type FallbackRegisterPort, fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { type BranchLedger, type LedgerEntry, ledgerForBranch } from "../../../codex/ledger.js";
import { type LedgerScan, scanPassRecords } from "../../../codex/ledgerStore.js";
import { foreignReceiptScanReason, unreadableScanReason } from "../../../codex/scanReasons.js";
import {
  replacementFor,
  type Supersession,
  supersedeRefusal,
  unplaceableReplacementFor,
  unplaceableSupersedeRefusal,
} from "../../../codex/supersession.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { supersessionPort } from "../../../codex/supersessionStore.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import type { FlagSpec, ParsedFlags } from "../../parseFlags.js";
import { parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { codexRepoRoot, reportedBranch } from "./repoScope.js";

const VERB_ARG_OFFSET = 4;

/** The flags `codex supersede` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const SUPERSEDE_FLAGS: FlagSpec = { boolean: [], string: ["artifact", "reason", "branch", "repo", "home"] };

/** The same flags, `--`-prefixed, for the help-truth ratchet. Derived rather than retyped. */
export const CODEX_SUPERSEDE_FLAG_NAMES: readonly string[] = [...stringFlagsOf({ spec: SUPERSEDE_FLAGS })]
  .map((name) => `--${name}`)
  .toSorted();

/** Usage for `codex supersede`, kept beside the verb so `--help` and the parser share one string. */
export const CODEX_SUPERSEDE_USAGE =
  "usage: slopweaver codex supersede --artifact <id> --reason <text> [--branch <name>] [--repo <dir>] [--home <dir>]\n" +
  "\n" +
  "Retire ONE recorded pass so the landing gate stops counting it: a review whose PROPERTY WORDING could not\n" +
  "be satisfied, or a pass that recorded NO TREE and so blocks every landing from its checkout. The pass is\n" +
  "never deleted and never hidden: `codex status` keeps printing it, marked SUPERSEDED, with your reason.\n" +
  "\n" +
  "REFUSED unless a replacement already stands. For a wording: a CURRENT, conclusive pass under the SAME\n" +
  "property id. For a no-tree pass: a STRICTLY LATER, conclusive pass of the same kind on this branch that\n" +
  "captured a tree (a review one also current and under the same property id). A retirement with nothing in\n" +
  "its place is a dismissal, and this verb does not do that — re-run first, then retire the one it replaced.\n" +
  "\n" +
  "  --artifact <id>  the artifact id of the pass to retire (one pass, never a property id)\n" +
  "  --reason <text>  why it may stop counting; printed forever beside the retired pass";

/**
 * Parse `codex supersede` flags. Exported so the help-truth ratchet probes the REAL parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexSupersedeArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: SUPERSEDE_FLAGS });
}

/** One declared string flag, or `undefined`. */
function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Run the verb: the composition root, the one place the production fallback and supersession ports are named.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function runCodexSupersede(argv: readonly string[]): Promise<number> {
  return runCodexSupersedeOver({ argv, fallbackPort: fallbackRegisterPort(), supersessions: supersessionPort() });
}

/**
 * Run the verb over injected registers, so a test reads its receipts and retirements from memory ports.
 *
 * @param argv the whole process argv
 * @param fallbackPort where the Claude fallback receipts the ledger folds in are read; an outage refuses
 * @param supersessions the register read for what is already retired, and appended to
 * @returns the process exit code
 */
export async function runCodexSupersedeOver({
  argv,
  fallbackPort,
  supersessions,
}: {
  argv: readonly string[];
  fallbackPort: FallbackRegisterPort;
  supersessions: SupersessionPort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CODEX_SUPERSEDE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexSupersedeArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    logger.error({ msg: CODEX_SUPERSEDE_USAGE });
    return EXIT_USAGE;
  }
  const artifactId = stringFlag({ name: "artifact", parsed: parsed.value });
  const reason = stringFlag({ name: "reason", parsed: parsed.value });
  if (artifactId === undefined || reason === undefined) {
    logger.error({ msg: "codex supersede: both --artifact <id> and --reason <text> are required" });
    logger.error({ msg: CODEX_SUPERSEDE_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const repoRoot = codexRepoRoot({ repo: stringFlag({ name: "repo", parsed: parsed.value }) });
  if (repoRoot.isErr()) {
    logger.error({ msg: `codex supersede: ${repoRoot.error.message}` });
    return EXIT_ERROR;
  }
  return retire({
    artifactId,
    branchFlag: stringFlag({ name: "branch", parsed: parsed.value }),
    fallbackPort,
    home,
    reason,
    repoRoot: repoRoot.value,
    supersessions,
  });
}

/**
 * Read every piece of evidence the guard judges: the pass records, the fallback receipts and the register.
 *
 * The register fails closed: what is already retired decides whether this retirement is a second one, so a
 * register that cannot be read refuses rather than reading as empty.
 *
 * @param home the state home every source lives under
 * @param supersessions the register's port
 * @returns the three readings, or the sentence naming the one that failed
 */
async function readEvidence({
  fallbackPort,
  home,
  supersessions,
}: {
  fallbackPort: FallbackRegisterPort;
  home: string;
  supersessions: SupersessionPort;
}): Promise<
  Result<{ scan: LedgerScan; receipts: FallbackReceiptScan; retired: ReadonlyMap<string, Supersession> }, string>
> {
  const scan = scanPassRecords({ orchestrationRoot: stateHomePaths({ home }).orchestration });
  if (scan.isErr()) {
    return err(scan.error.message);
  }
  const receipts = await fallbackPort.scan({ home });
  if (receipts.isErr()) {
    return err(receipts.error.message);
  }
  const retired = await supersessions.read({ home });
  if (retired.isErr()) {
    return err(retired.error.message);
  }
  return ok({ receipts: receipts.value, retired: retired.value, scan: scan.value });
}

/**
 * Read the ledger, ask the pure guard, and append the row when it says yes.
 *
 * The ledger applies the same carried-diff rule `codex status` and the landing floor do: a review they count
 * as current must be one this verb can retire (`codex/supersession.ts` refuses a target that is not current).
 *
 * @returns the process exit code
 */
async function retire({
  artifactId,
  fallbackPort,
  reason,
  home,
  repoRoot,
  branchFlag,
  supersessions,
}: {
  artifactId: string;
  fallbackPort: FallbackRegisterPort;
  reason: string;
  home: string;
  repoRoot: string;
  branchFlag: string | undefined;
  supersessions: SupersessionPort;
}): Promise<number> {
  const branch = reportedBranch({ branchFlag, repoRoot });
  if (branch === null) {
    logger.error({ msg: "codex supersede: HEAD is detached and no --branch was given" });
    return EXIT_USAGE;
  }
  const evidence = await readEvidence({ fallbackPort, home, supersessions });
  if (evidence.isErr()) {
    logger.error({ msg: `codex supersede: ${evidence.error}` });
    return EXIT_ERROR;
  }
  const { receipts, retired, scan } = evidence.value;
  const captured = captureTreeFingerprint({ cwd: repoRoot });
  const now = captured.isOk() ? captured.value : undefined;
  const ledger = ledgerForBranch({
    branch,
    diffsNow: worktreeDiffsForBranch({ branch, records: scan.records, repoRoot }),
    fallbackEntries: fallbackLedgerEntries({ branch, now, repoRoot, scan: receipts }),
    now,
    records: scan.records,
    repoRoot,
    supersessions: retired,
  });
  // Fail closed on an UNREADABLE record or receipt, or a newer build's answer on this branch (either could be the
  // pass named or its replacement), never on a no-tree one: this verb retires those, so not `incompleteScanReason`.
  const unreadable = unreadableScanReason({ receipts, scan });
  const foreign = foreignReceiptScanReason({ branch, receipts, repoRoots: new Set([repoRoot]) });
  for (const scanRefusal of [unreadable, foreign]) {
    if (scanRefusal !== undefined) {
      logger.error({ msg: `codex supersede: ${scanRefusal}` });
      return EXIT_ERROR;
    }
  }
  const alreadyRetired = new Set(retired.keys());
  if (ledger.unplaceable.some((each) => each.artifactId === artifactId)) {
    return retireUnplaceable({ alreadyRetired, artifactId, branch, home, ledger, reason, supersessions });
  }
  const refusal = supersedeRefusal({ alreadyRetired, artifactId, entries: ledger.entries });
  if (refusal !== undefined) {
    logger.error({ msg: `codex supersede: REFUSED — ${refusal}` });
    return EXIT_ERROR;
  }
  return record({ artifactId, entries: ledger.entries, home, reason, supersessions });
}

/**
 * Append one retirement, printing the register's refusal when it will not take it.
 *
 * @param home the state home
 * @param row the retirement
 * @param supersessions the register
 * @returns whether it is on the record
 */
async function appended({
  home,
  row,
  supersessions,
}: {
  home: string;
  row: Supersession;
  supersessions: SupersessionPort;
}): Promise<boolean> {
  const written = await supersessions.append({ home, row });
  if (written.isErr()) {
    logger.error({ msg: `codex supersede: nothing was retired — ${written.error.message}` });
    return false;
  }
  return true;
}

/**
 * Retire a pass that recorded no tree, beside a later pass on this branch that captured one.
 *
 * @param ledger the branch ledger, carrying both the placed rows and the no-tree records
 * @param alreadyRetired the artifact ids already carrying a row
 * @param branch the branch the replacement stands on, written into the row as the only one it retires for
 * @returns the process exit code
 */
async function retireUnplaceable({
  alreadyRetired,
  artifactId,
  branch,
  home,
  ledger,
  reason,
  supersessions,
}: {
  alreadyRetired: ReadonlySet<string>;
  artifactId: string;
  branch: string;
  home: string;
  ledger: BranchLedger;
  reason: string;
  supersessions: SupersessionPort;
}): Promise<number> {
  const refusal = unplaceableSupersedeRefusal({
    alreadyRetired,
    artifactId,
    entries: ledger.entries,
    unplaceable: ledger.unplaceable,
  });
  if (refusal !== undefined) {
    logger.error({ msg: `codex supersede: REFUSED — ${refusal}` });
    return EXIT_ERROR;
  }
  // Both reads are proven by the refusal having passed: the record is in the list and a replacement stands.
  const target = ledger.unplaceable.find((each) => each.artifactId === artifactId)!;
  const replacement = unplaceableReplacementFor({ entries: ledger.entries, target })!;
  const written = await appended({
    home,
    row: {
      artifactId,
      atIso: new Date().toISOString(),
      branch,
      kind: "no-tree",
      mode: target.mode,
      pass: target.pass,
      ...(target.propertyId === undefined ? {} : { propertyId: target.propertyId }),
      reason,
      replacedBy: replacement.artifactId,
    },
    supersessions,
  });
  if (!written) {
    return EXIT_ERROR;
  }
  logger.out({ line: `superseded ${artifactId} (${target.pass}, ${target.verdict}, recorded no tree)` });
  logger.out({
    line: `  replaced by ${replacement.artifactId} (${replacement.pass}, ${replacement.verdict}, ${replacement.createdAtIso}), which captured a tree`,
  });
  logger.out({ line: `  reason: ${reason}` });
  logger.out({
    line: `It still appears in \`codex status\`, marked SUPERSEDED. Only the landing gate stops counting it, and only for ${branch}.`,
  });
  return EXIT_OK;
}

/**
 * Append the row and print what the register now says.
 *
 * Split from {@link retire} so that function stays a readable sequence of reads and this holds the one write.
 * Reached only once {@link supersedeRefusal} has passed, which is what makes the assertions below honest
 * rather than defensive: it has already proven the pass exists, carries a property id, and has a replacement.
 *
 * @param entries the branch ledger the refusal was judged against
 * @returns the process exit code
 */
async function record({
  artifactId,
  entries,
  home,
  reason,
  supersessions,
}: {
  artifactId: string;
  entries: readonly LedgerEntry[];
  home: string;
  reason: string;
  supersessions: SupersessionPort;
}): Promise<number> {
  const target = entries.find((entry) => entry.artifactId === artifactId)!;
  const replacement = replacementFor({ entries, target })!;
  const written = await appended({
    home,
    row: {
      artifactId,
      atIso: new Date().toISOString(),
      propertyId: target.propertyId!,
      reason,
      replacedBy: replacement.artifactId,
    },
    supersessions,
  });
  if (!written) {
    return EXIT_ERROR;
  }
  logger.out({ line: `superseded ${artifactId} (${target.pass}, ${target.propertyId!}, ${target.verdict})` });
  logger.out({ line: `  replaced by ${replacement.artifactId}, which is CURRENT and ${replacement.verdict}` });
  logger.out({ line: `  reason: ${reason}` });
  logger.out({
    line: "It still appears in `codex status`, marked SUPERSEDED. Only the landing gate stops counting it.",
  });
  return EXIT_OK;
}

/** `slopweaver codex supersede`. */
export const codexSupersedeCommand = defineCommand({ run: runCodexSupersede });
