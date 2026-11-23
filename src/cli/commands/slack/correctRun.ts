/**
 * `slack correct` — the shell around `../../../outbound/slack/claimCorrection.ts`. A later re-read found newer
 * evidence against a claim the bot made; this strikes the claim where readers saw it and puts a bold Correction line
 * under it, in place.
 *
 * The order is the lifecycle verbs' order, and each step is a refusal before any write:
 *
 * 1. **The owner's magnitude line** — a figure moved by an order of magnitude goes to the owner first, as a
 *    question on the Queue, and is corrected only with `--magnitude-seen <anchor>` naming their answer. A same-order
 *    correction goes out without them. Pure, so it refuses before a token is read.
 * 2. **The voice rules** over the one authored line, at the door like every edit.
 * 3. **Ownership** — only a card or answer this bot posted, the same check `slack edit` runs; or, `--as me`, only a
 *    message the as-me draft register shows Slopweaver released under the owner's name, edited with the owner's token.
 * 4. **The parked DM**, on `--urgent`: a held direct-message row must already exist. This verb never sends a DM; the
 *    row waits for the owner's approval on the Queue like every unasked message to a person (rule 10).
 * 5. **The edit**, through the door, riding the original send's approval — and then a READ-BACK of where it landed,
 *    because Slack accepting a `chat.update` is not the same as the reader seeing the strike.
 *
 * Steps 1, 2 and 4, with the bot token, are `./correctGate.ts`'s `correctPreWriteGate`, which also declares
 * `CorrectDeps`.
 */
import { throughDoor } from "../../../admit/effects.js";
import { readSlackDraftLines } from "../../../admit/slackDraftStore.js";
import type { DoorRequest } from "../../../admit/types.js";
import { slopweaverHome } from "../../../config.js";
import type { PostedMessage, SlackWriteTransport } from "../../../corpus/slack/writeTransport.js";
import { hatchOpen } from "../../../hatch/open.js";
import { logger } from "../../../lib/logger.js";
import {
  ASSISTANT_ANSWER_EVENT_TYPE,
  ASSISTANT_ANSWER_EVENT_TYPE_V2,
} from "../../../outbound/assistant/answerMessage.js";
import { asMeAuthorship, asMeAuthorshipRefusal } from "../../../outbound/slack/asMeAuthorship.js";
import { type CorrectedMessage, claimCorrectedAs, correctClaim } from "../../../outbound/slack/claimCorrection.js";
import { type MagnitudeShift, magnitudeShift } from "../../../outbound/slack/claimMagnitude.js";
import { parseSlackDraftLog } from "../../../outbound/slack/draftLog.js";
import type { ReadSlackMessage } from "../../../outbound/slack/lifecycleGuards.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { slackArgumentErrorLines } from "./argumentErrors.js";
import { type CorrectOptions, parseCorrectArgs } from "./correctArgs.js";
import { type CorrectDeps, correctPreWriteGate } from "./correctGate.js";
import { productionLifecycleDeps } from "./lifecycleRun.js";
import { acceptedCardEventTypes, requireOwnership } from "./lifecycleRunGuards.js";
import { gatesFor, reportNotPerformed, usage } from "./lifecycleRunShared.js";

/**
 * Who is running the correction: the door action it is journalled under, and what a re-run that finds the claim
 * already struck means. `slack correct` itself answers "already corrected" (exit 3); `witness revise` journals a row
 * only once the correction is shown, so a re-run finding THIS exact line already there is the edit having landed
 * before a crash, and is a success (exit 0) — a different line, or none, still exits 3.
 */
export interface CorrectRunContext {
  readonly action: { readonly kind: "verb"; readonly noun: string; readonly verb: string };
  readonly alreadyCorrected: "expected-empty" | "landed-if-same";
}

/** `slack correct`'s own context. */
const SLACK_CORRECT_CONTEXT: CorrectRunContext = {
  action: { kind: "verb", noun: "slack", verb: "correct" },
  alreadyCorrected: "expected-empty",
};

/**
 * Run `slack correct` against an injected world.
 *
 * @param options the parsed invocation
 * @param deps the injected world
 * @param context who runs it — `slack correct` when absent, `witness revise` for a posted witness reply
 * @returns the process exit code
 */
