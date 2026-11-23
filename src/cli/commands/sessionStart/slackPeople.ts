/**
 * WHO WROTE A SLACK MESSAGE, and whether they are a person — the one question both Slack detectors ask of
 * the members index, answered in one place so they cannot drift apart.
 *
 * ## Two ids are not people and the index says so about neither
 *
 * **Slackbot is not a bot, according to Slack.** The members index carries `profile.bot` straight from
 * Slack's `is_bot`, and Slack reports `is_bot: false` for `USLACKBOT` itself, which posts huddle notes and
 * reminders under a profile claiming to be a person. It is named here as a platform constant.
 *
 * **Slopweaver is not a person either.** The bot posts under its own Slack id, so without
 * {@link SlackPeopleOptions.selfIds} a thread it answered reads as "somebody replied and the owner did not" —
 * measured at 29% of the thread-movement detector's whole yield.
 *
 * ## The `bot` flag is what keeps the mention detector honest
 *
 * measured on the owner's corpus, the highest-volume mentioner of the owner in a sampled day is
 * `Nightfall Enterprise DLP for Slack`, which tags the owner on every alert it raises in its own channel. The
 * index carries `profile.bot: true` for it and `false` for the colleagues asking the owner real questions, so
 * this filter is the difference between a mention list of people and a mention list of alerts.
 *
 * Effectful only in {@link memberIndex}, which reads the index once per run; everything else is pure.
 */

import { readMemberRows } from "../../../corpus/members/store.js";
import { loadProfile } from "../../../profileStore.js";

/**
 * Slack's own account, which Slack reports as `is_bot: false`.
 *
 * Named here rather than read from the members index because the index faithfully carries Slack's answer,
 * and Slack's answer is wrong for this one id. This is a Slack platform constant, not anybody's identifier.
 */
const SLACKBOT_ID = "USLACKBOT";

/** Slack's own account `USLACK`, which Slack also reports as `is_bot: false`; see `corpus/members/slackPeople.ts`. */
const SLACK_ID = "USLACK";

/** One member the index knows, reduced to what a row needs. */
export interface MemberFacts {
  readonly bot: boolean;
  readonly name: string;
  /** False for a deactivated account, which can still have spoken but can no longer be asked anything. */
  readonly active: boolean;
}

/**
 * Slopweaver's own declared bot ids, from `profile.json`.
 *
 * An install that declares none is an ordinary state — it simply means the bot has never posted — and that
 * case gets its own branch rather than an operator, so the empty answer reads as a fact about the profile
 * instead of as a default nobody chose.
 *
 * @param home the state home holding the profile
 * @returns the declared ids, empty when the profile names none
 */
export function selfBotIds({ home }: { home: string }): ReadonlySet<string> {
  const declared = loadProfile({ home })?.slackBot?.selfUserIds;
  if (declared === undefined) {
    return new Set();
  }
  return new Set(declared);
}

/**
 * The members index, keyed by Slack id.
 *
 * Read once per run and handed to both detectors: it was read twice per run when `threadsOf` owned it, and
 * the mention detector needs the identical answer to the identical question.
 *
 * @param home the state home holding the members index
 * @returns each known id's display name and whether Slack calls it a bot
 */
export function memberIndex({ home }: { home: string }): ReadonlyMap<string, MemberFacts> {
  return memberIndexRead({ home }).members;
}

/**
 * The members index together with what reading it could not do, for a caller whose answer depends on the index
 * being whole: an absent file and an unparseable line both leave a bot indistinguishable from a person.
 *
 * @param home the state home holding the members index
 * @returns the index, and the problem with it, null when it read cleanly with at least one row
 */
export function memberIndexRead({ home }: { home: string }): {
  members: ReadonlyMap<string, MemberFacts>;
  problem: string | null;
} {
  const read = readMemberRows({ home, source: "slack" });
  const members = new Map(
    read.rows.map((row) => [
      row.sourceId,
      {
        active: row.profile.active !== false,
        bot: row.profile.bot === true,
        name: memberNameOf({ identity: row.identity, sourceId: row.sourceId }),
      },
    ]),
  );
  let problem: string | null = null;
  if (read.warnings.length > 0) {
    problem = `the Slack members index did not read cleanly (${read.warnings.join("; ")})`;
  } else if (read.rows.length === 0) {
    problem = "this home holds no Slack members index";
  }
  return { members, problem };
}

/**
 * The best name the index has for one member, with each substitution spelled out.
 *
 * Written as branches rather than as a `??` chain because the last rung hands a row a raw platform id where
 * it expected a person's name, and that substitution is exactly the one the `no-silent-fallback` gate exists
 * to keep visible. A row reading `U0SYNABC1234 spoke last` is a row the owner cannot act on.
 *
 * @param identity the member row's identity block
 * @param sourceId the member's own Slack id, the last rung
 * @returns the display name a row shows
 */
function memberNameOf({
  identity,
  sourceId,
}: {
  identity: { readonly name?: string | undefined; readonly handle?: string | undefined };
  sourceId: string;
}): string {
  if (identity.name !== undefined) {
    return identity.name;
  }
  if (identity.handle !== undefined) {
    return identity.handle;
  }
  return sourceId;
}

/**
 * The display name one author gets on a row.
 *
 * @param author the message's author id
 * @param members the members index
 * @returns the member's name, or the raw id when the index has never seen them
 */
export function displayNameOf({
  author,
  members,
}: {
  author: string;
  members: ReadonlyMap<string, MemberFacts>;
}): string {
  const known = members.get(author);
  if (known === undefined) {
    return author;
  }
  return known.name;
}

/**
 * Whether one author is a person, as both detectors have to ask it.
 *
 * Three ids are not: Slopweaver's own, Slack's `USLACKBOT` (which Slack itself reports as `is_bot: false`),
 * and anything the index marks a bot. The last is what keeps the mention detector honest — the measured
 * highest-volume mentioner of the owner is a DLP alert app.
 *
 * @param author the message's author id
 * @param members the members index
 * @param selfIds Slopweaver's own declared bot ids, from `profile.json`
 * @returns whether a row built from this author is a row about a person
 */
export function authorIsHuman({
  author,
  members,
  selfIds,
}: {
  author: string;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): boolean {
  return !selfIds.has(author) && author !== SLACKBOT_ID && members.get(author)?.bot !== true;
}

/**
 * Whether a chase may tag one id — stricter than {@link authorIsHuman}, which asks whether a word ANSWERS.
 *
 * A tag is an outward act naming somebody, so it goes only to a person the members index KNOWS, who is still
 * active, and who is not the owner: an unknown id is listed on the row but never proposed, and the as-me door refuses
 * an unresolvable mention anyway. `authorIsHuman` stays as it is, because loosening or tightening it would move
 * `slack owed` and `session-start`'s yield.
 *
 * @param id the Slack id a chase might tag
 * @param ownerId the owner's own Slack id
 * @param members the members index
 * @param selfIds Slopweaver's own declared bot ids
 * @returns whether the id is somebody a chase may name
 */
export function isTaggablePerson({
  id,
  ownerId,
  members,
  selfIds,
}: {
  id: string;
  ownerId: string;
  members: ReadonlyMap<string, MemberFacts>;
  selfIds: ReadonlySet<string>;
}): boolean {
  const known = members.get(id);
  if (known === undefined || id === ownerId || id === SLACK_ID) {
    return false;
  }
  return known.active && authorIsHuman({ author: id, members, selfIds });
}
