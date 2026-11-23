/**
 * A relay about a card lands on that card, and on every other Queue card the voice
 * judged the same words answer (`--also-answers`; Queue cards must refresh, so one ruling
 * clears every card it decides) — unless the owner's words name a draft or channel that card never mentions
 * (`../../../talk/relayChannelSteer.ts`), which stops a relay about a public mis-send landing on an unrelated
 * card. Each card carries its OWN disposition. A relay is about a card only when
 * the voice judged the owner's words answer it (`relay_steer`'s `answers_open_card`), and the landing refuses a
 * hand step and words that are only greeting or filler whoever sent them (`../../../talk/cardAnswer.ts`).
 * `./relayRun.ts` calls it once the row is on the board; the landing itself is `./cardLandApply.ts`, the same one
 * `talk land` writes.
 */
import type { StatedWorkspace } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import { isRegisterCardKey } from "../../../talk/cardKey.js";
import type { RelayCardDisposition } from "../../../talk/relayChannelSteer.js";
import { heldCardKeys } from "../../../talk/relayCutHold.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";
import { landCard } from "./cardLandApply.js";

/**
 * Land a relay on the card it is about and on each card it also answers, in that order, with the relay's row as the
 * work: the owner's own words when the page attached them, the voice's reading when it attached none. Each card's failure is
 * said on stderr on its own line, never skips the cards after it, and never fails the relay — the row already
 * carries every word, and a retry of the turn lands only the cards still showing.
 *
 * @param dir the handover directory the relay's row is on
 * @param draft the relay, whose `about` and `alsoAnswers` name the cards
 * @param decidedIso when the turn was staged, which is when the owner said it
 * @param workspace whose work the relay is, as the page placed it — what a dispatch row registered here states
 * @param disposition whether the owner's words belong on the `about` card at all: words naming a draft or channel the card
 *   never mentions stay off it, and the chair's line says where they went
 * @param also each also-answered card's own disposition, judged the same way against that card
 * @param hold why the relay's words may end before the owner did (`../../../talk/relayCutHold.ts`): every card stays on
 *   the Queue, its triage verdict with it, and each says so on stderr, since a landing is the owner's word on the card
 */
export async function landRelayCards({
  dir,
  disposition,
  also,
  draft,
  home,
  decidedIso,
  workspace,
  hold,
}: {
  dir: string;
  disposition: RelayCardDisposition;
  also: ReadonlyMap<string, RelayCardDisposition>;
  draft: RelayDraft;
  home: string;
  decidedIso: string;
  workspace: StatedWorkspace | undefined;
  hold: string | undefined;
}): Promise<void> {
  if (hold !== undefined) {
    for (const cardKey of heldCardKeys({ about: draft.about, alsoAnswers: draft.alsoAnswers })) {
      logger.error({ msg: `talk relay: the row is on the board; not landed on ${cardKey} — ${hold}` });
    }
    return;
  }
  let words = draft.heard;
  if (words === "") {
    words = draft.words;
  }
  const targets: { cardKey: string; disposition: RelayCardDisposition | undefined }[] = [
    { cardKey: draft.about, disposition },
    ...draft.alsoAnswers.map((cardKey) => ({ cardKey, disposition: also.get(cardKey) })),
  ];
  await landEach({
    land: (target) => landOne({ ...target, decidedIso, dir, draft, home, words, workspace }),
    targets,
  });
}

/**
 * Run one landing per target in order, so a THROW inside one (a work row a concurrent writer left unparseable, say)
 * is that card's failure, said on stderr like any refusal, never the relay's and never a reason to
 * skip the cards after it.
 *
 * @param land the landing for one target, injected so a test can make one throw without a mock
 * @returns the card keys whose landing threw, in order
 */
export async function landEach<T extends { cardKey: string }>({
  land,
  targets,
}: {
  land: (target: T) => Promise<void>;
  targets: readonly T[];
}): Promise<readonly string[]> {
  const threw: string[] = [];
  for (const target of targets) {
    try {
      await land(target);
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : String(cause);
      logger.error({ msg: `talk relay: the row is on the board, but ${target.cardKey} still shows — ${why}` });
      threw.push(target.cardKey);
    }
  }
  return threw;
}

/** Land one card, saying on stderr why not when it does not land. */
async function landOne({
  cardKey,
  disposition,
  decidedIso,
  dir,
  draft,
  home,
  words,
  workspace,
}: {
  cardKey: string;
  disposition: RelayCardDisposition | undefined;
  decidedIso: string;
  dir: string;
  draft: RelayDraft;
  home: string;
  words: string;
  workspace: StatedWorkspace | undefined;
}): Promise<void> {
  // An Automations card (`recipe:<id>`) or an Alignment question (`align:<id>`) is on no register, so there is
  // nothing to take off a list: the relay's row and turn are the whole record, and the page reads its answer back
  // off them.
  if (cardKey === "" || !isRegisterCardKey({ key: cardKey })) {
    return;
  }
  // A card nobody judged is never landed on: the shell judges every key it was handed, so this is an invariant, said
  // rather than guessed past.
  if (disposition === undefined) {
    logger.error({ msg: `talk relay: the row is on the board; not landed on ${cardKey} — no disposition was read` });
    return;
  }
  if (disposition.kind === "withheld") {
    logger.error({ msg: `talk relay: the row is on the board; not landed on ${cardKey} — ${disposition.why}` });
    return;
  }
  if (words === "") {
    return;
  }
  const landed = await landCard({
    input: {
      anchor: draft.anchor,
      cardKey,
      decidedIso,
      handoverDir: dir,
      home,
      nowIso: new Date().toISOString(),
      laterAnchors: [],
      relayTurns: [draft.turnId],
      source: "relay",
      words,
      // The relay's `talk:` anchor is read off its own turn file, which says whether its words were cut.
      wordsCut: undefined,
      workspace,
    },
  });
  reportLanding({ cardKey, landed });
}

/**
 * Say on stderr what one landing came to when it is not simply landed: a card that was not the owner's to land, a failure
 * that leaves it showing, or a steer or quote that did not reach it.
 *
 * @param cardKey the card
 * @param landed what `landCard` answered
 */
function reportLanding({ cardKey, landed }: { cardKey: string; landed: Awaited<ReturnType<typeof landCard>> }): void {
  if (landed.isErr() && (landed.error.code === "CARD_NOT_HIS" || landed.error.code === "NOT_AN_ANSWER")) {
    logger.error({ msg: `talk relay: the row is on the board; ${landed.error.message}` });
  } else if (landed.isErr()) {
    logger.error({
      msg: `talk relay: the row is on the board, but ${cardKey} still shows — ${landed.error.message}`,
    });
  } else {
    landed.value.unquoted.forEach((problem) => {
      logger.error({ msg: `talk relay: ${problem}` });
    });
  }
}
