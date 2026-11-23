/**
 * The effectful half of `./relayTakenUp.ts`'s card check: what became of one relay's words, read off the relay's
 * turn file and two run journals. Both callers — the settle the chair's act triggers (`relaySettleAtAct.ts`) and
 * `handover prune` — read through this one function, so the two cannot disagree about a relay.
 *
 * The card of record is the turn's own `about`, and only when it names a register card (`../talk/cardKey.ts`): an
 * Automations or Alignment key is held by no register, so no ruling could ever reach it. A relay registered before
 * the page stopped reading words begun over no card as a second card (`site/lib/heardOver.ts`) can carry
 * `about: ""` though it was spoken over one; that residue is stated rather than reconstructed from the call file.
 *
 * Fails CLOSED: a turn or journal that will not read is `unreadable`, which answers nothing, never a relay over no
 * card. A journal line that will not decode only fails to prove a ruling or a dispatch, which is the same direction;
 * a line that DOES decode is evidence whatever its siblings hold. Refusing a whole journal over one line would strand
 * every relay whose card a newer checkout has written a kind this one cannot read (`.claude/rules/area-handover.md`).
 * A ruling's anchor matches through `parseRelayAnchor`, the same normalisation every other relay match here uses.
 */
import { stateHomePaths } from "../stateHome.js";
import { namesOneRegisterCard } from "../talk/prCardKey.js";
import { parseRelayAnchor } from "../talk/relayDraft.js";
import { readTurn } from "../talk/relayStore.js";
import type { RelayWorkEvidence } from "./relayTakenUp.js";
import { readRunJournal } from "./runStore.js";

/** The card kind whose own journal takes the owner's words as a ruling (`../cli/commands/talk/cardLandApply.ts`). */
const ASK_PREFIX = "ask:";

/**
 * Read what became of one relay's words.
 *
 * @param anchor the relay row's normalised `talk:<turnId>` anchor
 * @param slug the relay row's own slug, whose journal says whether a seat was dispatched
 * @returns the card the turn names and whether the owner's words reached work, or why a register would not read
 */
export function readRelayWorkEvidence({
  home,
  anchor,
  slug,
}: {
  home: string;
  anchor: string;
  slug: string;
}): RelayWorkEvidence {
  const turn = readTurn({ home, turnId: anchor.slice(anchor.indexOf(":") + 1) });
  if (turn.isErr()) {
    return { kind: "unreadable", why: `the relay's turn would not read: ${turn.error.message}` };
  }
  const about = turn.value.about;
  if (!namesOneRegisterCard({ key: about })) {
    return { cardKey: undefined, kind: "read", rulingOnCard: false, seatDispatched: false };
  }
  const runsDir = stateHomePaths({ home }).runs;
  const own = readRunJournal({ runsDir, slug });
  if (own.isErr()) {
    return { kind: "unreadable", why: `${slug}'s journal would not read: ${own.error.message}` };
  }
  const seatDispatched = own.value.events.some((event) => event.kind === "dispatched" || event.kind === "started");
  if (!about.startsWith(ASK_PREFIX)) {
    return { cardKey: about, kind: "read", rulingOnCard: false, seatDispatched };
  }
  const askSlug = about.slice(ASK_PREFIX.length);
  const card = readRunJournal({ runsDir, slug: askSlug });
  if (card.isErr()) {
    return { kind: "unreadable", why: `${askSlug}'s journal would not read: ${card.error.message}` };
  }
  const rulingOnCard = card.value.events.some(
    (event) => event.kind === "ruling" && parseRelayAnchor({ text: event.anchor }) === anchor,
  );
  return { cardKey: about, kind: "read", rulingOnCard, seatDispatched };
}
