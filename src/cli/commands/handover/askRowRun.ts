/**
 * `slopweaver handover register` — the register between "the owner said something" and "a run exists".
 *
 * ## The gap this closes
 *
 * The board registers WORK. Nothing registered an ASK, so an ask survived only when a session happened to
 * notice it was a list. Measured from the owner's own transcripts: a batch of six numbered items
 * with screenshots reached the board inside about thirteen minutes and four of them shipped, while the same
 * evening's stuck-chat ask — given mid-paragraph in a voice dump — was restated NINE times over thirteen
 * hours before any doc existed for it. The rule is that an ask is said once and then held, never repeated
 * until it is done.
 *
 * `register` is the cheap thing a session does the moment it hears one: a row, on the same board, ranked
 * above ordinary doc work by default, with the instant the owner said it written down so the delay is measurable
 * rather than reconstructible from transcripts afterwards.
 *
 * The other end of the row is `./settleRowRun.ts`, split out under the file-size ratchet, as is the row's instant
 * (`./askRowInstant.ts`).
 */

import { ok, type Result } from "#lib/result.js";
import type { AskExampleSet } from "../../../handover/askExamples.js";
import type { AskShape } from "../../../handover/askShape.js";
import { registerProvenance } from "../../../handover/registerProvenance.js";
import { type RepoCheckoutError, resolveRepoCheckout } from "../../../handover/repoCheckout.js";
import { currentSessionId } from "../../../handover/runOwner.js";
import type { TagRequest } from "../../../handover/tagWrite.js";
import type { StatedWorkspace } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import { parseRelayAnchor, relaySlug } from "../../../talk/relayDraft.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";
import { parseHandoverRegisterArgs, REGISTER_USAGE } from "./askRowArgs.js";
import { registerFlags } from "./askRowBearsOn.js";
import { decisionVerdict } from "./askRowDecision.js";
import { registeredInstant } from "./askRowInstant.js";
import { askRowText } from "./askRowText.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { registerBranchHold } from "./registerBranchHold.js";
import { registerCallAnchorExit } from "./registerCallAnchor.js";
import { registrationHisWords } from "./registerHisWords.js";
import { registerPreWriteRefused } from "./registerPreWrite.js";
import { printRegistered } from "./registerReceipt.js";
import { plannedRow, writeRegisteredRow } from "./registerTagged.js";
import { type RegisterOrigin, registerWordsHint } from "./registerWords.js";
import { registerWorkspace } from "./registerWorkspace.js";
import { settleRelayAtAct } from "./relaySettleAtAct.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** Where `handover register`'s success receipt is written — the logger's stdout channel, or a caller's own. */
export type RegisterOut = (args: { line: string }) => void;

/**
 * A finding row's provenance from `--finding`, `--evidence` and `--observed-by` — or why the flags cannot
 * make one.
 *
 * `--observed-by` defaults to the CALLING session's own id, because the session registering a finding is
 * nearly always the one that observed it, and a session id nobody typed cannot be mistyped. With no session
 * in the environment and no flag, the verb refuses rather than writing a row whose origin cannot be checked
 * — that row would read exactly like the one this feature exists to prevent.
 *
 * @param values the parsed flag values
 * @param env the environment the session id is read from
 * @returns the provenance, `undefined` for an ordinary ask, or the refusal
 * @internal — exported only so the resolution is unit-testable without a filesystem.
 */
export function findingProvenance({
  values,
  env,
}: {
  values: Readonly<Record<string, unknown>>;
  env: NodeJS.ProcessEnv;
}): { readonly observedBy: string; readonly evidence: readonly string[] } | undefined | { readonly refusal: string } {
  const evidenceRaw = typeof values["evidence"] === "string" ? values["evidence"] : undefined;
  const observedByFlag = typeof values["observed-by"] === "string" ? values["observed-by"].trim() : undefined;
  if (values["finding"] !== true) {
    if (evidenceRaw !== undefined || observedByFlag !== undefined) {
      return { refusal: "--evidence and --observed-by only make sense with --finding" };
    }
    return undefined;
  }
  const evidence =
    evidenceRaw === undefined
      ? []
      : evidenceRaw
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
  if (evidence.length === 0) {
    return { refusal: "--finding needs --evidence <ref,...> — what was observed is the whole reason the row exists" };
  }
  const observedBy =
    observedByFlag === undefined || observedByFlag.length === 0 ? currentSessionId({ env }) : observedByFlag;
  if (observedBy === undefined) {
    return { refusal: "--finding needs --observed-by <session> — no visible session id is in this environment" };
  }
  return { evidence, observedBy };
}

