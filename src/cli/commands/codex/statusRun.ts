/**
 * `slopweaver codex status` — which passes ran on this branch of THIS checkout, and whether each still counts.
 *
 * Split out of `./run.ts` when that file crossed the size ratchet, along the seam it always had: `plan` and
 * `review` SPEND a Codex turn, `status` reads what they wrote. The report is `../../../codex/ledgerRender.ts`,
 * the floor is `../../../codex/ledger.ts`'s `loopFailures`, and the one policy here — `--check` refusing an
 * incomplete loop — goes through the `unreviewed` register row rather than a hand-written block.
 *
 * The report and the floor read ONE fold: pass records, Claude fallback review receipts
 * (`../../../codex/fallbackReview.ts`), and the LIVE quota gate (`../../../codex/quotaNow.ts`). They judge
 * different TREES, and say so. The rows are judged against the working tree, uncommitted edits included,
 * because the report answers "do these passes describe the tree in front of me". `--check` answers "would a
 * landing clear", so it is the landing verbs' own reader on this branch's tip COMMIT
 * (`../../../codex/checkoutLandingFloor.ts`), and over a dirty tree a `DIRTY:` line says the two can differ.
 *
 * The quota gate is the newest of the three and the reason is a measured defect: this verb
 * printed `no planning pass has run on this branch` — the sentence an unrun branch prints —
 * while `slopweaver codex quota show` on the same machine printed `usage-limit` evidence observed at
 * 09:27:23.357Z. A cap NEVER changes what the floor refuses; it changes whether the refusal can name rule
 * 9's cap path instead of leaving a session to narrow a diff against a transport that
 * is refusing everything.
 */

import { readCodexAccountsLive } from "../../../codex/accountLive.js";
import { type CheckoutLandingFloor, checkoutLandingFloor } from "../../../codex/checkoutLandingFloor.js";
import { worktreeDiffsForBranch } from "../../../codex/diffsNow.js";
import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { fallbackLedgerEntries } from "../../../codex/fallbackPlan.js";
import { type FallbackRegisterPort, fallbackRegisterPort } from "../../../codex/fallbackPort.js";
import { shortDigest, type TreeFingerprint } from "../../../codex/fingerprint.js";
import { type CodexFleetCap, currentCodexFleetCap } from "../../../codex/fleetCap.js";
import { codexFleetCapPort } from "../../../codex/fleetCapPort.js";
import { captureTreeFingerprint } from "../../../codex/gitDiff.js";
import { ledgerForBranch } from "../../../codex/ledger.js";
import { renderLedger } from "../../../codex/ledgerRender.js";
import type { LedgerScan } from "../../../codex/ledgerStore.js";
import { type OtherCheckoutPassSummary, otherCheckoutPassSummary } from "../../../codex/otherCheckoutPasses.js";
import { renderPolicyRefusalLines, summarizePolicyRefusals } from "../../../codex/policyRefusalSummary.js";
import { codexSignInPort } from "../../../codex/signInPort.js";
import type { SupersessionPort } from "../../../codex/supersessionPort.js";
import { supersessionPort } from "../../../codex/supersessionStore.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusal } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { planRegisterPort } from "../../../plans/port.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, type ParsedFlags, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { leftoverReportLines } from "./leftoverReport.js";
import { codexRepoRoot, reportedBranch } from "./repoScope.js";
import { statusContextLines } from "./statusContextLines.js";
import { readStatusEvidence } from "./statusEvidence.js";

/** How many argv entries precede a verb's own flags (`node`, `slopweaver`, `codex`, `status`). */
const VERB_ARG_OFFSET = 4;

/** The flags `codex status` accepts. Names omit the leading `--`, which is what `parseFlags` expects. */
const STATUS_FLAGS: FlagSpec = { boolean: ["check"], string: ["branch", "repo", "home"] };

/**
 * The same flags, `--`-prefixed, so the help-truth ratchet can check the usage string against the parser in
 * both directions. Derived from {@link STATUS_FLAGS} rather than retyped — two hand-written lists is how a
 * usage string drifts from its parser in the first place, which is the bug that ratchet exists to catch.
 */
