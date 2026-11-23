/**
 * The shell around `../../../talk/relayChannelSteer.ts`: read the draft register and the card on screen, plan what a
 * relay's words mean for them, and append the channel steer under the register's own lock.
 *
 * `talk relay` (`./relayRun.ts`) plans BEFORE it registers the row, so the row's summary and the chair's line open on
 * the lead, and appends the steer AFTER the row exists and before the turn is marked registered, so a crash between
 * the two leaves the turn `registering` and the retry appends it then. The append is idempotent on the draft id and
 * the relay's anchor, read off the raw events rather than the fold: the fold keeps only the newest steer, and a retry
 * of an older turn must not re-append its steer over a newer one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  appendSlackDraftEvent,
  holdSlackDraftLock,
  readSlackDraftLinesOrError,
} from "../../../admit/slackDraftStore.js";
import { isSafeSlug } from "../../../handover/runStore.js";
import { readExactDoc } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { foldSlackDrafts } from "../../../outbound/slack/draftFold.js";
import { parseSlackDraftLog, skippedLinesTouching } from "../../../outbound/slack/draftLog.js";
import type { DraftChannelSteer, SlackDraftItem } from "../../../outbound/slack/draftRegister.js";
import { latestChannelSteer } from "../../../outbound/slack/draftSteerGate.js";
import { alsoAnsweredDispositions } from "../../../talk/relayCardDispositions.js";
import {
  type RelayCardDisposition,
  type RelayCardText,
  type RelaySteer,
  type RelaySteerPlan,
  relayCardDisposition,
  relayReferents,
  relaySteerPlan,
} from "../../../talk/relayChannelSteer.js";
import type { RelayDraft } from "../../../talk/relayDraft.js";
import { heldSteerLead } from "../../../talk/relayHeldSteer.js";

/** What a relay's words mean for the register, the card on screen, and every other card they also answer. */
export interface RelayChannelRead {
  readonly disposition: RelayCardDisposition;
  readonly plan: RelaySteerPlan;
  /**
   * Each `--also-answers` card's own disposition, in the order named — judged per card, never the open card's reused
   * The plan stays the open card's alone, so a steer is appended once, not once per card.
   */
  readonly also: ReadonlyMap<string, RelayCardDisposition>;
  /** The newest steer across the planned steer's row lineage as this read found it; `undefined` when none, or no steer. */
  readonly governing: DraftChannelSteer | undefined;
}

/**
 * Plan one relay against the draft register, the card it names and every card it also answers, from ONE read of the
 * register. A register that will not read plans no steer and says so in the lead, so the chair knows the check did not
 * run rather than reading silence as "nothing to steer".
 *
 * @param dir the handover directory an `ask:` card's doc is read from
 * @param draft the relay: its card key, the cards it also answers, the owner's words, its anchor
 * @param home the state home the draft register lives under
 * @param nowIso when a steer would be recorded
 * @returns the card dispositions and the steer plan
 */
export function readRelayChannelPlan({
  dir,
  draft,
  home,
  nowIso,
}: {
  dir: string;
  draft: Pick<RelayDraft, "about" | "anchor" | "heard" | "words"> & Partial<Pick<RelayDraft, "alsoAnswers">>;
  home: string;
  nowIso: string;
}): RelayChannelRead {
  const lines = readSlackDraftLinesOrError({ home });
  let items: readonly SlackDraftItem[] = [];
  let unread: string | undefined;
  if (lines.isErr()) {
    unread = `the draft register would not read, so no channel steer was checked (${lines.error.message})`;
  } else {
    items = foldSlackDrafts({ events: parseSlackDraftLog({ lines: lines.value }).events });
  }
  // The owner's transcript when there is one, else the voice's reading of it: the card check and the steer read the SAME
  // text, so a channel that withholds a landing is a channel the steer records.
  let words = draft.heard;
  if (words === "") {
    words = draft.words;
  }
  const referents = relayReferents({ items, words });
  const disposition = relayCardDisposition({
    about: draft.about,
    cardText: cardTextOf({ about: draft.about, dir }),
    referents,
  });
  let alsoKeys: readonly string[] = [];
  if (draft.alsoAnswers !== undefined) {
    alsoKeys = draft.alsoAnswers;
  }
  const also = alsoAnsweredDispositions({
    keys: alsoKeys,
    readCardText: ({ about }) => cardTextOf({ about, dir }),
    referents,
  });
  const plan = relaySteerPlan({
    about: draft.about,
    anchor: draft.anchor,
    disposition,
    heard: words,
    items,
    nowIso,
  });
  const governing = governingSteerOf({ items, plan });
  if (unread === undefined) {
    return { also, disposition, governing, plan };
  }
  let lead = `CHANNEL: ${unread}`;
  if (plan.lead !== undefined) {
    lead = `${plan.lead}; ${unread}`;
  }
  return { also, disposition, governing, plan: { ...plan, lead } };
}

/** The newest steer across the planned steer's row lineage, or `undefined` when the plan steers nothing or none governs. */
function governingSteerOf({
  items,
  plan,
}: {
  items: readonly SlackDraftItem[];
  plan: RelaySteerPlan;
}): DraftChannelSteer | undefined {
  const steered = items.find((item) => item.id === plan.steer?.draftId);
  if (steered === undefined) {
    return undefined;
  }
  return latestChannelSteer({ item: steered, items });
}

/** What became of one steer's append. */
export type RelaySteerAppend =
  | { readonly kind: "appended" }
  | { readonly kind: "already" }
  | { readonly kind: "held"; readonly lead: string }
  | { readonly kind: "refused"; readonly why: string };

