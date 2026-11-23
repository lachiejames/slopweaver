/**
 * The roster spine — Vanta's own people, which every other platform's rows are judged against.
 *
 * ## One address can carry SEVERAL employment records, and that is the defect this file exists to hold
 *
 * MEASURED on a generation read: **an address can carry more than one person
 * record**, because Vanta holds one record per employment SPELL and a rehire is two spells on one address.
 * A rehire at `a.rehire@acme.com` is the shape: a first spell that has ended
 * (`FORMER`), and a second, later one that is `CURRENT`. Reproduce with
 * `slopweaver atlas vanta read --kind person --limit 1000 --json`, or:
 *
 * ```bash
 * jq -r '.channels["manage-api"].detail.emailAddress' ~/.slopweaver/atlas/vanta/people.jsonl \
 *   | sort | uniq -c | awk '$1>1'
 * ```
 *
 * **A last-record-wins map over those addresses answers whichever spell happened to be read last.** That is
 * how the first cut of this report was built, and it silently decided rehired people's buckets on file order,
 * while each of them held their accounts legitimately. So spells are grouped and reduced EXPLICITLY here:
 *
 * - a person is still employed when **any** spell is not `FORMER`;
 * - a person has departed only when **every** spell is `FORMER`, and their departure is the **latest** end
 *   date across them;
 * - a rehire — a `FORMER` spell plus a live one — is NOT a finding, and the count of them is published,
 *   because that number is exactly the difference between this report and a naive one.
 *
 * ## `INACTIVE` and `ON_LEAVE` are not departures, and this file does not decide that they are
 *
 * A generation holds `INACTIVE` and `ON_LEAVE` records beside `CURRENT` and `FORMER`. Only `FORMER` is a
 * departure in Vanta's own vocabulary. The other two are reported as their own residue rather than being
 * folded either way — inventing a policy for them here would be this report asserting something the roster
 * does not say.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { AtlasEntityView } from "../atlas/kit/read.js";

import { type AccessPlatformSpec, readDetailPath, verbatimLevel } from "./levels.js";

/** The employment status Vanta gives someone whose spell has ended. */
export const FORMER_STATUS = "FORMER";

/** One person on the roster, reduced from every employment spell their address carries. */
export interface RosterPerson {
  /** The address, lowercased — the join key. */
  readonly email: string;
  /** The roster's own display name, or `null` when no spell holds one. */
  readonly display: string | null;
  /** Every employment status the roster holds for this address, verbatim, in the order read. */
  readonly statuses: readonly string[];
  /** True when at least one spell is not `FORMER` — the address has a live employment record. */
  readonly stillEmployed: boolean;
  /** The LATEST end date across their `FORMER` spells, verbatim, or `null` when none carries one. */
  readonly endDateIso: string | null;
  /** How many employment records the roster holds for this address. */
  readonly spells: number;
}

/** The whole roster, plus everything the reduction could not resolve. */
export interface Roster {
  readonly people: readonly RosterPerson[];
  /** Records carrying no readable address. */
  readonly addressless: number;
  /** Departed people the roster gives no end date, so no bucket can be computed for them. */
  readonly formerWithoutEndDate: readonly string[];
  /** Addresses carrying a `FORMER` spell AND a live one — rehires, which are not findings. */
  readonly rehired: readonly string[];
  /** Every status that is neither `CURRENT` nor `FORMER`, with how many addresses carry one. */
  readonly nonDepartureStatuses: readonly { readonly status: string; readonly addresses: number }[];
}

/** One employment spell, as read off one record. */
interface Spell {
  readonly display: string | null;
  readonly status: string | null;
  readonly endDateIso: string | null;
}

/** Read one entity into a spell. */
function spellOf({ entity, spec }: { entity: AtlasEntityView; spec: AccessPlatformSpec }): Spell {
  return {
    display: verbatimLevel({ value: readDetailPath({ detail: entity.detail, path: spec.displayPath }) }),
    endDateIso: verbatimLevel({ value: readDetailPath({ detail: entity.detail, path: ["employment", "endDate"] }) }),
    status: verbatimLevel({ value: readDetailPath({ detail: entity.detail, path: ["employment", "status"] }) }),
  };
}

/**
 * The last day across every departed spell on one address, failing closed. A dated spell must never mask an
 * undated one — the last day is then unknown, so `null` sends the address to the no-end-date residue — and an
 * unparseable date is kept verbatim rather than dropped, so the join leaves it unmeasured instead of judging
 * the person by an earlier spell.
 */
function lastEndDateOf({ endDates }: { endDates: readonly (string | null)[] }): string | null {
  let latest: { readonly iso: string; readonly ms: number } | null = null;
  for (const endDate of endDates) {
    if (endDate === null) {
      return null;
    }
    const ms = parseStrictIsoInstantMs({ text: endDate });
    if (ms === undefined) {
      return endDate;
    }
    if (latest === null || ms > latest.ms) {
      latest = { iso: endDate, ms };
    }
  }
  if (latest === null) {
    return null;
  }
  return latest.iso;
}

/** The first name any of one address's spells carries, or `null` when none of them does. */
function displayOf({ spells }: { spells: readonly Spell[] }): string | null {
  const named = spells.find((spell) => spell.display !== null);
  if (named === undefined) {
    return null;
  }
  return named.display;
}

