/**
 * Where a Slack member sits in the organisation — their title, team, org unit and Vanta groups — for the identity
 * chip's hover card.
 *
 * The chip carries more than a name: people's titles, their Vanta group and their team, drawn from the
 * organisational chart. Two stores this
 * install already holds answer it: the Google Workspace directory (`../directory/types.ts`, the authority a `person`
 * is keyed on) and the Vanta atlas's `person` and `group` kinds. Both are joined by the member's TRUSTED Slack email
 * only (`./email.ts`'s `trustedJoinEmail`): a weak or missing address joins nothing, because a wrong join names the
 * wrong team on a draft about a real person, and a chip saying nothing is honest.
 *
 * Every fact names its source, so the hover card can say where it came from. The stores are indexed in
 * `./orgChartIndex.ts`; this half decides which of the people an address reaches a given member is. Pure: rows in,
 * facts out.
 */
import { isRecord } from "../../lib/parsers.js";
import type { DirectoryUserRow } from "../directory/types.js";
import { normaliseMemberEmail } from "./email.js";
import { type DirectoryReach, type OrgChart, said, type VantaPersonFacts } from "./orgChartIndex.js";

/**
 * Which store a fact was read from — what the hover card names beside it.
 *
 * @internal — a field type of {@link OrgTitle}; the site spells its own copy.
 */
export type OrgFactSource = "google-admin" | "vanta";

/**
 * A job title, and the store that holds it.
 *
 * @internal — a field type of {@link OrgFacts}.
 */
export interface OrgTitle {
  readonly value: string;
  readonly source: OrgFactSource;
}

/** Where one person sits in the organisation, as the directory and Vanta hold it. */
export interface OrgFacts {
  /** Google's title for them, else Vanta's `jobTitle` — never Slack's, which the chip already draws. */
  readonly title?: OrgTitle;
  /** Google's `organizations[0].department` — the team. */
  readonly department?: string;
  /** Google's org unit, as its path reads (`/Staff/…`). */
  readonly orgUnit?: string;
  /** Vanta's employment status as it spells it (`CURRENT`, `ON_LEAVE`, `FORMER`). */
  readonly vantaStatus?: string;
  /** Every Vanta group they are in, the smallest first — the most specific group leads, `Everyone` trails. */
  readonly vantaGroups: readonly string[];
}

/**
 * The department Google's first `organizations` entry names — the directory row keeps the whole user on `raw` and
 * projects only the title.
 *
 * @returns the department, or nothing
 */
function departmentOf({ user }: { user: DirectoryUserRow }): string | undefined {
  if (!isRecord(user.raw) || !Array.isArray(user.raw["organizations"])) {
    return undefined;
  }
  const first: unknown = user.raw["organizations"][0];
  if (!isRecord(first) || typeof first["department"] !== "string") {
    return undefined;
  }
  return said({ text: first["department"] });
}

/**
 * The Vanta groups one person is in, by name, the smallest first. A group id no observed group carries is left
 * out rather than named by its id.
 *
 * @returns the group names
 */
function groupNames({ chart, person }: { chart: OrgChart; person: VantaPersonFacts }): readonly string[] {
  const groups: { readonly name: string; readonly size: number }[] = [];
  for (const id of new Set(person.groupIds)) {
    const group = chart.vantaGroups.get(id);
    if (group !== undefined) {
      groups.push(group);
    }
  }
  return groups.toSorted((a, b) => a.size - b.size || a.name.localeCompare(b.name)).map((group) => group.name);
}

/**
 * Which Vanta person an address means for one Slack member. A lone holder is them. Where several people hold the
 * address, only an active member resolves, and only to the one CURRENT holder — the colleague employed now is the
 * one using the account; a deactivated member, or any other mix, could be any of them, so it is nobody.
 *
 * @returns the person, or nothing when the address is absent or ambiguous
 */
function vantaPersonFor({
  holders,
  active,
}: {
  holders: readonly VantaPersonFacts[] | undefined;
  active: boolean;
}): VantaPersonFacts | undefined {
  if (holders === undefined) {
    return undefined;
  }
  if (holders.length === 1) {
    return holders[0];
  }
  const current = holders.filter((person) => person.status === "CURRENT");
  if (!active || current.length !== 1) {
    return undefined;
  }
  return current[0];
}

/**
 * The Vanta person, kept only when nothing says they are a different human from the Google user the same address
 * reached. The two stores are refreshed apart, so one can lag: a live Google account beside a Vanta record of
 * somebody who has LEFT is a new hire on a leaver's old address that Vanta has not caught up with, a leaver beside a
 * record Vanta calls employed is the reverse, and an address Google re-issued means only the one holder employed now.
 *
 * @param person the Vanta person the address resolved to
 * @param reach how the address reached the Google user the chip will draw, when it draws one
 * @param reissued whether either store shows a leaver used the address before its holder now
 * @returns the person, or nothing when the two stores disagree about who holds the address
 */