/**
 * Append one planned steer under the draft register's lock, re-reading the register inside it: the row must still be
 * held, no line this build cannot read may name it, a steer from this same relay is never written twice, and a held
 * relay's steer that would widen where the row may go is not written at all (`../../../talk/relayHeldSteer.ts`).
 *
 * @param home the state home the draft register lives under
 * @param steer the planned steer
 * @param hold why the relay's words may end before the owner did; absent or `undefined` when whole
 * @returns appended, already there, held with the lead saying so, or why nothing was written
 */
export function appendRelaySteer({
  home,
  steer,
  hold,
}: {
  home: string;
  steer: RelaySteer;
  hold?: string | undefined;
}): RelaySteerAppend {
  const lock = holdSlackDraftLock({ home });
  if (lock.isErr()) {
    return { kind: "refused", why: lock.error.message };
  }
  try {
    const lines = readSlackDraftLinesOrError({ home });
    if (lines.isErr()) {
      return { kind: "refused", why: lines.error.message };
    }
    const log = parseSlackDraftLog({ lines: lines.value });
    if (skippedLinesTouching({ id: steer.draftId, log }).length > 0) {
      return { kind: "refused", why: `a draft-register line this build cannot read may name ${steer.draftId}` };
    }
    const already = log.events.some(
      (event) => event.kind === "steered" && event.id === steer.draftId && event.anchor === steer.event.anchor,
    );
    if (already) {
      return { kind: "already" };
    }
    const items = foldSlackDrafts({ events: log.events });
    const row = items.find((item) => item.id === steer.draftId);
    if (row?.state !== "held") {
      return { kind: "refused", why: `${steer.draftId} is no longer held` };
    }
    const held = heldSteerLead({ governing: latestChannelSteer({ item: row, items }), hold, steer });
    if (held !== undefined) {
      return { kind: "held", lead: held };
    }
    const appended = appendSlackDraftEvent({ event: steer.event, home });
    if (appended.isErr()) {
      return { kind: "refused", why: appended.error.message };
    }
    return { kind: "appended" };
  } finally {
    lock.value();
  }
}

/**
 * The lead the relay's ROW opens on before any steer is appended: the held steer's NOT-recorded lead when there is one
 * (`../../../talk/relayHeldSteer.ts`), else the plan's. Without this the row would record a steer as taking effect
 * while the register still refuses it. Judged against the plan's own read; the append re-judges under the lock.
 *
 * @param plan the relay's steer plan
 * @param hold why the relay's words may end before the owner did, or `undefined` when whole
 * @param governing the newest steer across the steered row's lineage when the plan read the register
 * @returns the lead, or `undefined` when there is nothing to say
 */
export function rowSteerLead({
  plan,
  hold,
  governing,
}: {
  plan: RelaySteerPlan;
  hold: string | undefined;
  governing: DraftChannelSteer | undefined;
}): string | undefined {
  if (plan.steer === undefined) {
    return plan.lead;
  }
  const held = heldSteerLead({ governing, hold, steer: plan.steer });
  if (held !== undefined) {
    return held;
  }
  return plan.lead;
}

/**
 * Append the planned channel steer, if any, and return the lead the chair's line opens on — amended when the steer
 * could not be recorded, so the line never claims a refusal the register does not hold.
 *
 * A held relay (`../../../talk/relayCutHold.ts`) still appends a steer that NARROWS where the row may go — away from
 * its channel — and never one that widens it (`../../../talk/relayHeldSteer.ts`).
 *
 * @param home the state home the draft register lives under
 * @param plan the relay's steer plan
 * @param hold why the relay's words may end before the owner did, or `undefined` when whole
 * @returns the lead, or `undefined` when there is nothing to say
 */
export function appendSteerLead({
  home,
  plan,
  hold,
}: {
  home: string;
  plan: RelaySteerPlan;
  hold: string | undefined;
}): string | undefined {
  if (plan.steer === undefined) {
    return plan.lead;
  }
  const appended = appendRelaySteer({ hold, home, steer: plan.steer });
  if (appended.kind === "held") {
    return appended.lead;
  }
  if (appended.kind !== "refused") {
    return plan.lead;
  }
  logger.error({ msg: `talk relay: the steer on ${plan.steer.draftId} was not recorded — ${appended.why}` });
  // First, not appended: the chair's line cuts a long lead from its end, and this is the clause it must not lose.
  const notRecorded = `CHANNEL: the steer on ${plan.steer.draftId} was NOT recorded, so nothing refuses the old channel (${appended.why})`;
  if (plan.lead === undefined) {
    return notRecorded;
  }
  return `${notRecorded}; ${plan.lead}`;
}

/**
 * An `ask:` card's doc text, live or archived; any other card's text is not read.
 *
 * The doc is read the way the close's approved-draft gate reads it (`readExactDoc`) before its bytes are taken, so a
 * row whose front matter has problems is `unreadable` here too. Reading only the bytes let a relay land on a row that
 * gate could never read, and the close refused on it with no draft anywhere.
 */
function cardTextOf({ about, dir }: { about: string; dir: string }): RelayCardText {
  if (!about.startsWith("ask:")) {
    return { kind: "not-read" };
  }
  const slug = about.slice("ask:".length);
  if (!isSafeSlug({ slug })) {
    return { kind: "unreadable", why: `${about} is not a slug a doc can carry` };
  }
  const found = readExactDoc({ handoverDir: dir, slug });
  if (found.isErr()) {
    return { kind: "unreadable", why: found.error.message };
  }
  if (found.value === undefined) {
    return { kind: "read", text: "" };
  }
  const path = found.value.archived ? join(dir, "archive", `${slug}.md`) : join(dir, `${slug}.md`);
  try {
    return { kind: "read", text: readFileSync(path, "utf8") };
  } catch (cause) {
    return { kind: "unreadable", why: cause instanceof Error ? cause.message : String(cause) };
  }
}