export const CODEX_STATUS_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: STATUS_FLAGS }),
  ...booleanFlagsOf({ spec: STATUS_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `codex status` flags. Exported so the help-truth ratchet can probe the REAL parser rather than a
 * copy of it — a ratchet that checks a re-implementation proves only that the copy agrees with itself.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseCodexStatusArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({ args: rest, spec: STATUS_FLAGS });
}

/**
 * One declared string flag, or `undefined`.
 *
 * `parseFlags` types every value as `string | boolean` because one spec covers both kinds, so a boolean
 * reaching a path expecting a filesystem path would otherwise stringify to "true" and be looked up.
 */
function stringFlag({ parsed, name }: { parsed: ParsedFlags; name: string }): string | undefined {
  const value = parsed.values[name];
  return typeof value === "string" ? value : undefined;
}

/** Usage for `codex status`, kept beside the verb so `--help` and the parser share one string. */
const STATUS_USAGE =
  "usage: slopweaver codex status [--check] [--branch <name>] [--repo <dir>] [--home <dir>]\n" +
  "\n" +
  "Lists which Codex passes have run in THIS checkout for a branch, and whether each still describes the\n" +
  "current tree. Passes that never ran are listed too — an absence is the thing this exists to surface.\n" +
  "When this checkout has none but another does, an OTHER CHECKOUTS line names where they are.\n" +
  "\n" +
  "  --check   exit non-zero when the plan/review floor is unmet, for `yarn validate:pr`. Judges the branch's\n" +
  "            tip COMMIT through the landing verbs' own reader, so uncommitted edits count for nothing and\n" +
  "            a pass that read them is STALE. A remote head that differs from the local tip is not seen.";

/**
 * Report the Codex loop's state for a branch.
 *
 * Read-only and exits `EXIT_OK` even when passes are missing. Reporting is this verb's whole job; refusing a
 * PR whose loop is incomplete belongs to the gate, and collapsing the two would mean a developer could not
 * ask "where am I?" without being told off for the answer.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runCodexStatus(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: STATUS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCodexStatusArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      logger.error({ msg: e });
    });
    logger.error({ msg: STATUS_USAGE });
    return EXIT_USAGE;
  }
  const repoRoot = codexRepoRoot({ repo: stringFlag({ name: "repo", parsed: parsed.value }) });
  if (repoRoot.isErr()) {
    logger.error({ msg: `codex status: ${repoRoot.error.message}` });
    return EXIT_ERROR;
  }
  return renderStatus({
    branchFlag: stringFlag({ name: "branch", parsed: parsed.value }),
    check: parsed.value.values["check"] === true,
    // The verb's own shell is the composition root that names the production fallback port.
    fallbackPort: fallbackRegisterPort(),
    home: stringFlag({ name: "home", parsed: parsed.value }),
    repoRoot: repoRoot.value,
    // The verb's composition root: the one place the production supersession port is named.
    supersessions: supersessionPort(),
  });
}

/**
 * Refuse when the loop is incomplete, or report that it is not.
 *
 * Split from the renderer because it is a POLICY, not a presentation concern: what counts as an incomplete
 * loop is the thing most likely to be argued about, and it should be readable on its own.
 *
 * An incomplete scan arrives as one of `failures` and goes through the SAME override rather than around it.
 * Returning early meant `SLOPWEAVER_ALLOW_UNREVIEWED=1` silenced every other refusal and not that one, while
 * canon said it silences the local check — found by a Codex review of that canon.
 *
 * @param floor the landing floor's answer for this branch's tip commit
 * @returns `EXIT_OK` when the loop is complete or the override is set, `EXIT_ERROR` otherwise
 */
function enforceLoop({ floor }: { floor: CheckoutLandingFloor }): number {
  const { failures, headSha, leftovers } = floor;
  const judged = headSha === undefined ? "" : ` at ${shortDigest({ value: headSha })} as committed`;
  if (failures.length === 0) {
    logger.out({ line: "" });
    logger.out({ line: `codex status --check: the loop is complete for this branch${judged}` });
    for (const line of leftoverReportLines({ leftovers })) {
      logger.out({ line });
    }
    return EXIT_OK;
  }
  logger.error({ msg: "" });
  logger.error({ msg: `codex status --check: judged this branch${judged}, as github enqueue judges it` });
  failures.forEach((failure) => {
    logger.error({ msg: `codex status --check: ${failure}` });
  });
  if (process.env["SLOPWEAVER_ALLOW_UNREVIEWED"] === "1") {
    // Deliberately loud rather than silent. A refusal with no way through gets routed around — the hooks on
    // the previous PR were bypassed nine times running — so the path of least resistance stays "do it
    // properly" while the exception costs a keystroke and leaves this line in the log. What an override must
    // never be is invisible, because an override nobody sees is the same as no gate.
    logger.error({ msg: "codex status --check: OVERRIDDEN by SLOPWEAVER_ALLOW_UNREVIEWED=1 — say so in the PR." });
    return EXIT_OK;
  }
  // The refusal is a POLICY refusal, so it takes the four-line shape the register owns rather than a
  // hand-written block (`.claude/rules/error-handling.md`): what caught it, the legitimate exceptions, the
  // hatch, and the judgement line. The failures above are the detail; this is the door.
  logger.error({
    msg: hatchRefusal({
      detail: `${String(failures.length)} obligation(s) above`,
      hatch: hatchFor({ id: "unreviewed" }),
    }),
  });
  return EXIT_ERROR;
}

/** The branch the report is about — the flag, else the checkout's — or the exit code when there is none. */
function branchToReport({
  branchFlag,
  repoRoot,
}: {
  branchFlag: string | undefined;
  repoRoot: string;
}): string | number {
  const branch = reportedBranch({ branchFlag, repoRoot });
  if (branch === null) {
    logger.error({ msg: "codex status: HEAD is detached and no --branch was given, so there is nothing to report on" });
    return EXIT_USAGE;
  }
  return branch;
}

/**
 * Print the report itself: the ledger, its context lines (`./statusContextLines.ts`), and the live cap.
 *
 * The cap line is on the REPORT, not only on `--check`, because "where am I?" is the question a session asks
 * BEFORE it spends a pass, and "the transport is refusing everything" is the one answer this verb could not
 * give. Measured: this report listed six `NOT RUN` passes while `slopweaver codex quota show` on
 * the same machine, seconds later, printed `usage-limit` evidence observed at 09:27:23.357Z.
 *
 * @param branch the branch being reported on
 * @param cap what the whole registered Codex fleet can do right now
 * @param ledger the branch's rows and what could not be attributed to it
 * @param now the tree being compared against, absent when the fingerprint could not be captured
 * @param otherCheckouts the rows other checkouts hold on this branch, for the OTHER CHECKOUTS line
 * @param receipts what the Claude fallback receipt scan found
 * @param repoRoot the checkout, so the refusal line can name this branch's twice-refused passes
 * @param scan what the pass-record scan covered and skipped
 */
function printReport({
  branch,
  cap,
  ledger,
  now,
  otherCheckouts,
  receipts,
  repoRoot,
  scan,
}: {
  branch: string;
  cap: CodexFleetCap;
  ledger: ReturnType<typeof ledgerForBranch>;
  now: TreeFingerprint | undefined;
  otherCheckouts: OtherCheckoutPassSummary;
  receipts: FallbackReceiptScan;
  repoRoot: string;
  scan: LedgerScan;
}): void {
  const lines = renderLedger({
    branch,
    entries: ledger.entries,
    headSha: now?.headSha,
    withoutSidecar: scan.withoutSidecar,
    unattributed: ledger.unattributed,
    unplaceable: ledger.unplaceable,
    unreadable: scan.unreadable,
  });
  const context = statusContextLines({ branch, localPassCount: ledger.entries.length, now, otherCheckouts, receipts });
  for (const line of lines.concat(context)) {
    logger.out({ line });
  }
  printPolicyRefusals({ branch, receipts, repoRoot, scan });
  // Advisories come first and print whether or not the fleet is capped: a login they have not run, or a free reset
  // they hold, is the thing that turns a CAPPED line into a routed pass (`codex/fleetCap.ts` § Advisories).
  for (const advisory of cap.advisories) {
    logger.out({ line: `ADVISORY: ${advisory}` });
  }
  // The FLEET, never the ambient account (`codex/fleetCap.ts`): this line is what a session reads before
  // taking rule 9's fallback path, and printing it while a second registered destination sits open would
  // send that session to a Claude review it did not have to take.
  if (cap.capEvidence !== undefined) {
    // `why` names every refusing destination; this line must never print `CAPPED: ` and nothing after it.
    logger.out({ line: `CAPPED: ${cap.why}` });
  }
}

/**
 * The fleet's cap, read through the production ports beside the real live account read.
 *
 * @param signInPort the same sign-in register the landing floor reads, so both judge one observation set
 * @returns the fleet cap this report prints
 */
async function readFleetCap({
  home,
  signInPort,
}: {
  home: string;
  signInPort: ReturnType<typeof codexSignInPort>;
}): Promise<CodexFleetCap> {
  return currentCodexFleetCap({
    fleetCap: codexFleetCapPort(),
    home,
    nowIso: new Date().toISOString(),
    port: planRegisterPort(),
    readLive: readCodexAccountsLive,
    signInPort,
  });
}

async function renderStatus({
  fallbackPort,
  home,
  branchFlag,
  repoRoot,
  check,
  supersessions,
}: {
  fallbackPort: FallbackRegisterPort;
  home: string | undefined;
  branchFlag: string | undefined;
  repoRoot: string;
  /** Refuse rather than report: exit non-zero when the loop is incomplete. */
  check: boolean;
  /** The register of retired passes, read for the report and handed to the landing floor. */
  supersessions: SupersessionPort;
}): Promise<number> {
  const branch = branchToReport({ branchFlag, repoRoot });
  if (typeof branch === "number") {
    return branch;
  }
  const resolvedHome = resolveHome({ named: home });
  const evidence = await readStatusEvidence({ fallbackPort, home: resolvedHome, supersessions });
  if (typeof evidence === "number") {
    return evidence;
  }
  const { receipts, retired, scan } = evidence;
  const captured = captureTreeFingerprint({ cwd: repoRoot });
  const now = captured.isOk() ? captured.value : undefined;
  // The SAME fold the landing verbs read (`landingGateRun.ts`): a Claude fallback receipt is a review or plan
  // row here exactly as it is there, so `codex status` never reports a floor `github enqueue` would then refuse.
  const ledger = ledgerForBranch({
    branch,
    diffsNow: worktreeDiffsForBranch({ branch, records: scan.records, repoRoot }),
    fallbackEntries: fallbackLedgerEntries({ branch, now, repoRoot, scan: receipts }),
    now,
    records: scan.records,
    repoRoot,
    supersessions: retired,
  });
  // The verb's own shell, beside the real live account read: the composition root that names the production port.
  const signInPort = codexSignInPort();
  const cap = await readFleetCap({ home: resolvedHome, signInPort });
  // Advisory only: the table stays this checkout's, and the line says where else the branch's rows are.
  const otherCheckouts = otherCheckoutPassSummary({
    branch,
    fallbackScan: receipts,
    ownRoot: repoRoot,
    records: scan.records,
    supersessions: retired,
  });
  printReport({ branch, cap, ledger, now, otherCheckouts, receipts, repoRoot, scan });
  if (!check) {
    return EXIT_OK;
  }
  return enforceLandingFloor({ branch, fallbackPort, home: resolvedHome, repoRoot, signInPort, supersessions });
}

/**
 * `--check`'s refusal, judged by the landing verbs' own reader rather than this report's ledger: the report's rows
 * are judged against the working tree, and a landing judges the commit. `../../../codex/checkoutLandingFloor.ts`
 * carries the measurement.
 *
 * @param home the resolved state home
 * @param repoRoot the checkout whose commit the floor judges
 * @returns the exit code `enforceLoop` gives for that floor
 */
async function enforceLandingFloor({
  branch,
  fallbackPort,
  home,
  repoRoot,
  signInPort,
  supersessions,
}: {
  branch: string;
  fallbackPort: FallbackRegisterPort;
  home: string;
  repoRoot: string;
  signInPort: ReturnType<typeof codexSignInPort>;
  supersessions: SupersessionPort;
}): Promise<number> {
  return enforceLoop({
    floor: await checkoutLandingFloor({ branch, cwd: repoRoot, fallbackPort, home, signInPort, supersessions }),
  });
}

export const codexStatusCommand = defineCommand({ run: runCodexStatus });

/**
 * The `REFUSED:` lines — the refusal class counted apart from every other FATAL, because a refused review is
 * neither a cap nor a fault.
 */
function printPolicyRefusals({
  branch,
  receipts,
  repoRoot,
  scan,
}: {
  branch: string;
  receipts: FallbackReceiptScan;
  repoRoot: string;
  scan: LedgerScan;
}): void {
  const summary = summarizePolicyRefusals({
    branch,
    nowIso: new Date().toISOString(),
    receipts: receipts.receipts,
    records: scan.records,
    repoRoot,
  });
  for (const line of renderPolicyRefusalLines({ summary })) {
    logger.out({ line });
  }
}
