/**
 * `spend forward` — the fleet half of option C: read the newest Airwallex task reminder as
 * `spend tasks` does, and for each card expense whose receipt it matched, write a forward of that receipt to
 * Airwallex's receipts address into their own Gmail Drafts, PDF kept and subject unchanged.
 *
 * ## It never sends
 *
 * Mailing Airwallex puts something in front of another party, and that is their yes once per send: they press Send in
 * Gmail. So the verb holds the Gmail `compose` capability and never `send`, and the one call it makes that changes
 * their mailbox is `drafts.create`, routed through the door like `gmail draft`'s.
 *
 * ## One draft per receipt, ever
 *
 * The reminder restates the open set every morning, so a daily run meets the same receipt until Airwallex matches
 * it. `./forwardClaim.ts` claims each receipt before Gmail is called and records the draft once stored; a later run
 * names that draft and creates nothing. Gmail gets ONE attempt per claim, and an API failure KEEPS the claim, since
 * Gmail may have stored the draft before failing — the next run reports it abandoned, naming where to look.
 *
 * Every edge is injected, so the shell is tested with plain fakes and no mailbox.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GmailApi } from "../../../live/gmail/api.js";
import {
  applyGmailForwardDraft,
  type GmailForwardOutcome,
  planGmailForwardDraft,
} from "../../../live/gmail/forward.js";
import { pidAlive } from "../../../live/listen/supervise/currentLiveness.js";
import { formatMoney } from "../../../spend/money.js";
import { AIRWALLEX_RECEIPTS_ADDRESS } from "../../../spend/tasks/invoiceMatch.js";
import { readTasks, type TaskAct, type TasksMailbox } from "../../../spend/tasks/read.js";
import { invoiceClause } from "../../../spend/tasks/render.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseSpendForwardArgs } from "./core.js";
import {
  claimForward,
  type DraftedForward,
  draftedForwards,
  expenseKeyOf,
  openPerKeyOf,
  recordForward,
  releaseForward,
} from "./forwardClaim.js";
import { forwardDoorRequest } from "./forwardDoor.js";
import { attachmentsFor, productionDrafts, readPulledFile } from "./forwardEdges.js";
import { draftLink, type ForwardLine, type ForwardOutcome, forwardExit, renderForwardReport } from "./forwardReport.js";
import { type ReadSpendMerchants, readSpendMerchants, registeredMerchants } from "./merchantSeam.js";
import { productionMailbox } from "./tasksRun.js";
import { SPEND_FORWARD_USAGE } from "./usage.js";

/** The argv index the `spend forward` tail starts at. */
const VERB_ARG_OFFSET = 4;

/** The command a door refusal names. */
const COMMAND = "slopweaver spend forward";