export async function runCorrect({
  options,
  deps,
  context = SLACK_CORRECT_CONTEXT,
}: {
  options: CorrectOptions;
  deps: CorrectDeps;
  context?: CorrectRunContext;
}): Promise<number> {
  const shift = magnitudeShift({ correction: options.correction, wrong: options.wrong });
  const ready = correctPreWriteGate({ deps, options, shift });
  if (ready.kind === "refused") {
    return ready.exit;
  }
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const transport = deps.makeTransport({ home: options.home, token: ready.token });
  const existing = await ownedTarget({ deps, options, posted, transport });
  if (existing === undefined) {
    return EXIT_ERROR;
  }
  const corrected = correctClaim({
    correction: options.correction,
    stored: storedOf({ existing }),
    wrong: options.wrong,
  });
  if (corrected.isErr()) {
    return corrected.error.code === "CLAIM_ALREADY_STRUCK"
      ? alreadyStruckExit({ context, deps, existing, message: corrected.error.message, options })
      : usage({ errors: [corrected.error.message] });
  }
  if (options.dryRun) {
    const asMe = options.actor === "me" ? " (as me)" : "";
    deps.out(
      `dry run — nothing was changed. would chat.update${asMe} ${options.channel}/${options.ts}, striking the claim in ` +
        `${corrected.value.struckIn} and keeping ${String(existing.fileIds.length)} file(s)`,
    );
    return EXIT_OK;
  }
  return strikeThroughDoor({
    action: context.action,
    corrected: corrected.value,
    deps,
    fileIds: existing.fileIds,
    options,
    posted,
    rules: ready.rules,
    shift,
    transport,
  });
}

/**
 * Read the target back and refuse unless Slopweaver sent it under the identity this invocation corrects as: the bot's
 * own card or answer, or — `--as me` — a message the as-me draft register shows released under the owner's name
 * (`../../../outbound/slack/asMeAuthorship.ts`). Nothing is written on a refusal.
 *
 * @param posted the message the correction targets
 * @param transport the Slack seam, signed in as the identity the correction edits under
 * @returns the message read back, or `undefined` having already logged why
 */
async function ownedTarget({
  deps,
  options,
  posted,
  transport,
}: {
  deps: CorrectDeps;
  options: CorrectOptions;
  posted: PostedMessage;
  transport: SlackWriteTransport;
}): Promise<ReadSlackMessage | undefined> {
  if (options.actor === "bot") {
    return requireOwnership({
      expectedEventTypes: [
        ...acceptedCardEventTypes({ chrome: deps.cardChrome({ home: options.home }) }),
        ASSISTANT_ANSWER_EVENT_TYPE,
        ASSISTANT_ANSWER_EVENT_TYPE_V2,
      ],
      posted,
      transport,
    });
  }
  const message = await transport.readMessage({ posted });
  if (message === undefined) {
    logger.error({
      msg: `no message at ${posted.ts} in ${posted.channel} — refusing to correct a target that is not there`,
    });
    return undefined;
  }
  const self = await transport.whoAmI();
  const verdict = asMeAuthorship({
    log: parseSlackDraftLog({ lines: deps.readDraftLog({ home: options.home }) }),
    message,
    posted,
    selfUserId: self.userId,
  });
  if (verdict.kind !== "owned") {
    logger.error({ msg: asMeAuthorshipRefusal({ posted, verdict }) });
    return undefined;
  }
  return message;
}

/**
 * What a claim found already struck means to this runner: for `witness revise`, THIS exact line already shown is the
 * edit having landed before a crash (exit 0); anything else is already corrected (exit 3).
 *
 * @param message the refusal `correctClaim` gave
 * @returns the process exit code
 */
function alreadyStruckExit({
  context,
  deps,
  existing,
  message,
  options,
}: {
  context: CorrectRunContext;
  deps: CorrectDeps;
  existing: ReadSlackMessage;
  message: string;
  options: CorrectOptions;
}): number {
  const sameLine =
    context.alreadyCorrected === "landed-if-same" &&
    claimCorrectedAs({ correction: options.correction, stored: storedOf({ existing }), wrong: options.wrong });
  if (sameLine) {
    deps.out(`already shows this exact correction — ${options.channel}/${options.ts}: nothing was changed`);
    return EXIT_OK;
  }
  deps.out(`already corrected — ${options.channel}/${options.ts}: ${message}`);
  return EXIT_EXPECTED_EMPTY;
}

/**
 * Route the strike through the door — the voice rules over the one authored line, riding the original send's
 * approval — then read back where it landed.
 *
 * @param action the door action the write is journalled under
 * @param corrected the rewritten message `correctClaim` produced
 * @param fileIds the files the original carried, kept on the update
 * @param rules the exact voice rules the door applies to the correction line
 * @param shift the figures, when the correction moved one by an order of magnitude
 * @returns the process exit code
 */
async function strikeThroughDoor({
  action,
  corrected,
  deps,
  fileIds,
  options,
  posted,
  rules,
  shift,
  transport,
}: {
  action: CorrectRunContext["action"];
  corrected: CorrectedMessage;
  deps: CorrectDeps;
  fileIds: readonly string[];
  options: CorrectOptions;
  posted: PostedMessage;
  rules: readonly ExactVoiceRule[];
  shift: MagnitudeShift | undefined;
  transport: SlackWriteTransport;
}): Promise<number> {
  const routed = await throughDoor({
    gates: gatesFor({
      voice: {
        allowVoiceRules: hatchOpen({
          env: deps.doorEnv(),
          home: options.home,
          id: "voice-rules",
          nowIso: deps.nowIso(),
        }),
        prose: [{ path: "correction", text: options.correction }],
        rules,
      },
    }),
    // The ledger row goes to THIS invocation's home: `throughDoor` resolves the ambient one when `home` is absent,
    // and `meta.home` does not reach the ledger write.
    home: options.home,
    ledger: deps.doorLedger,
    perform: async () => transport.correctMessage({ corrected, fileIds, posted }),
    request: correctDoorRequest({ action, options, shift, struckIn: corrected.struckIn }),
  });
  if (!routed.performed) {
    return reportNotPerformed({ through: routed });
  }
  return reportLanded({ corrected, deps, options, posted, transport });
}

