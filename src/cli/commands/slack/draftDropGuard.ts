/**
 * What `slack draft drop` refuses before it appends: a drop that would end the owner's yes on a row, their unjudged
 * words on its card, or a change of meaning they have not answered, in neither a send nor a reason in front of them.
 *
 * A yes the owner gave is never quietly not sent: a `moot:` drop of an approved row, or of a row the owner's words
 * landed on that no session had judged, would pass every other gate, because a dropped row is no gate's obligation
 * and its note reaches only the register. So the drop is refused unless its note leads to a cut that stands or one
 * already sent (`dropLeadsTo`), and the refusal routes it through a judgement the owner's Queue card prints instead.
 * A row whose meaning changed waits on the owner's word: dropped before it, the reason never reaches them.
 */
import { dropLeadsTo, dropShedsApproval } from "../../../outbound/slack/draftApproval.js";
import type { DraftHold, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { judgedSince } from "../../../supervisor/approvedDraftGate.js";
import type { DraftLandingBindings, VanishedDraftLanding } from "../../../supervisor/draftLandingBinding.js";

/**
 * What the shell read of the card landings: the bindings, every landing whose card's record is gone, and how many
 * ledger rows the read judged — which a drop records, so a landing written after it is known to have outrun it.
 */
export type LandedDraftsRead =
  | {
      readonly kind: "read";
      readonly bindings: DraftLandingBindings;
      readonly vanished: readonly VanishedDraftLanding[];
      readonly ledgerRows: number;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Why this drop is refused, or nothing when it may go ahead. The owner's yes on the row is checked first. When the drop
 * would end the words rather than hand them to a re-cut, where the landing binds next, then: landings that could not be
 * read, a change of meaning the owner has not answered, and any landing of their words bound to it that no judgement
 * has answered.
 *
 * @param items every folded register row
 * @param landed the card landings as the shell read them
 * @param note the drop note
 * @param row the held row about to be dropped
 * @returns the refusal line, or `undefined`
 */
export function dropRefusal({
  items,
  landed,
  note,
  row,
}: {
  items: readonly SlackDraftItem[];
  landed: LandedDraftsRead;
  note: string;
  row: SlackDraftItem;
}): string | undefined {
  const sheds = dropShedsApproval({ items, note, row });
  if (sheds?.code === "DRAFT_DROP_SHEDS_APPROVAL") {
    return (
      `${sheds.message}, or re-record it with --supersedes ${row.id} (adding --meaning-changed "<what changed>" ` +
      "when the words no longer carry the owner's yes). Nothing was dropped."
    );
  }
  if (sheds?.code === "DRAFT_DROP_SHEDS_CHANGE") {
    return (
      `${sheds.message}, or re-record it with --supersedes ${row.id} --meaning-changed "<what changed>". Nothing was ` +
      "dropped."
    );
  }
  if (sheds !== undefined) {
    return `${sheds.message}. Nothing was dropped.`;
  }
  const leads = dropLeadsTo({ items, note, row });
  if (leads.kind === "sent") {
    return undefined;
  }
  if (leads.kind === "held") {
    const swallowed = swallowedLanding({ cut: leads.cut, landed, row });
    if (swallowed !== undefined) {
      return swallowed;
    }
    return showsReason({ cut: leads.cut }) ? undefined : unseenSetDown({ items, landed, onto: "drop", row });
  }
  const checks = [
    () => unseenSetDown({ items, landed, onto: "drop", row }),
    () => unknownRefusal({ landed, onto: "drop", row }),
    () => unansweredChange({ landed, row }),
    () => unjudgedLanding({ landed, row }),
  ];
  for (const check of checks) {
    const refusal = check();
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return undefined;
}

/**
 * Why a bare re-cut of this row is refused, or nothing when it may park: one carrying neither a fresh yes nor a change
 * of meaning would stand on the owner's Queue with no reason, while the reason a hold set a yes down for, which the
 * owner has not seen, drops with the row it re-cuts. Its drop of the row fails closed on unknown landings as a terminal
 * drop does: a swept card's landing binds to no cut, so a yes on it would leave with the row.
 *
 * @param items every folded register row
 * @param landed the card landings as the shell read them
 * @param row a held row the re-cut supersedes
 * @returns the refusal line, or `undefined`
 */
export function recutRefusal({
  items,
  landed,
  row,
}: {
  items: readonly SlackDraftItem[];
  landed: LandedDraftsRead;
  row: SlackDraftItem;
}): string | undefined {
  const unseen = unseenSetDown({ items, landed, onto: "re-cut", row });
  if (unseen !== undefined) {
    return unseen;
  }
  return unknownRefusal({ landed, onto: "re-cut", row });
}

/** Whether a held cut puts a reason, or the owner's yes, in front of them on its own Queue card. */
function showsReason({ cut }: { cut: SlackDraftItem }): boolean {
  return cut.draft.approval !== undefined || cut.draft.meaningChanged !== undefined || cut.hold?.setDown !== undefined;
}

/**
 * The refusal when a hold set down a yes the owner recorded, or a change of meaning waiting on their word, on this
 * row or a cut it was re-cut from, and no word of theirs has landed on either card since — whatever hold stands now,
 * since a later one carries the record. That hold is the session's reading, and its reason reaches the owner only on
 * the held row's Queue card, so a drop or bare re-cut straight after it would end what was set down with the reason
 * never in front of them. Unreadable landings fail it closed.
 *
 * @returns the refusal line, or `undefined`
 */
function unseenSetDown({
  items,
  landed,
  onto,
  row,
}: {
  items: readonly SlackDraftItem[];
  landed: LandedDraftsRead;
  /** The act being refused, which names what to do instead. */
  onto: "drop" | "re-cut";
  row: SlackDraftItem;
}): string | undefined {
  const lineage = lineageOf({ items, row });
  for (const cut of lineage) {
    const setDown = cut.hold?.setDown;
    if (setDown === undefined || spokenSince({ ids: lineage.map((one) => one.id), landed, setDown })) {
      continue;
    }
    const after =
      onto === "drop"
        ? "judge it and drop. Nothing was dropped."
        : 're-cut it, or re-cut now naming a fresh --approved or --meaning-changed "<what changed>". Nothing was parked.';
    return (
      `${cut.id} carried ${setDownWhat({ setDown })}, which a not-owner-yes hold set down at ${setDown.atIso} ` +
      `("${setDown.why}"), and no word of the owner's has landed on its card since. A ${onto} now would leave it ` +
      `unsent with that reason never in front of them. Leave ${row.id} held: its Queue card leads with the reason, and ` +
      `once their answer lands, ${after}`
    );
  }
  return undefined;
}

/** What a hold set down, in words: the owner's yes and where they said it, and any change of meaning waiting on their word. */
function setDownWhat({ setDown }: { setDown: NonNullable<DraftHold["setDown"]> }): string {
  const parts: string[] = [];
  if (setDown.approval !== undefined) {
    parts.push(`the owner's yes at ${setDown.approval.anchor} ("${setDown.approval.heard.trim()}")`);
  }
  if (setDown.change !== undefined) {
    parts.push(`a change of meaning waiting on the owner's word (${setDown.change})`);
  }
  return parts.join(" and ");
}

/** The row and every cut the register records it was re-cut from (`recuts`), nearest first. */
function lineageOf({
  items,
  row,
}: {
  items: readonly SlackDraftItem[];
  row: SlackDraftItem;
}): readonly SlackDraftItem[] {
  const seen: SlackDraftItem[] = [row];
  for (let index = 0; index < seen.length; index += 1) {
    const recuts = seen[index]!.draft.recuts;
    if (recuts === undefined) {
      continue;
    }
    for (const id of recuts) {
      const parent = items.find((item) => item.id === id);
      if (parent !== undefined && !seen.includes(parent)) {
        seen.push(parent);
      }
    }
  }
  return seen;
}

/**
 * Whether a word of the owner's landed on any of these rows' cards since the hold set it down; unknown reads as no.
 * Ordered by the landing ledger when the hold counted it: a landing written into the rows the hold read is one it
 * already weighed, however late it was spoken, so it never reads as the owner's answer. Else by instants.
 */
function spokenSince({
  ids,
  landed,
  setDown,
}: {
  ids: readonly string[];
  landed: LandedDraftsRead;
  setDown: NonNullable<DraftHold["setDown"]>;
}): boolean {
  const since = Date.parse(setDown.atIso);
  if (landed.kind === "unreadable" || Number.isNaN(since)) {
    return false;
  }
  const { landingsRead } = setDown;
  return landed.bindings.bound.some((bound) => {
    if (!ids.includes(bound.namedId)) {
      return false;
    }
    if (landingsRead !== undefined && bound.ledgerRow !== undefined) {
      return bound.ledgerRow >= landingsRead;
    }
    return Date.parse(bound.landing.decidedIso) >= since;
  });
}

/**
 * The refusal when what landed on the row's cards cannot be known and no judgement of a hold has weighed it. Such
 * a hold covers only the landing ledger rows it counted: a landing written after them is one it never saw, so an old
 * hold is no waiver for a later yes, and a ledger that will not read at all is never covered.
 *
 * @param landed the card landings as the shell read them
 * @param onto the act being refused, which names what else would carry the words
 * @param row the held row about to be dropped, alone or by a bare re-cut
 * @returns the refusal line, or `undefined`
 */
function unknownRefusal({
  landed,
  onto,
  row,
}: {
  landed: LandedDraftsRead;
  onto: "drop" | "re-cut";
  row: SlackDraftItem;
}): string | undefined {
  const weighed = row.hold?.reason === "not-owner-yes" ? row.judgedLandings : undefined;
  const unread = unreadLandings({ landed, row, weighed });
  if (unread === undefined) {
    return undefined;
  }
  const route =
    landed.kind === "unreadable"
      ? "Repair that read (the tick refuses on an unreadable one too)"
      : "Repair that read (the tick refuses on an unreadable one too), or once you have seen those words record that " +
        `no yes of the owner's stands on it: \`slopweaver slack draft hold ${row.id} --reason not-owner-yes --why "<what you saw>"\``;
  if (onto === "re-cut") {
    return (
      `${unread}, so whether the owner's words landed on ${row.id} is unknown, and a re-cut carrying neither their yes ` +
      `nor a change of meaning would drop it with them unjudged. ${route}, or re-cut naming a fresh --approved or ` +
      '--meaning-changed "<what changed>". Nothing was parked.'
    );
  }
  return (
    `${unread}, so whether the owner's words landed on ${row.id} is unknown, and the drop note names neither a cut ` +
    `that stands nor where it was sent. ${route}. Nothing was dropped.`
  );
}

/**
 * What of the card landings could not be read and no hold has weighed, when anything: the whole read, a landing whose
 * card will not read, or one whose card's record is gone that the owner's words reached after this row was parked — a
 * swept ask may have named it. Any may be the owner's words on this row, so a drop that would end them fails closed.
 *
 * @param landed the card landings as the shell read them
 * @param row the held row about to be dropped, whose park instant dates which vanished landings could name it
 * @param weighed how many ledger rows a standing hold counted; a landing at an earlier row it weighed
 * @returns the reason, or `undefined` when every landing that could name the row was read or weighed
 */
function unreadLandings({
  landed,
  row,
  weighed,
}: {
  landed: LandedDraftsRead;
  row: SlackDraftItem;
  weighed: number | undefined;
}): string | undefined {
  if (landed.kind === "unreadable") {
    return `the card landings could not be read (${landed.why})`;
  }
  const unweighed = ({ ledgerRow }: { ledgerRow: number }): boolean => weighed === undefined || ledgerRow >= weighed;
  const first = landed.bindings.unreadable.find(unweighed);
  if (first !== undefined) {
    return `the owner's words on ${first.landing.cardKey} at ${first.landing.anchor} could not be bound (${first.why})`;
  }
  const parked = Date.parse(row.draft.tsIso);
  const gone = landed.vanished.find((one) => unweighed(one) && !(Date.parse(one.landing.decidedIso) < parked));
  if (gone === undefined) {
    return undefined;
  }
  return `the owner's words on ${gone.landing.cardKey} at ${gone.landing.anchor} landed on a card whose record is gone`;
}

/**
 * The refusal when the row's meaning changed and the owner's words have not reached its card since: the change waits on
 * their word, and a drop before it ends the row with the reason never in front of them.
 *
 * @param landed the card landings as the shell read them
 * @param row the held row about to be dropped
 * @returns the refusal line, or `undefined`
 */
function unansweredChange({ landed, row }: { landed: LandedDraftsRead; row: SlackDraftItem }): string | undefined {
  const change = row.draft.meaningChanged;
  if (change === undefined || landed.kind === "unreadable") {
    return undefined;
  }
  const changedIso = row.hold?.reason === "meaning-changed" ? row.hold.atIso : row.draft.tsIso;
  const changed = Date.parse(changedIso);
  const { changedLandings } = row;
  // Ledger order where the change counted it: a landing written before the change is never the owner's answer to it.
  const answered = landed.bindings.bound.some((bound) => {
    if (bound.item.id !== row.id) {
      return false;
    }
    if (changedLandings !== undefined && bound.ledgerRow !== undefined) {
      return bound.ledgerRow >= changedLandings;
    }
    return Date.parse(bound.landing.decidedIso) >= changed;
  });
  if (answered) {
    return undefined;
  }
  return (
    `${row.id}'s meaning changed (${change}) and waits on the owner's word: no words of the owner's have landed on ` +
    `its card since ${changedIso}, so a drop now would end it with the reason never in front of them. Leave it held — ` +
    `the owner's Queue card leads with the change — and judge their answer when it lands ` +
    `(\`slopweaver slack draft show ${row.id}\`). Nothing was dropped.`
  );
}

/**
 * The refusal when the drop hands the owner's unjudged words to a held cut whose own earlier judgement would read as
 * answering them: a judgement counts the landing ledger, not which draft each landing was bound to, so a hold on the
 * cut before this drop moved the owner's words onto it would close them unread. A fresh re-cut stands on the judgement
 * of the row it came from, which never answered them, so the words stay owed on it and it passes.
 *
 * @param cut the held cut the drop note leads to
 * @param landed the card landings as the shell read them
 * @param row the held row about to be dropped
 * @returns the refusal line, or `undefined`
 */
function swallowedLanding({
  cut,
  landed,
  row,
}: {
  cut: SlackDraftItem;
  landed: LandedDraftsRead;
  row: SlackDraftItem;
}): string | undefined {
  if (landed.kind === "unreadable") {
    return undefined;
  }
  const owed = landed.bindings.bound.find(
    (bound) => bound.item.id === row.id && !judgedSince({ bound }) && judgedSince({ bound: { ...bound, item: cut } }),
  );
  if (owed === undefined) {
    return undefined;
  }
  const { landing } = owed;
  return (
    `${row.id} carries the owner's words from ${landing.cardKey} at ${landing.anchor} ("${landing.words.trim()}"), ` +
    `which no judgement has answered, and ${cut.id}, where the drop note hands them, was judged before they reached ` +
    `it, so that judgement would read as answering words it never saw. Judge them on ${row.id} first: ` +
    `\`slopweaver slack draft approve ${row.id} --anchor ${landing.anchor}\` when they are the owner's yes, or ` +
    `\`slopweaver slack draft hold ${row.id} --reason not-owner-yes --why "<what they meant>"\`, which the owner's ` +
    "Queue card prints. Nothing was dropped."
  );
}

/**
 * The refusal when the owner's words landed on the row's card and no judgement has answered them.
 *
 * @param landed the card landings as the shell read them
 * @param row the held row about to be dropped
 * @returns the refusal line, or `undefined`
 */
function unjudgedLanding({ landed, row }: { landed: LandedDraftsRead; row: SlackDraftItem }): string | undefined {
  if (landed.kind === "unreadable") {
    return undefined;
  }
  const owed = landed.bindings.bound.find((bound) => bound.item.id === row.id && !judgedSince({ bound }));
  if (owed === undefined) {
    return undefined;
  }
  const { landing } = owed;
  return (
    `${row.id} carries the owner's words from ${landing.cardKey} at ${landing.anchor} ("${landing.words.trim()}"), ` +
    "which no judgement has answered, and the drop note names neither a cut that stands nor where it was sent. Judge " +
    `them first: \`slopweaver slack draft approve ${row.id} --anchor ${landing.anchor}\` when they are the owner's yes, ` +
    `or \`slopweaver slack draft hold ${row.id} --reason not-owner-yes --why "<what they meant>"\`, which the owner's ` +
    "Queue card prints. Nothing was dropped."
  );
}
