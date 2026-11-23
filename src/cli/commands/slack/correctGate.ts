/**
 * Every refusal `slack correct` owes before it reads a token's worth of Slack — steps 1, 2 and 4 of
 * `./correctRun.ts`'s ordered list, plus the bot token. Split out under the file-size cap along the line between what
 * is refused BEFORE any read (here) and the read, the edit and the read-back (there). `./correctRun.ts` imports from
 * here; this module imports nothing from it.
 */
import type { MagnitudeShift } from "../../../outbound/slack/claimMagnitude.js";
import type { ExactVoiceRule } from "../../../outbound/voice/exactRules.js";
import type { CorrectOptions } from "./correctArgs.js";
import { usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";
import { heldRowOf } from "./releaseHeldRow.js";
import { unreadableProfileExit } from "./voiceAdmission.js";
import { voiceBriefingExit } from "./voiceBriefingGate.js";
import { resolveSlackWriteToken } from "./writeToken.js";

/** What `slack correct` needs beyond the lifecycle world: the draft register, to check an urgent DM is parked. */
export interface CorrectDeps extends LifecycleDeps {
  readonly readDraftLog: (args: { home: string }) => readonly string[];
}

/** A direct message's conversation: a `D…` channel, or the member id a DM row is recorded against. */
const DIRECT_MESSAGE = /^[DUW][A-Z0-9]+$/;

/** What the magnitude line caught, in words. */
function heldBecause({ shift }: { shift: MagnitudeShift }): string {
  if (shift.kind === "shift") {
    return `the correction moves ${String(shift.from)} to ${String(shift.to)}, an order of magnitude`;
  }
  return (
    `the claim states ${String(shift.claimFigures.length)} figure(s) and the correction ` +
    `${String(shift.correctionFigures.length)}, so which one moved, and by how much, cannot be computed`
  );
}

/**
 * Refuse an order-of-magnitude correction the owner has not seen, naming the route to them.
 *
 * Not an escape hatch, and that is deliberate: nothing here is overridden. The owner may want to know
 * first, so the remedy is asking them, and `--magnitude-seen` names WHERE they answered, printed on the outcome line.
 *
 * @param shift the two figures an order of magnitude apart, or the two figure lists that cannot be paired
 * @returns the refusal's lines
 */
function magnitudeRefusal({ shift, options }: { shift: MagnitudeShift; options: CorrectOptions }): readonly string[] {
  return [
    `slack correct held: ${heldBecause({ shift })}, ` +
      "which can change the impact and severity of what readers acted on (owner turn EV8Ywr56: 'If it was an order " +
      "of magnitude difference … I might want to know before you send'). Nothing was changed.",
    `Put it on the Queue first: slopweaver handover ask <your-slug> --problem "the claim at ${options.channel}/` +
      `${options.ts} was off by an order of magnitude" --options "<lines>" --lean "<line>" --risk "<line>" ` +
      '--blast-radius "<line>" --still-real "<line>"',
    "Once the owner answers, re-run with --magnitude-seen <the anchor of their answer>. A same-order correction needs neither.",
    ...(shift.kind === "unpaired"
      ? [
          "Or, when every figure is the same order, restate --wrong and --correction with the same figures in the same " +
            "order, so each is compared with its own.",
        ]
      : []),
  ];
}

/**
 * Check the DM an urgent correction promises is parked, held, and really a direct message — never sent here.
 *
 * @param draftId the row `--notify-draft` named
 * @returns the refusal's lines, or none when the row is fit
 */
function notifyDraftRefusals({
  deps,
  draftId,
  home,
}: {
  deps: CorrectDeps;
  draftId: string;
  home: string;
}): readonly string[] {
  const held = heldRowOf({ deps, draftId, home });
  if (held.isErr()) {
    return [`--notify-draft ${draftId}: ${held.error.message.replace(/\.$/u, "")}. Nothing was changed.`];
  }
  const { draft } = held.value.row;
  if (!DIRECT_MESSAGE.test(draft.channel) || draft.shape !== "top-level") {
    return [
      `--notify-draft ${draftId} is parked for ${draft.channel} (${draft.shape}), not a direct message: an urgent ` +
        "correction's notice goes to the people the claim reached, one DM each. Nothing was changed.",
    ];
  }
  return [];
}

/**
 * Every refusal `slack correct` owes before it reads a token's worth of Slack, in order: the owner's magnitude line, the
 * parked DM an urgent correction promises, the bot token, and the voice rules the door will apply.
 *
 * @param shift the figures, when the correction moved one by an order of magnitude
 * @returns the exit code of the first refusal, or the token and rules the write needs
 */
export function correctPreWriteGate({
  deps,
  options,
  shift,
}: {
  deps: CorrectDeps;
  options: CorrectOptions;
  shift: MagnitudeShift | undefined;
}): { kind: "refused"; exit: number } | { kind: "ready"; token: string; rules: readonly ExactVoiceRule[] } {
  if (shift !== undefined && options.magnitudeSeen === undefined) {
    return { exit: usage({ errors: magnitudeRefusal({ options, shift }) }), kind: "refused" };
  }
  // The correction line is new words in the owner's name, so a session never shown their voice brief is refused.
  const applies = options.actor === "me";
  const unbriefed = voiceBriefingExit({ applies, env: deps.doorEnv(), home: options.home, now: deps.nowIso });
  if (unbriefed !== undefined) {
    return { exit: unbriefed, kind: "refused" };
  }
  const refusals =
    options.notifyDraft === undefined
      ? []
      : notifyDraftRefusals({ deps, draftId: options.notifyDraft, home: options.home });
  if (refusals.length > 0) {
    return { exit: usage({ errors: refusals }), kind: "refused" };
  }
  // `--as me` edits with the OWNER's token, the identity that posted the message, exactly as `slack edit --as me` does — and
  // a bot token stored in the user slot is refused by its prefix, since `auth.test` on it would name the bot's user.
  let token: string | undefined;
  if (options.actor === "me") {
    const resolved = resolveSlackWriteToken({
      actor: "me",
      botToken: undefined,
      userToken: deps.userToken({ home: options.home }),
    });
    if (resolved.isErr()) {
      return { exit: usage({ errors: [resolved.error.message] }), kind: "refused" };
    }
    token = resolved.value;
  } else {
    token = deps.botToken({ home: options.home });
  }
  if (token === undefined) {
    const errors = ["slack correct needs a Slack bot token: run `slopweaver secrets set slack-bot-token`"];
    return { exit: usage({ errors }), kind: "refused" };
  }
  const rules = deps.voiceRules({ home: options.home });
  if (rules.isErr()) {
    return {
      exit: unreadableProfileExit({ error: rules.error, nothingHappened: "nothing was changed." }),
      kind: "refused",
    };
  }
  return { kind: "ready", rules: rules.value, token };
}