/** The seams `spend forward` performs its effects through. */
export interface SpendForwardDeps {
  /** Bind the mailbox's reads for a home, or say why it cannot be. */
  readonly mailbox: (args: { home: string }) => Result<TasksMailbox, { message: string }>;
  /** Bind the draft call — the compose capability — for a home, or say why it cannot be. */
  readonly drafts: (args: { home: string }) => Result<Pick<GmailApi, "createDraft">, { message: string }>;
  /** The install's card-merchant register, read before any mailbox is bound or any claim taken. */
  readonly readMerchants: ReadSpendMerchants;
  /** The door ledger each stored draft's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
  /** Read one pulled file back to attach. */
  readonly readBytes: (args: { path: string }) => Result<Uint8Array, { message: string }>;
  readonly pid: number;
  readonly pidAlive: (args: { pid: number }) => boolean;
  readonly nowIso: () => string;
  readonly defaultHome: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/** Everything one act's forward needs beyond the act itself. */
interface ForwardContext {
  readonly deps: SpendForwardDeps;
  readonly home: string;
  readonly mailbox: TasksMailbox;
  readonly drafts: Pick<GmailApi, "createDraft"> | undefined;
  readonly dryRun: boolean;
  /** Every draft an earlier run stored, for the one-forward-per-charge check. */
  readonly drafted: readonly DraftedForward[];
  /** How many open expenses in this reading share each charge key. */
  readonly openPerKey: ReadonlyMap<string, number>;
}

/**
 * Plan, claim, and store one matched act's forward — or say why not.
 *
 * @returns the outcome; a failure is an outcome, so one bad receipt never hides the rest
 */
async function forwardOne({ act, context }: { act: TaskAct; context: ForwardContext }): Promise<ForwardOutcome> {
  const { invoice } = act;
  if (invoice.kind !== "matched") {
    return { kind: "nothing-to-forward", why: invoiceClause({ account: context.mailbox.account, act }) };
  }
  const key = expenseKeyOf({ act });
  // Another receipt already forwarded for this charge — as many as the reminder holds charges of it — means a
  // second receipt matched later would be a second forward of one charge.
  const others = context.drafted.filter((claim) => claim.expenseKey === key && claim.receiptId !== invoice.messageId);
  const earlier = others[0];
  const open = context.openPerKey.get(key)!;
  if (earlier !== undefined && others.length >= open) {
    return {
      draftId: earlier.draftId,
      kind: "already-drafted",
      link: draftLink({ messageId: earlier.draftMessageId }),
    };
  }
  const source = await context.mailbox.readFull({ id: invoice.messageId });
  if (source.isErr()) {
    return { kind: "failed", why: `receipt ${invoice.messageId}: ${source.error.message}` };
  }
  const attachments = attachmentsFor({ act, readBytes: context.deps.readBytes });
  if (attachments.isErr()) {
    return { kind: "failed", why: attachments.error.message };
  }
  const { body, from, sentAtIso, subject, to } = source.value.message;
  const plan = planGmailForwardDraft({
    account: context.mailbox.account,
    attachments: attachments.value,
    source: { body, from, sentAtIso, subject, to },
    to: [AIRWALLEX_RECEIPTS_ADDRESS],
  });
  if (plan.isErr()) {
    return { kind: "failed", why: plan.error.message };
  }
  if (context.dryRun || context.drafts === undefined) {
    return { files: attachments.value.length, kind: "would-draft", receipt: invoice.permalink };
  }
  return storeForward({ act, context, drafts: context.drafts, key, plan: plan.value });
}

/**
 * Claim the receipt, store its planned forward through the door, and record the draft on the claim.
 *
 * @returns the outcome
 */
async function storeForward({
  act,
  context,
  drafts,
  key,
  plan,
}: {
  act: TaskAct;
  context: ForwardContext;
  drafts: Pick<GmailApi, "createDraft">;
  key: string;
  plan: Parameters<typeof applyGmailForwardDraft>[0]["plan"];
}): Promise<ForwardOutcome> {
  if (act.invoice.kind !== "matched") {
    return { kind: "nothing-to-forward", why: "no matched receipt" };
  }
  const receiptId = act.invoice.messageId;
  const { deps, home } = context;
  const claimed = claimForward({ alive: deps.pidAlive, expenseKey: key, home, pid: deps.pid, receiptId });
  if (claimed.isErr()) {
    return { kind: "failed", why: claimed.error.message };
  }
  if (claimed.value.kind === "drafted") {
    const { draftId, draftMessageId } = claimed.value;
    return { draftId, kind: "already-drafted", link: draftLink({ messageId: draftMessageId }) };
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => applyGmailForwardDraft({ api: drafts, plan }),
    request: forwardDoorRequest({ home, plan, receiptId }),
  });
  if (!routed.performed) {
    releaseForward({ home, receiptId });
    for (const line of notPerformedLines({ command: COMMAND, through: routed })) {
      deps.writeDiagnostic(line);
    }
    if (routed.kind === "recording-refused") {
      return {
        kind: "failed",
        why: `the door could not record the draft, so it was not stored: ${routed.error.message}`,
      };
    }
    return { kind: "failed", why: "the door refused the draft" };
  }
  if (routed.result.isErr()) {
    // A lost response may come AFTER Gmail stored the draft, so an API failure keeps the claim: the next run reports
    // it abandoned, naming where to look, rather than drafting the receipt twice. Anything else reached no Gmail.
    if (routed.result.error.code !== "API_FAILED") {
      releaseForward({ home, receiptId });
    }
    return { kind: "failed", why: routed.result.error.message };
  }
  return recordOutcome({ context, key, outcome: routed.result.value, receiptId });
}

/**
 * Write the stored draft into its claim, and report it.
 *
 * @returns drafted — or failed when the claim could not record it, the draft existing all the same
 */