/** The stored shape `correctClaim` rewrites, off the ownership read. */
function storedOf({ existing }: { existing: ReadSlackMessage }): {
  text?: string | undefined;
  blocks?: readonly unknown[] | undefined;
  attachments?: readonly unknown[] | undefined;
  metadata?: unknown;
} {
  const { stored = {} } = existing;
  return { ...stored, blocks: existing.blocks };
}

/**
 * The door request for one correction: an external write that rides the original send's approval, so it declares no
 * approval of its own, and records what it struck and where the owner's order-of-magnitude answer was.
 *
 * @param action the verb the write is journalled under
 * @param struckIn which form of the message carried the claim
 * @param shift the figures, when the correction moved one by an order of magnitude
 * @returns the door request
 */
function correctDoorRequest({
  action,
  options,
  shift,
  struckIn,
}: {
  action: CorrectRunContext["action"];
  options: CorrectOptions;
  shift: MagnitudeShift | undefined;
  struckIn: CorrectedMessage["struckIn"];
}): DoorRequest {
  return {
    action,
    artifact: {
      actor: options.actor,
      struckIn,
      targetTs: options.ts,
      urgent: options.urgent,
      ...(shift === undefined ? {} : { magnitude: shift }),
      ...(options.magnitudeSeen === undefined ? {} : { magnitudeSeen: options.magnitudeSeen }),
      ...(options.notifyDraft === undefined ? {} : { notifyDraft: options.notifyDraft }),
    },
    meta: { createsWorkItem: false, effect: "external-write", home: options.home, requiresApproval: false },
  } satisfies DoorRequest;
}

/**
 * Read the message back and say what landed. A `chat.update` Slack accepted is not yet a strike a reader sees, so the
 * proof is the read-back itself: the claim struck AND this exact Correction line under it, not a strike alone, which
 * another edit racing ours could have left with a different line or none.
 *
 * @returns the process exit code
 */
async function reportLanded({
  corrected,
  deps,
  options,
  posted,
  transport,
}: {
  corrected: CorrectedMessage;
  deps: CorrectDeps;
  options: CorrectOptions;
  posted: PostedMessage;
  transport: SlackWriteTransport;
}): Promise<number> {
  const after = await transport.readMessage({ posted });
  const landed =
    after !== undefined &&
    claimCorrectedAs({ correction: options.correction, stored: storedOf({ existing: after }), wrong: options.wrong });
  if (!landed) {
    deps.out(
      `slack correct: Slack accepted the update to ${options.channel}/${options.ts}, but the read-back does not show ` +
        "the claim struck with this Correction line under it. Read the message before anything else is sent.",
    );
    return EXIT_ERROR;
  }
  const seen = options.magnitudeSeen === undefined ? "" : ` — order of magnitude seen at ${options.magnitudeSeen}`;
  const parked =
    options.notifyDraft === undefined ? "" : ` — DM ${options.notifyDraft} is parked on the Queue for the owner's yes`;
  const asMe = options.actor === "me" ? " (as me)" : "";
  const notice = `${asMe}${seen}${parked}`;
  deps.out(
    options.json
      ? JSON.stringify({
          channel: options.channel,
          magnitudeSeen: options.magnitudeSeen,
          notifyDraft: options.notifyDraft,
          struckIn: corrected.struckIn,
          ts: options.ts,
        })
      : `corrected — channel=${options.channel} ts=${options.ts} struck in ${corrected.struckIn}, read back${notice}`,
  );
  return EXIT_OK;
}

/** Where `slack correct`'s own flags start in `process.argv`: `[node, script, noun, verb, ...flags]`. */
const VERB_ARG_OFFSET = 4;

/** `slopweaver slack correct` — strike a claim the bot made and put a bold Correction line under it, in place. */
export const slackCorrectCommand = defineCommand({
  run: async (argv) => {
    const parsed = parseCorrectArgs({ defaultHome: slopweaverHome(), rest: argv.slice(VERB_ARG_OFFSET) });
    if (parsed.isErr()) {
      return usage({ errors: slackArgumentErrorLines({ error: parsed.error }) });
    }
    return runCorrect({
      deps: { ...productionLifecycleDeps(), readDraftLog: ({ home }) => readSlackDraftLines({ home }) },
      options: parsed.value,
    });
  },
});
