/**
 * The effectful shells for the two Gmail verbs that produce outbound mail — `gmail draft` and `gmail send`.
 *
 * ## The two verbs are deliberately not one verb with a flag
 *
 * There is no `gmail send --to … --body …`, and no `gmail draft --and-send`. Composing and delivering are
 * separate invocations against a draft that exists in between, because that makes "a message was reviewed
 * before it went" a property of the SHAPE rather than of anybody's discipline. Every send is a send of
 * something already written down, already read back from the mail server, and already printed in full.
 *
 * ## Where the door sits on each
 *
 * `draft` routes its create through the door as an ordinary `external-write` with no gate: it changes the
 * owner's own mailbox and reaches nobody. `send` routes through the door carrying
 * {@link ../../../outbound/gmail/approvalGate.gmailSendApprovalGate}, which HOLDS unless `--approve`
 * carries the digest of the draft as it stands. A hold is not waivable by `$SLOPWEAVER_DOOR_OVERRIDE` —
 * that is the door's own type-level contract, not a convention this file keeps.
 *
 * A refused send still writes its decision to the ledger, and that is wanted rather than tolerated: on a
 * surface that reaches other people, an attempt is itself a fact worth recording. This is the one place the
 * mutation shells' "return before the door on a dry run" rule does NOT apply, and the reason is that
 * nothing here is a dry run — the caller asked to send, and the answer was no.
 *
 * Every edge is injected, so both shells are unit tested with plain fakes and no mailbox.
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { type NotPerformed, notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorGate } from "../../../admit/types.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { GmailError } from "../../../live/gmail/errors.js";
import type { GmailDraftOutcome, GmailDraftPlan, GmailSendOutcome, GmailSendPlan } from "../../../live/gmail/outbox.js";
import {
  renderGmailDraftOutcomeText,
  renderGmailDraftPlanText,
  renderGmailSendOutcomeText,
  renderGmailSendPlanText,
} from "../../../live/gmail/renderOutbox.js";
import { gmailSendApprovalGate } from "../../../outbound/gmail/approvalGate.js";
import { refusedBeforeGmailWire } from "../../../outbound/gmail/sendFailure.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type BoardDraftSource, boardSenderMismatch } from "./boardDraft.js";
import { draftSource, draftUnderClaim, recordBoardReceipt, type StoreEnding } from "./boardDraftRun.js";
import { type GmailDraftArgs, type GmailSendArgs, parseGmailDraftArgs, parseGmailSendArgs } from "./composeCore.js";
import { productionGmailComposeDeps } from "./composeDeps.js";
import { gmailArgsErrorLines } from "./errors.js";

const VERB_ARG_OFFSET = 4;

/**
 * The seams the two outbound shells perform their effects through. Each plan and apply seam takes the home the verb
 * resolved ONCE, never `undefined`: a seam left to look up the ambient home itself could judge a write under a
 * different home's private terms than the one its claim and door used.
 */