/** Reduce every spell on one address into one person. */
function personOf({ email, spells }: { email: string; spells: readonly Spell[] }): RosterPerson {
  const statuses = spells.flatMap((spell) => (spell.status === null ? [] : [spell.status]));
  const endDateIso = lastEndDateOf({
    endDates: spells.filter((spell) => spell.status === FORMER_STATUS).map((spell) => spell.endDateIso),
  });
  return {
    display: displayOf({ spells }),
    email,
    endDateIso,
    spells: spells.length,
    statuses,
    stillEmployed: spells.some((spell) => spell.status !== FORMER_STATUS),
  };
}

/**
 * Project the spine's entities into a roster, grouping every employment spell on one address.
 *
 * @param spec the spine's own spec, which names where its status and end date live
 * @param entities the `person` kind's entities
 * @returns the roster, sorted by address, plus every residue the reduction owes a reader
 */
export function rosterOf({
  spec,
  entities,
}: {
  spec: AccessPlatformSpec;
  entities: readonly AtlasEntityView[];
}): Roster {
  const spellsByAddress = new Map<string, Spell[]>();
  let addressless = 0;
  for (const entity of entities) {
    const raw = verbatimLevel({ value: readDetailPath({ detail: entity.detail, path: spec.emailPath }) });
    if (raw === null || raw.trim().length === 0) {
      addressless += 1;
      continue;
    }
    const email = raw.trim().toLowerCase();
    const existing = spellsByAddress.get(email);
    if (existing === undefined) {
      spellsByAddress.set(email, [spellOf({ entity, spec })]);
    } else {
      existing.push(spellOf({ entity, spec }));
    }
  }
  const people = [...spellsByAddress.entries()]
    .map(([email, spells]) => personOf({ email, spells }))
    .toSorted((left, right) => left.email.localeCompare(right.email));
  return {
    addressless,
    formerWithoutEndDate: people
      .filter((person) => hasDeparted({ person }) && person.endDateIso === null)
      .map((person) => person.email),
    nonDepartureStatuses: nonDepartureStatusesOf({ people }),
    people,
    rehired: people
      .filter((person) => person.stillEmployed && person.statuses.includes(FORMER_STATUS))
      .map((person) => person.email),
  };
}

/** Every status that is neither a departure nor plainly current, counted by address. */
function nonDepartureStatusesOf({
  people,
}: {
  people: readonly RosterPerson[];
}): readonly { readonly status: string; readonly addresses: number }[] {
  const counts = new Map<string, number>();
  for (const person of people) {
    for (const status of new Set(person.statuses)) {
      if (status === FORMER_STATUS || status === "CURRENT") {
        continue;
      }
      const seen = counts.get(status);
      counts.set(status, seen === undefined ? 1 : seen + 1);
    }
  }
  return [...counts.entries()]
    .map(([status, addresses]) => ({ addresses, status }))
    .toSorted((left, right) => left.status.localeCompare(right.status));
}

/**
 * Whether the roster says this address has departed — every spell on it is `FORMER`.
 *
 * @param person the reduced roster row
 * @returns true when no spell is live
 */
export function hasDeparted({ person }: { person: RosterPerson }): boolean {
  return !person.stillEmployed && person.statuses.includes(FORMER_STATUS);
}

/**
 * When a person's employment last ended, as milliseconds, or `null` when the roster gives no usable date.
 *
 * @param person the roster row
 * @returns the instant, or `null` when there is no end date or it does not parse
 */
export function endDateMsOf({ person }: { person: RosterPerson }): number | null {
  if (person.endDateIso === null) {
    return null;
  }
  const parsed = parseStrictIsoInstantMs({ text: person.endDateIso });
  if (parsed === undefined) {
    return null;
  }
  return parsed;
}

/**
 * Every person the roster records as having departed with an end date, oldest departure first.
 *
 * An end date that does not parse as an instant (a date-only value, say) is KEPT: the join buckets it
 * `unmeasured`, since there is no instant to compare a read against. Dropping it here would leave the person
 * in no bucket and no residue at all. Only a departure with no end date goes to `formerWithoutEndDate`.
 *
 * A rehire is excluded by construction: {@link hasDeparted} is false the moment any spell on the address is
 * live, so somebody who left and came back is not a finding against the account they legitimately hold.
 *
 * @param roster the projected roster
 * @returns the departed people the join buckets
 */
export function formerStaffOf({ roster }: { roster: Roster }): readonly RosterPerson[] {
  return roster.people
    .filter((person) => hasDeparted({ person }) && person.endDateIso !== null)
    .toSorted((left, right) => sortByDeparture({ left, right }));
}

/** Oldest departure first, an unparseable end date after every dated one, address as the tie-break. */
function sortByDeparture({ left, right }: { left: RosterPerson; right: RosterPerson }): number {
  const leftMs = endDateMsOf({ person: left });
  const rightMs = endDateMsOf({ person: right });
  if (leftMs === null && rightMs === null) {
    return left.email.localeCompare(right.email);
  }
  if (leftMs === null) {
    return 1;
  }
  if (rightMs === null) {
    return -1;
  }
  if (leftMs !== rightMs) {
    return leftMs - rightMs;
  }
  return left.email.localeCompare(right.email);
}
