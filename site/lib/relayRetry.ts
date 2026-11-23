/**
 * The console voice's one retry: a relay the verb refused goes again with the owner's words alone.
 *
 * A relay refused on `--read-after context_pack` never reaches the board, and a voice that tells the owner to type
 * the steer to the supervisor themselves defeats the relay's purpose. So a
 * refusal is not the end of the owner's steer. The page sends it once more carrying only their transcribed words, the
 * item they had open and the picture — no reading of the voice's and no reads — and the row says the reading
 * was not carried and why (`src/talk/relayDraft.ts`).
 *
 * ## Only a refusal that wrote nothing, and only once
 *
 * The route's own refusal of the voice's reading or its reads (`site/lib/talkRelayRequestFields.ts`) spawns nothing
 * and is retried the same way: those are exactly the fields the retry drops.
 *
 * `talk relay` exits 2 (`EXIT_USAGE`) only before it claims the turn: the args and the draft are checked
 * before `claimTurn` writes a turn file. Any other exit may have claimed the turn, and a retry with different
 * words would only come back as `RELAY_CONFLICT`, so it is never retried. A words-alone relay that is itself
 * refused is not retried again: there is nothing left to drop.
 *
 * A turn id belongs to ONE accepted relay: the page mints it as it hands the model its answer, before the post
 * runs, and the next `relay_steer` gets a fresh one (`components/voice/relayAttempt.ts`). So the turn's only
 * posts are this one and its retry, and a pre-claim refusal of the first is all the retry needs to know.
 *
 * The posts run one at a time ({@link serialQueue}), in the background of the call, so the owner's steers reach the
 * board and the supervisor's chat in the order they were given.
 */
import type { TalkRelayWire } from "./talkRelayRequestWire";

/** `talk relay`'s exit when it refused before writing anything — `EXIT_USAGE` in `src/cli/exitCodes.ts`. */
export const VERB_USAGE_EXIT = 2;

/**
 * `talk relay`'s exit when an earlier run of the same turn is still alive — `EXIT_DEFERRED` in
 * `src/cli/exitCodes.ts`. This run wrote nothing, but the earlier one may yet, so the relay stays unknown.
 */
const VERB_DEFERRED_EXIT = 4;

/**
 * Whether a failed relay's outcome is unknown rather than refused: the verb gave no exit (killed at the route's
 * timeout, by design after any write), or another run of the same turn still holds it and may yet write — a ruling
 * on a candidate included, so the voice never says "did not land" of one that did.
 *
 * @param exitCode the verb's exit, or `undefined` when it never gave one
 * @returns true when the relay may still land
 */
export function relayOutcomeUnknown({ exitCode }: { exitCode: number | undefined }): boolean {
  return exitCode === undefined || exitCode === VERB_DEFERRED_EXIT;
}

/**
 * Whether a refused relay may be retried with the owner's words alone.
 *
 * @param exitCode the verb's exit, or `undefined` when it never gave one
 * @param wordsAlone whether the refused relay was already the retry
 * @returns true only for a first relay the verb refused before claiming its turn
 */
export function relayRetryable({
  exitCode,
  wordsAlone,
}: {
  exitCode: number | undefined;
  wordsAlone: boolean;
}): boolean {
  return exitCode === VERB_USAGE_EXIT && !wordsAlone;
}

/**
 * Whether a post certainly left its turn unclaimed: a refusal the route or the verb made before the turn file
 * was written, which is exactly the refusal that offers the words-alone retry. An `unknown` outcome, a relay,
 * and any other refusal may have claimed it.
 *
 * @param post what the post came to
 * @returns true only when the turn is still free for a retry with different content
 */
export function postLeftTurnUnclaimed({
  post,
}: {
  post: { readonly outcome: string; readonly wordsAloneRetry: boolean };
}): boolean {
  return post.outcome === "refused" && post.wordsAloneRetry;
}

/**
 * The retry of a refused relay: the same turn, the owner's words, the item they had open and the picture, and nothing the
 * voice supplied — but for the check-in their words were a verdict on and how far it reaches, or the workstream
 * candidate they rule on and their word, which name WHAT the words answer rather than reading them, and are checked
 * against the register by the verb. A copy-tray offer is dropped: it is text the voice wrote, and a first relay the
 * route or the verb refused over a malformed one must still get the owner's words through.
 *
 * @param wire the relay the verb refused
 * @returns the words-alone relay to post
 */
export function wordsAloneWire({ wire }: { wire: TalkRelayWire }): TalkRelayWire {
  return {
    about: wire.about,
    heard: wire.heard,
    readsAfter: [],
    screen: wire.screen,
    turnId: wire.turnId,
    wordsAlone: true,
    // Whether the words end mid-sentence is a fact of the same words, so the retry carries it: dropping it would turn
    // a cut relay unknown, and a relay that said it was whole into one that never said.
    ...(wire.heardTail === undefined ? {} : { heardTail: wire.heardTail }),
    // Which cards the owner's words answer, like `about` beside it: the verb holds each to the register, and dropping
    // them would leave cards the owner ruled on in the Queue because the voice's reading was refused.
    ...(wire.alsoAnswers === undefined ? {} : { alsoAnswers: wire.alsoAnswers }),
    ...(wire.covers === undefined ? {} : { covers: wire.covers }),
    ...(wire.candidate === undefined ? {} : { candidate: wire.candidate }),
    ...(wire.reaction === undefined ? {} : { reaction: wire.reaction }),
    // The owner's triage verdict is theirs, never the model's reading, so it survives the retry as a check-in's covers does.
    ...(wire.triage === undefined ? {} : { triage: wire.triage }),
    ...(wire.label === undefined ? {} : { label: wire.label }),
    ...(wire.workspace === undefined ? {} : { workspace: wire.workspace }),
    // The discuss-first question was put, or not, on the page's own ledger: dropping it would let the chair start a
    // fix the voice has just asked the owner about.
    ...(wire.discussFirst === undefined ? {} : { discussFirst: wire.discussFirst }),
  };
}

/**
 * A queue that runs one task at a time, so the page never has two relay posts in flight: each starts only after
 * the one before it has settled, whether that one resolved or rejected, so the rows land in the order the owner spoke.
 *
 * @returns `run`, which starts a task once every task queued before it has settled and hands back its result
 */
export function serialQueue(): { readonly run: <T>(task: () => Promise<T>) => Promise<T> } {
  let tail: Promise<void> = Promise.resolve();
  return {
    run: (task) => {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