export interface GmailComposeDeps {
  readonly planDraft: (args: {
    home: string;
    formJson: string;
    replyToId: string | undefined;
  }) => Promise<Result<GmailDraftPlan, GmailError>>;
  readonly applyDraft: (args: {
    home: string;
    plan: GmailDraftPlan;
    /** One attempt only, no retry of a lost response: set for a board draft, which promises one draft per press. */
    once: boolean;
  }) => Promise<Result<GmailDraftOutcome, GmailError>>;
  readonly planSend: (args: { home: string; draftId: string }) => Promise<Result<GmailSendPlan, GmailError>>;
  readonly applySend: (args: { home: string; plan: GmailSendPlan }) => Promise<Result<GmailSendOutcome, GmailError>>;
  readonly readStdin: () => Promise<string>;
  readonly home: () => string;
  /** Whether a pid is still in the process table: tells a press in flight from one that died holding its claim. */
  readonly pidAlive: (args: { pid: number }) => boolean;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The door ledger every draft and send attempt's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The door request storing one draft makes.
 *
 * The artifact carries recipient COUNTS and the subject's length — never an address, a subject or a body.
 * A draft is mail that has not been sent, and the record of having written one does not need to contain it.
 */
function draftDoorRequest({
  plan,
  home,
}: {
  plan: GmailDraftPlan;
  home: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "gmail", verb: "draft" },
    artifact: {
      bcc: plan.form.bcc.length,
      cc: plan.form.cc.length,
      isReply: plan.reply !== undefined,
      subjectLength: plan.form.subject.length,
      to: plan.form.to.length,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * The door request one send makes.
 *
 * It carries the DIGEST rather than the message, which is exactly the right amount: enough for a later
 * reader to tie a ledger row to the content that was approved, and not enough to reconstruct the mail from
 * the ledger. Recipient counts go in for the same reason they do on a draft — "who" is not the ledger's
 * business, "how many" is.
 */
function sendDoorRequest({
  plan,
  home,
}: {
  plan: GmailSendPlan;
  home: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  return {
    action: { kind: "verb", noun: "gmail", verb: "send" },
    artifact: {
      bcc: plan.bcc.length,
      cc: plan.cc.length,
      digest: plan.digest,
      draftId: plan.draftId,
      to: plan.to.length,
    },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
  };
}

/**
 * Run `gmail draft` against injected edges.
 *
 * @param args the parsed request
 * @param deps the compose, store and output seams
 * @returns the process exit code
 */
export async function runGmailDraft({ args, deps }: { args: GmailDraftArgs; deps: GmailComposeDeps }): Promise<number> {
  const { home = deps.home() } = args;
  const source = await draftSource({ args, deps, home });
  if (source.isErr()) {
    deps.writeDiagnostic(source.error.message);
    return EXIT_ERROR;
  }
  const { board, formJson, replyToId } = source.value;
  const planned = await deps.planDraft({ formJson, home, replyToId });
  if (planned.isErr()) {
    deps.writeDiagnostic(planned.error.message);
    return EXIT_ERROR;
  }
  const sender =
    board === undefined ? undefined : boardSenderMismatch({ bound: planned.value.from, recorded: board.action.from });
  if (sender !== undefined) {
    deps.writeDiagnostic(sender.message);
    return EXIT_ERROR;
  }
  if (args.dryRun) {
    deps.writeOut(
      args.json
        ? JSON.stringify({ plan: planned.value, stored: false }, undefined, 2)
        : renderGmailDraftPlanText({ plan: planned.value }),
    );
    return EXIT_OK;
  }
  if (board === undefined) {
    const stored = await storeDraft({ args, board, deps, home, plan: planned.value });
    return stored.exit;
  }
  return draftUnderClaim({
    board,
    deps,
    home,
    store: () => storeDraft({ args, board, deps, home, plan: planned.value }),
  });
}

/**
 * Store one planned draft through the door, and for a board draft record its receipt.
 *
 * @param board the row the mail came off, or `undefined` for a `--form` draft
 * @returns the exit code, and whether the claim must be kept because the draft exists with no receipt
 */
async function storeDraft({
  args,
  board,
  deps,
  home,
  plan,
}: {
  args: GmailDraftArgs;
  board: BoardDraftSource | undefined;
  deps: GmailComposeDeps;
  home: string;
  plan: GmailDraftPlan;
}): Promise<StoreEnding> {
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => deps.applyDraft({ home, once: board !== undefined, plan }),
    request: draftDoorRequest({ home, plan }),
  });
  if (!routed.performed) {
    return {
      exit: reportRefusal({ command: "slopweaver gmail draft", deps, through: routed }),
      keepClaim: false,
    };
  }
  if (routed.result.isErr()) {
    deps.writeDiagnostic(routed.result.error.message);
    // An API failure may have come AFTER Gmail stored the draft (a lost response), and a detached reply WAS
    // stored, so a board draft keeps its claim on either: the next press is refused as abandoned, naming where
    // to look, rather than drafting it twice. The one API failure that provably sent nothing is the transport's
    // own pre-wire refusal (`refusedBeforeGmailWire`), so that releases the claim for the reworded press.
    const { code } = routed.result.error;
    const unsent = refusedBeforeGmailWire({ error: routed.result.error });
    const mayExist = !unsent && (code === "API_FAILED" || code === "REPLY_DETACHED");
    return { exit: EXIT_ERROR, keepClaim: board !== undefined && mayExist };
  }
  deps.writeOut(
    args.json
      ? JSON.stringify({ outcome: routed.result.value, stored: true }, undefined, 2)
      : renderGmailDraftOutcomeText({ outcome: routed.result.value }),
  );
  return recordBoardReceipt({ board, deps, draftId: routed.result.value.draftId, home });
}

/** Print a door refusal in the one shape every refusal in this repo carries ({@link ../../../admit/doorRefusal}). */
function reportRefusal({
  deps,
  command,
  through,
}: {
  deps: GmailComposeDeps;
  command: string;
  through: NotPerformed;
}): number {
  for (const line of notPerformedLines({ command, through })) {
    deps.writeDiagnostic(line);
  }
  return EXIT_ERROR;
}

/**
 * Run `gmail send` against injected edges.
 *
 * The preview is printed BEFORE the door decides, and on every path. A caller who is about to be refused
 * needs to see what they would have sent even more than one who is about to succeed — the refusal's whole
 * purpose is to put that text in front of a person.
 *
 * @param args the parsed request
 * @param deps the plan, send and output seams
 * @returns the process exit code
 */
export async function runGmailSend({ args, deps }: { args: GmailSendArgs; deps: GmailComposeDeps }): Promise<number> {
  const { home = deps.home() } = args;
  const planned = await deps.planSend({ draftId: args.draftId, home });
  if (planned.isErr()) {
    deps.writeDiagnostic(planned.error.message);
    return EXIT_ERROR;
  }
  const plan = planned.value;
  if (!args.json) {
    deps.writeOut(renderGmailSendPlanText({ plan }));
  }
  const gates: readonly DoorGate[] = [gmailSendApprovalGate({ expected: plan.digest, supplied: args.approve })];
  const routed = await throughDoor({
    gates,
    home,
    ledger: deps.doorLedger,
    perform: () => deps.applySend({ home, plan }),
    request: sendDoorRequest({ home, plan }),
  });
  if (!routed.performed) {
    if (args.json) {
      // A recording refusal is not a policy verdict (the door may even have said `pass`), so the store's own
      // message rides beside the decision rather than the refusal being relabelled as a hold.
      const recording = routed.kind === "recording-refused" ? { error: routed.error.message } : {};
      deps.writeOut(JSON.stringify({ decision: routed.decision, ...recording, plan, sent: false }, undefined, 2));
    }
    return reportRefusal({ command: "slopweaver gmail send", deps, through: routed });
  }
  if (routed.result.isErr()) {
    deps.writeDiagnostic(routed.result.error.message);
    return EXIT_ERROR;
  }
  deps.writeOut(
    args.json
      ? JSON.stringify({ outcome: routed.result.value, sent: true }, undefined, 2)
      : renderGmailSendOutcomeText({ outcome: routed.result.value }),
  );
  return EXIT_OK;
}

/** `slopweaver gmail draft`. */
export const gmailDraftCommand = defineCommand({
  run: async (argv) => {
    const parsed = parseGmailDraftArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
        logger.warn({ msg: line });
      }
      return EXIT_USAGE;
    }
    return runGmailDraft({ args: parsed.value, deps: productionGmailComposeDeps() });
  },
});

/** `slopweaver gmail send`. */
export const gmailSendCommand = defineCommand({
  run: async (argv) => {
    const parsed = parseGmailSendArgs({ rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      for (const line of [...gmailArgsErrorLines({ error: parsed.error }), parsed.error.usage]) {
        logger.warn({ msg: line });
      }
      return EXIT_USAGE;
    }
    return runGmailSend({ args: parsed.value, deps: productionGmailComposeDeps() });
  },
});
