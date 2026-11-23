/**
 * `slack delete` — split out of `./lifecycleRun.ts` purely to keep that file under this repo's line cap. The
 * two-lane dispatch (`runDelete`) stays here, chosen once and never crossed: the human lane
 * (`./lifecycleRunAsMe.ts`) never calls the bot one — the user token's own `chat.delete` authorisation is
 * the boundary for that lane.
 *
 * The bot lane's ownership read, door routing and delete now live in
 * `../../../outbound/slack/deleteOwnedMessage.ts`, because a correction turn deleting the answer it
 * supersedes needs exactly the same three guarantees and `live/` cannot import a CLI shell. This file keeps
 * what is genuinely its own: which metadata kinds the VERB accepts, and the exit code each outcome earns.
 *
 * Two things about the bot lane did change with that move, and both are deliberate:
 *
 * - the delete is now AT MOST ONCE (`deleteMessageOnce`). A `chat.delete` retried after another session has
 *   edited the target removes a message nobody judged — see that transport method's own header — and the
 *   cost is that a transient 429 now fails the verb rather than quietly recovering;
 * - a refusal is a typed `OwnedDeleteError` rather than two booleans, so `EXIT_ERROR` now carries the
 *   domain's own message about WHICH guard said no, where it used to carry one sentence for every cause.
 */
import type { PostedMessage } from "../../../corpus/slack/writeTransport.js";
import { logger } from "../../../lib/logger.js";
import { deleteOwnedMessage } from "../../../outbound/slack/deleteOwnedMessage.js";
import type { OwnedDeleteError } from "../../../outbound/slack/ownedDeleteErrors.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import type { DeleteOptions } from "./lifecycleCore.js";
import { journalDeletedDraft } from "./lifecycleDraftDeletion.js";
import { deletableEventTypes } from "./lifecycleEventTypes.js";
import { runDeleteAsMe } from "./lifecycleRunAsMe.js";
import { reportRefusal, usage } from "./lifecycleRunShared.js";
import type { LifecycleDeps } from "./lifecycleRunTypes.js";

/**
 * `slack delete` — the two lanes' separate code path, chosen once and never crossed.
 *
 * The bot lane reads the message back, refuses one this bot did not post, and deletes at most once through
 * the door, as this file's header describes. The human lane
 * (`./lifecycleRunAsMe.ts`) never calls it: the user token's own `chat.delete` authorisation is the boundary
 * for that lane.
 *
 * @param options the parsed `delete` invocation
 * @param deps the injected world
 * @returns the process exit code
 */
export async function runDelete({ options, deps }: { options: DeleteOptions; deps: LifecycleDeps }): Promise<number> {
  return options.actor === "me" ? runDeleteAsMe({ deps, options }) : runDeleteAsBot({ deps, options });
}

/**
 * `slack delete --as bot` (or no `--as`) — remove a message slopweaver posted: ownership read, door, and an
 * at-most-once delete, each refusal a typed error mapped to its exit code below. A bare line this bot posted
 * with no metadata counts as its own here, and only here (`acceptUnmarked`).
 */
async function runDeleteAsBot({ options, deps }: { options: DeleteOptions; deps: LifecycleDeps }): Promise<number> {
  const token = deps.botToken({ home: options.home });
  if (token === undefined) {
    return usage({ errors: ["slack delete needs a Slack bot token"] });
  }
  const posted: PostedMessage = { channel: options.channel, ts: options.ts };
  const transport = deps.makeTransport({ home: options.home, token });
  // Every kind this bot posts — card, answer, checklist, poll, a stranded progress message, a notice: the one table
  // `slack edit` sorts its target by, so the two verbs can never again disagree about what is ours.
  const expectedEventTypes = deletableEventTypes({ deps, home: options.home });
  const deleted = await deleteOwnedMessage({
    // A bare line this bot posted is still its own: without this, one carrying no metadata was unretractable.
    acceptUnmarked: true,
    actor: "bot",
    dryRun: options.dryRun,
    expectedEventTypes,
    home: options.home,
    ledger: deps.doorLedger,
    posted,
    transport,
  });
  const journal = { channel: options.channel, deps, home: options.home, ts: options.ts };
  if (deleted.isErr()) {
    // Already gone before the read-back: no delete happened here, but the message is gone all the same, so the
    // register still learns it — which is how a deletion made before this journal existed is healed.
    if (deleted.error.code === "TARGET_ABSENT" && !options.dryRun) {
      journalDeletedDraft(journal);
    }
    return reportDeleteRefusal({ error: deleted.error });
  }
  if (deleted.value.kind === "dry-run") {
    deps.out(`dry run — nothing was changed. would chat.delete ${options.channel}/${options.ts}`);
    return EXIT_OK;
  }
  journalDeletedDraft(journal);
  deps.out(`deleted — channel=${options.channel} ts=${options.ts}`);
  return EXIT_OK;
}

/**
 * Turn a typed delete refusal into this verb's own exit code and message.
 *
 * The split the exit codes have always drawn is between a gate saying no and everything else, and it now
 * survives as a branch on the `code` rather than on which of two booleans came back empty: a door refusal
 * is the mechanism working and exits `EXIT_EXPECTED_EMPTY` through the one renderer that prints its
 * override token, and every other arm is a failure to act and exits `EXIT_ERROR` carrying the domain's own
 * message rather than a sentence this file re-derives from the parts.
 */
function reportDeleteRefusal({ error }: { error: OwnedDeleteError }): number {
  if (error.code === "DOOR_REFUSED") {
    reportRefusal({ decision: error.decision });
    return EXIT_EXPECTED_EMPTY;
  }
  logger.error({ msg: error.message });
  return EXIT_ERROR;
}