/** Everything `handover register` writes, once every flag has been resolved and judged. */
interface RegisterPlan {
  readonly ask: string;
  readonly slug: string;
  readonly home: string;
  readonly dir: string | undefined;
  readonly anchor: string | undefined;
  readonly askedIso: string;
  readonly bearsOn: string | undefined;
  readonly priority: string | undefined;
  readonly repo: string | undefined;
  readonly branch: string | undefined;
  readonly finding: { readonly observedBy: string; readonly evidence: readonly string[] } | undefined;
  readonly dispatch: boolean;
  /** Whether `--full` was passed, so the receipt adds the doc's path and the settle command. */
  readonly full: boolean;
  readonly shape: AskShape | undefined;
  readonly examples: AskExampleSet | undefined;
  readonly checkedIso: string;
  readonly tags: TagRequest | undefined;
  readonly workspace: StatedWorkspace | undefined;
}

/**
 * An `--ask` as a row's `summary:` stores it unless `--keep-lines` was passed: trimmed, every whitespace run one space.
 * Exported so a caller that registered a row can recognise its own summary byte for byte (`automation seat`).
 *
 * @param ask the text as the caller passed it to `--ask`
 * @returns the one-line summary the row is written with
 */
export function foldedAsk({ ask }: { readonly ask: string }): string {
  return ask.trim().replace(/\s+/gu, " ");
}

/**
 * Everything `handover register` needs, resolved from its flags — or the usage refusal to print.
 *
 * A `refusalLines` arm sits beside `refusal` because the SHAPE gate's refusal is already whole: it carries
 * the four-line escape-hatch block, what nothing recorded, and how to spell the three flags. Squeezing that
 * through the one-string arm would print the usage block after it and bury the advice.
 *
 * `--ask` is folded to one line: the summary is a flat scalar, so a newline reached the card as a literal `\n` its
 * sentence split never breaks on, and the alignment gate judged different text from the heading it guards.
 */
function registerPlan({
  values,
  env,
  rest,
}: {
  values: Readonly<Record<string, unknown>>;
  env: NodeJS.ProcessEnv;
  rest: readonly string[];
}): { readonly refusal: string } | { readonly refusalLines: readonly string[] } | RegisterPlan {
  const typed = typeof values["ask"] === "string" ? values["ask"].trim() : "";
  const ask = foldedAsk({ ask: typed });
  if (ask.length === 0) {
    return { refusal: "--ask is required — what the owner actually said" };
  }
  const row = plannedRow({ ask, values });
  if ("refusal" in row) {
    return row;
  }
  const instant = registeredInstant({ values });
  if ("refusal" in instant) {
    return instant;
  }
  const finding = findingProvenance({ env, values });
  if (finding !== undefined && "refusal" in finding) {
    return finding;
  }
  const dispatch = values["dispatch"] === true;
  const decision = decisionVerdict({ ask, dispatch, env, finding: finding !== undefined, rest, values });
  if ("refusalLines" in decision) {
    return decision;
  }
  const flags = registerFlags({ values });
  if ("refusal" in flags) {
    return flags;
  }
  const workspace = registerWorkspace({ values });
  if ("refusal" in workspace) {
    return workspace;
  }
  // `--keep-lines` (dispatch only, `./askRowArgs.ts`): a brief whose lines code reads back. `vulnerability-fix topup`
  // registers its batch one member per line and the merge-release gate reads them off `summary:`
  // (`../../../review/vulnTopupBatchRead.ts`'s `briefDashLines`). Opt-in, never every dispatch row: a talk
  // card-landing row is a dispatch too, and the Now page heads a steer with its summary (r1 review).
  return {
    ...flags,
    ask: values["keep-lines"] === true ? typed : ask,
    askedIso: instant.askedIso,
    // The still-real check was made NOW, whenever the owner asked: this is the instant the card ages it from.
    checkedIso: new Date().toISOString(),
    dispatch,
    examples: decision.examples,
    finding,
    full: values["full"] === true,
    shape: decision.shape,
    slug: row.slug,
    tags: row.tags,
    workspace: workspace.stated,
  };
}

/**
 * The checkout a new row records: its absolute top, never what was typed, since `cmux spawn` runs git IN it and
 * `--repo slopweaver` written verbatim killed a seat twice. No `--repo` records none.
 *
 * @param requested what `--repo` was given, untrimmed, or undefined when the flag was absent
 * @param home the state home whose profile declares the main checkouts
 * @returns the checkout top to record (undefined for none), or why `--repo` names no checkout
 */
function checkoutToRecord({
  requested,
  home,
}: {
  requested: string | undefined;
  home: string;
}): Result<string | undefined, RepoCheckoutError> {
  if (requested === undefined) {
    return ok(undefined);
  }
  return resolveRepoCheckout({ home, requested });
}