function sameHumanAs({
  person,
  reach,
  reissued,
}: {
  person: VantaPersonFacts | undefined;
  reach: DirectoryReach | undefined;
  reissued: boolean;
}): VantaPersonFacts | undefined {
  if (person === undefined) {
    return undefined;
  }
  if (reissued && person.status !== "CURRENT") {
    return undefined;
  }
  if (reach === undefined) {
    return person;
  }
  // A leaver is nobody Vanta employs now or soon, so a CURRENT or UPCOMING record is whoever took the address on.
  if (reach.via === "leaver" && (person.status === "CURRENT" || person.status === "UPCOMING")) {
    return undefined;
  }
  const live = reach.via !== "leaver" && !reach.user.suspended && !reach.user.archived;
  if (live && person.status === "FORMER") {
    return undefined;
  }
  return person;
}

/**
 * Whether a leaver used an address before whoever holds it now: Google holds it as a primary after a leaver used it,
 * or Vanta renamed a leaver off it while Google does not reach it as that leaver — Google deletes a leaver's account,
 * Vanta keeps the renamed record.
 *
 * @returns true when either store shows the address re-issued
 */
function isReissued({
  chart,
  key,
  reach,
}: {
  chart: OrgChart;
  key: string;
  reach: DirectoryReach | undefined;
}): boolean {
  if (reach?.via === "reissued") {
    return true;
  }
  return reach?.via !== "leaver" && chart.vantaRenamed.has(key);
}

/**
 * Whether an address could mean two different humans for this member, so it must join nobody at all.
 *
 * @param reissued whether either store shows a leaver used the address before its holder now
 * @returns true when neither store can say which human the member is
 */
function ambiguousForMember({
  active,
  reach,
  holders,
  reissued,
}: {
  active: boolean;
  reach: DirectoryReach | undefined;
  holders: readonly VantaPersonFacts[] | undefined;
  reissued: boolean;
}): boolean {
  // A deactivated member holding a re-issued address may be that leaver or the person it was re-issued to (a rehire
  // is the same person, a new hire is not), so neither store can say which.
  if (!active) {
    return reissued;
  }
  // An active member on an address Google knows only as a leaver's, while Vanta says someone employed holds it now,
  // is most likely whoever it was handed on to — or a leaver whose Slack deactivation lagged — so neither answer.
  const employedHolder = holders?.some((holder) => holder.status === "CURRENT" || holder.status === "UPCOMING");
  return reach?.via === "leaver" && employedHolder === true;
}

/**
 * The Google user whose facts a member's chip draws. A deactivated member's address that is now someone's alias was
 * most likely handed on when they left — to the colleague who took their mail — so it means that colleague, not them.
 *
 * @returns the user, or nothing when the address reaches no one this member can be
 */
function drawnUser({
  reach,
  active,
}: {
  reach: DirectoryReach | undefined;
  active: boolean;
}): DirectoryUserRow | undefined {
  if (reach === undefined || (!active && reach.via === "alias")) {
    return undefined;
  }
  return reach.user;
}

/**
 * A title, Google's first because the directory is where a title is edited, Vanta's when Google holds none.
 *
 * @returns the title and its store, or nothing
 */
function titleOf({
  user,
  person,
}: {
  user: DirectoryUserRow | undefined;
  person: VantaPersonFacts | undefined;
}): OrgTitle | undefined {
  const googleTitle = said({ text: user?.title });
  if (googleTitle !== undefined) {
    return { source: "google-admin", value: googleTitle };
  }
  if (person?.jobTitle !== undefined) {
    return { source: "vanta", value: person.jobTitle };
  }
  return undefined;
}

/**
 * A user's org unit. The root unit is where Google puts anyone nobody placed, so it says nothing about them.
 *
 * @returns the unit path, or nothing
 */
function orgUnitOf({ user }: { user: DirectoryUserRow | undefined }): string | undefined {
  const orgUnit = said({ text: user?.orgUnitPath });
  if (orgUnit === "/") {
    return undefined;
  }
  return orgUnit;
}

/**
 * Where the person behind `email` sits in the organisation. Both stores are keyed on the address exactly as issued,
 * trimmed and lowercased, never folded further: `hello+slack@` is a different mailbox's name from `hello@`.
 *
 * @param chart the stores, indexed
 * @param email the member's trusted join address, or nothing when their address is not trusted
 * @param active whether the Slack member is still active — the only way a re-used Vanta address resolves
 * @returns their facts, or nothing when neither store holds the address
 */
export function orgFactsFor({
  chart,
  email,
  active,
}: {
  chart: OrgChart;
  email: string | undefined;
  active: boolean;
}): OrgFacts | undefined {
  if (email === undefined) {
    return undefined;
  }
  const key = normaliseMemberEmail({ email });
  const reach = chart.directory.get(key);
  const reissued = isReissued({ chart, key, reach });
  const holders = chart.vantaPeople.get(key);
  if (ambiguousForMember({ active, holders, reach, reissued })) {
    return undefined;
  }
  const user = drawnUser({ active, reach });
  const person = sameHumanAs({
    person: vantaPersonFor({ active, holders }),
    reach: user === undefined ? undefined : reach,
    reissued,
  });
  if (user === undefined && person === undefined) {
    return undefined;
  }
  const title = titleOf({ person, user });
  const department = user === undefined ? undefined : departmentOf({ user });
  const orgUnit = orgUnitOf({ user });
  return {
    vantaGroups: person === undefined ? [] : groupNames({ chart, person }),
    ...(title === undefined ? {} : { title }),
    ...(department === undefined ? {} : { department }),
    ...(orgUnit === undefined ? {} : { orgUnit }),
    ...(person === undefined ? {} : { vantaStatus: person.status }),
  };
}