function recordOutcome({
  context,
  key,
  outcome,
  receiptId,
}: {
  context: ForwardContext;
  key: string;
  outcome: GmailForwardOutcome;
  receiptId: string;
}): ForwardOutcome {
  const link = draftLink({ messageId: outcome.draftMessageId });
  const recorded = recordForward({
    draft: { draftId: outcome.draftId, draftMessageId: outcome.draftMessageId, expenseKey: key, receiptId },
    draftedAtIso: context.deps.nowIso(),
    home: context.home,
    pid: context.deps.pid,
  });
  if (recorded.isErr()) {
    return {
      kind: "failed",
      why: `draft ${outcome.draftId} IS stored in their Drafts, but its claim was not updated — ${recorded.error.message}`,
    };
  }
  return { draftId: outcome.draftId, kind: "drafted", link };
}

/**
 * Run `spend forward` against injected edges.
 *
 * @param rest the argv tail after `spend forward`
 * @param deps the injected edges
 * @returns 0 when every matched receipt is drafted, 1 when any failed, 3 when nothing was there to forward
 */
export async function runSpendForward({
  deps,
  rest,
}: {
  deps: SpendForwardDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(SPEND_FORWARD_USAGE);
    return EXIT_OK;
  }
  const parsed = parseSpendForwardArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(SPEND_FORWARD_USAGE);
    return EXIT_USAGE;
  }
  const home = homeFor({ deps, flag: parsed.value.home });
  const merchants = await registeredMerchants({ deps, home, verb: "spend forward" });
  if (merchants.isErr()) {
    return EXIT_ERROR;
  }
  const edges = bindEdges({ deps, dryRun: parsed.value.dryRun, home });
  if (edges.isErr()) {
    deps.writeDiagnostic(`spend forward: ${edges.error.message}`);
    return EXIT_ERROR;
  }
  const { drafts, mailbox } = edges.value;
  const reading = await readTasks({ mailbox, merchants: merchants.value });
  if (reading.isErr()) {
    deps.writeDiagnostic(`spend forward: ${reading.error.message}`);
    return EXIT_ERROR;
  }
  if (reading.value.kind === "no-reminder") {
    deps.writeOut(`spend forward: no Airwallex task reminder in the inbox of ${reading.value.account} — nothing to do`);
    return EXIT_EXPECTED_EMPTY;
  }
  const { acts } = reading.value;
  const context: ForwardContext = {
    deps,
    drafted: draftedForwards({ home }),
    drafts,
    dryRun: parsed.value.dryRun,
    home,
    mailbox,
    openPerKey: openPerKeyOf({ acts }),
  };
  const lines: ForwardLine[] = [];
  for (const act of acts) {
    const { amount, day, merchant } = act.expense;
    lines.push({
      expense: `${merchant} ${formatMoney({ money: amount })} (${day})`,
      outcome: await forwardOne({ act, context }),
    });
  }
  deps.writeOut(renderForwardReport({ account: reading.value.account, json: parsed.value.json, lines }));
  return forwardExit({ lines });
}

/**
 * Bind the mailbox's reads and — unless this is a dry run — the draft call, for one home.
 *
 * @returns both edges, or the first that could not be bound
 */
function bindEdges({
  deps,
  dryRun,
  home,
}: {
  deps: SpendForwardDeps;
  dryRun: boolean;
  home: string;
}): Result<{ mailbox: TasksMailbox; drafts: Pick<GmailApi, "createDraft"> | undefined }, { message: string }> {
  const mailbox = deps.mailbox({ home });
  if (mailbox.isErr()) {
    return err(mailbox.error);
  }
  if (dryRun) {
    return ok({ drafts: undefined, mailbox: mailbox.value });
  }
  return deps.drafts({ home }).map((drafts) => ({ drafts, mailbox: mailbox.value }));
}

/** The home `--home` names, or the default one when the flag is absent by design. */
function homeFor({ deps, flag }: { deps: SpendForwardDeps; flag: string | undefined }): string {
  if (flag === undefined) {
    return deps.defaultHome();
  }
  return flag;
}

/** `slopweaver spend forward` — draft a forward of each matched receipt to Airwallex's receipts address. */
export const spendForwardCommand = defineCommand({
  run: (argv) =>
    runSpendForward({
      deps: {
        defaultHome: () => slopweaverHome(),
        doorLedger: doorLedgerPort(),
        drafts: productionDrafts,
        mailbox: productionMailbox,
        nowIso: () => new Date().toISOString(),
        pid: process.pid,
        pidAlive,
        readBytes: readPulledFile,
        readMerchants: readSpendMerchants,
        writeDiagnostic: (line) => {
          logger.warn({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