/**
 * Register an ask as a board row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverRegister(argv: readonly string[]): Promise<number> {
  return registerAskRow({ argv, origin: "command", out: logger.out });
}

/**
 * Register an ask as a board row, writing its receipt lines through `out`. The seam a caller that owns stdout
 * — `github landing --json`, `github bump-drive --json` — registers through, so its document stays the only
 * thing on stdout: the chair once had to `awk` the JSON out from under these lines every pass.
 *
 * @param argv the full process argv, parsed exactly as `handover register` parses it
 * @param origin a session typing the verb, or another verb registering through it — only the first is told how to
 *   tie an unanchored row to the owner's words
 * @param out where the success receipt goes; refusals always go to stderr
 * @returns the process exit code
 */
export async function registerAskRow({
  argv,
  origin,
  out,
}: {
  argv: readonly string[];
  origin: RegisterOrigin;
  out: RegisterOut;
}): Promise<number> {
  // The deepest shell, so every caller importing this rather than `runHandoverRegister` crosses the gate too.
  const gated = refuseRunnerOnStandingRuling({ noun: "handover", rest: argv.slice(VERB_ARG_OFFSET), verb: "register" });
  if (gated !== undefined) {
    return gated;
  }
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    out({ line: REGISTER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverRegisterArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: REGISTER_USAGE });
    return EXIT_USAGE;
  }
  const planned = registerPlan({ env: process.env, rest, values: parsed.value.values });
  if ("refusalLines" in planned) {
    for (const line of planned.refusalLines) {
      logger.error({ msg: line });
    }
    return EXIT_USAGE;
  }
  if ("refusal" in planned) {
    logger.error({ msg: `handover register: ${planned.refusal}` });
    logger.error({ msg: REGISTER_USAGE });
    return EXIT_USAGE;
  }
  const callAnchorExit = registerCallAnchorExit({ anchor: planned.anchor, home: planned.home });
  if (callAnchorExit !== undefined) {
    return callAnchorExit;
  }
  const repo = checkoutToRecord({ home: planned.home, requested: planned.repo });
  if (repo.isErr()) {
    logger.error({ msg: `handover register: ${repo.error.message}` });
    logger.error({ msg: REGISTER_USAGE });
    return EXIT_USAGE;
  }
  const plan = { ...planned, repo: repo.value };
  if (await registerPreWriteRefused({ plan })) {
    return EXIT_ERROR;
  }
  const branchHeld = registerBranchHold({ branch: plan.branch, home: plan.home, repo: plan.repo, slug: plan.slug });
  if (branchHeld !== undefined) {
    logger.warn({ msg: branchHeld });
  }
  return writeAskRow({ origin, out, plan });
}

/** Write a judged plan as its row, then print the receipt — and, to a session typing the verb, the words hint. */
async function writeAskRow({
  plan,
  origin,
  out,
}: {
  plan: RegisterPlan;
  origin: RegisterOrigin;
  out: RegisterOut;
}): Promise<number> {
  const code = await writeRegisteredRow({
    handoverDir: resolveHandoverDir({ dir: plan.dir, home: plan.home }),
    home: plan.home,
    out,
    printed: (path) => {
      printRegistered({
        full: plan.full,
        held: plan.repo === undefined,
        unplaced: plan.workspace === undefined,
        observedBy: plan.finding?.observedBy,
        out,
        path,
        slug: plan.slug,
      });
      const hint = registerWordsHint({ ...plan, finding: plan.finding !== undefined, origin });
      if (hint !== undefined) {
        out({ line: hint });
      }
    },
    slug: plan.slug,
    tags: plan.tags,
    text: askRowText({
      ...plan,
      hisWords: registrationHisWords({ anchor: plan.anchor, home: plan.home }),
      provenance: registerProvenance({ cwd: process.cwd(), env: process.env, home: plan.home }),
    }),
  });
  await fileRelayCutFrom({ code, plan });
  return code;
}

/**
 * A row cut from a voice relay files the relay into it, in the same act: the relay row ends, and the lineage the
 * cut row's own settle later checks is written while it is still possible to write it (`./relaySettleAtAct.ts`).
 * The relay's own registration — `talk relay` registering the relay row itself — is not a cut and is skipped.
 *
 * @param code what the row write exited with; nothing is filed into a row that was not written
 * @param plan the registered row
 */
async function fileRelayCutFrom({ code, plan }: { code: number; plan: RegisterPlan }): Promise<void> {
  if (code !== EXIT_OK || plan.anchor === undefined) {
    return;
  }
  const relay = parseRelayAnchor({ text: plan.anchor });
  if (relay === undefined || relaySlug({ turnId: relay.slice(relay.indexOf(":") + 1) }) === plan.slug) {
    return;
  }
  await settleRelayAtAct({ dir: plan.dir, home: plan.home, pointer: relay, verb: "handover register" });
}

export const handoverRegisterCommand = defineCommand({ run: runHandoverRegister });
