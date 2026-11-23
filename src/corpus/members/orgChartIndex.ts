/**
 * The org chart a Slack member's chip joins against: the Google Workspace directory and the Vanta atlas's `person`
 * and `group` kinds, each indexed by the exact address a member joins on.
 *
 * This half only indexes. Which of the people an address reaches a given member actually is gets decided in
 * `./orgChart.ts`, because that depends on the member (active or not) as well as on the stores. What this half does
 * settle is an address two directory users claim, which joins nobody here, before any member is asked about. Pure:
 * rows in, maps out.
 */
import { z } from "zod";

import type { VantaEntity } from "../../atlas/vanta/model.js";
import { isRecord } from "../../lib/parsers.js";
import { TERMINATED_PREFIX } from "../../store/identity/people.js";
import type { DirectoryUserRow } from "../directory/types.js";
import { normaliseMemberEmail } from "./email.js";

/**
 * One Vanta person, as much of Vanta's DTO as a chip reads.
 *
 * @internal — a value type of {@link OrgChart}'s `vantaPeople`.
 */
export interface VantaPersonFacts {
  readonly email: string;
  readonly jobTitle: string | undefined;
  readonly status: string;
  readonly startDate: string;
  readonly groupIds: readonly string[];
}

/**
 * A directory user, and how an address reaches them: issued to them, issued to them after a leaver used it
 * (`reissued`), an alias, or the one a leaver used.
 *
 * @internal — a value type of {@link OrgChart}'s `directory`.
 */
export interface DirectoryReach {
  readonly user: DirectoryUserRow;
  readonly via: "primary" | "reissued" | "alias" | "leaver";
}

/** The two stores, indexed by the address a member joins on. */
export interface OrgChart {
  /** A directory user by every address that reaches them: primary, alias, and the one a leaver used; an address two users claim is absent. */
  readonly directory: ReadonlyMap<string, DirectoryReach>;
  /** Every observed Vanta person holding each address — more than one where an address was re-used. */
  readonly vantaPeople: ReadonlyMap<string, readonly VantaPersonFacts[]>;
  /** A Vanta group's name and size, by id. */
  readonly vantaGroups: ReadonlyMap<string, { readonly name: string; readonly size: number }>;
  /** Every plain address a Vanta person was renamed off with `term_emp_` — the trace Google loses on deleting them. */
  readonly vantaRenamed: ReadonlySet<string>;
}

/** No org chart — what a caller that only draws names, or an install with neither store, joins against. */
export const EMPTY_ORG_CHART: OrgChart = {
  directory: new Map(),
  vantaGroups: new Map(),
  vantaPeople: new Map(),
  vantaRenamed: new Set(),
};

/**
 * The fields of Vanta's person DTO a chip reads. Deliberately not `../../atlas/vanta/personApiSchemas.ts`'s
 * `vantaPersonDtoSchema`: that one is `.strict()`, so one field Vanta adds would make every person unreadable here.
 */
const vantaPersonSchema = z.object({
  emailAddress: z.string().min(1),
  employment: z.object({ jobTitle: z.string().nullable(), startDate: z.string(), status: z.string() }),
  groupIds: z.array(z.string()),
});

/** The fields of Vanta's group DTO a chip reads. */
const vantaGroupSchema = z.object({ id: z.string().min(1), name: z.string().min(1), personnelCount: z.number() });

/**
 * A Vanta entity's current Manage-API detail — `undefined` when that channel never saw it or saw it only in an
 * older generation, since a stale person is somebody Vanta no longer lists that way.
 *
 * @returns the provider's JSON, or nothing
 */
function observedDetail({ entity }: { entity: VantaEntity }): unknown {
  const channel = entity.channels["manage-api"];
  if (channel?.state !== "observed") {
    return undefined;
  }
  return channel.detail;
}

/**
 * A store's free-text field with its whitespace trimmed, so a blank title reads as no title.
 *
 * @returns the trimmed text, or nothing for a blank one
 */
export function said({ text }: { text: string | null | undefined }): string | undefined {
  const trimmed = text?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

/**
 * Index Vanta's observed people by their exact address. Every person is kept: Vanta holds one person per account,
 * so a re-hired or duplicated address is two people, and which of them a Slack member is gets decided at the join
 * (`vantaPersonFor`) rather than here.
 *
 * @returns the people holding each address
 */
function vantaPeopleByEmail({
  people,
}: {
  people: readonly VantaEntity[];
}): ReadonlyMap<string, readonly VantaPersonFacts[]> {
  const out = new Map<string, VantaPersonFacts[]>();
  for (const entity of people) {
    const parsed = vantaPersonSchema.safeParse(observedDetail({ entity }));
    if (!parsed.success) {
      continue;
    }
    const email = normaliseMemberEmail({ email: parsed.data.emailAddress });
    const person: VantaPersonFacts = {
      email,
      groupIds: parsed.data.groupIds,
      jobTitle: said({ text: parsed.data.employment.jobTitle }),
      startDate: parsed.data.employment.startDate,
      status: parsed.data.employment.status,
    };
    const held = out.get(email);
    if (held === undefined) {
      out.set(email, [person]);
    } else {
      held.push(person);
    }
  }
  return out;
}

/**
 * The aliases Google returned for a user, exactly as issued. Not the row's own `aliases`, which
 * `normalizeEmail` has folded (`+tag` stripped), so that an address Slack holds matches only the one Google issued.
 *
 * @returns the aliases, trimmed and lowercased
 */
function issuedAliases({ user }: { user: DirectoryUserRow }): readonly string[] {
  if (!isRecord(user.raw) || !Array.isArray(user.raw["aliases"])) {
    return [];
  }
  return user.raw["aliases"]
    .filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
    .map((alias) => normaliseMemberEmail({ email: alias }));
}

/**
 * Every address other than their primary that reaches one user: each alias, then the plain address a leaver used
 * before their `term_emp_` rename.
 *
 * @returns the addresses, each with how it reaches the user
 */
function secondaryAddresses({
  user,
}: {
  user: DirectoryUserRow;
}): readonly { readonly email: string; readonly reach: DirectoryReach }[] {
  const primary = normaliseMemberEmail({ email: user.primaryEmail });
  const reached: { readonly email: string; readonly reach: DirectoryReach }[] = issuedAliases({ user }).map(
    (email) => ({ email, reach: { user, via: "alias" } }),
  );
  // Last, so a leaver whose own old address is also their alias is reached as the leaver.
  if (primary.startsWith(TERMINATED_PREFIX)) {
    reached.push({ email: primary.slice(TERMINATED_PREFIX.length), reach: { user, via: "leaver" } });
  }
  return reached.filter(({ email }) => email.includes("@"));
}

/**
 * Record one user's claim on a secondary address. A claim on someone's primary is not a claim, but a leaver's one
 * marks that primary re-issued.
 *
 * @param issued every primary address, marked in place when a leaver's claim lands on one
 * @param claims every claimant of each secondary address so far, added to in place
 */
function claimAddress({
  issued,
  claims,
  email,
  reach,
}: {
  issued: Map<string, DirectoryReach>;
  claims: Map<string, Map<string, DirectoryReach>>;
  email: string;
  reach: DirectoryReach;
}): void {
  const primary = issued.get(email);
  if (primary !== undefined) {
    // Someone's primary now: it still means them, but a leaver's old Slack account carries it too.
    if (reach.via === "leaver" && primary.via === "primary") {
      issued.set(email, { user: primary.user, via: "reissued" });
    }
    return;
  }
  const claimants = claims.get(email);
  if (claimants === undefined) {
    claims.set(email, new Map([[reach.user.googleId, reach]]));
  } else {
    claimants.set(reach.user.googleId, reach);
  }
}

/**
 * Every directory user by each exact address that reaches them — primary, alias, and the plain address an
 * off-boarded leaver used before their `term_emp_` rename, which is the one their Slack account still carries.
 *
 * A primary address is the one Google issued to that user, so it always wins. Any other address two users claim —
 * a leaver's old address re-issued as a colleague's alias, say — joins nobody, because either answer could draw one
 * person's team on another's chip. Each address says how it reached its user, for `orgFactsFor` to judge.
 *
 * @returns the users, by exact address
 */
function directoryByEmail({
  directory,
}: {
  directory: readonly DirectoryUserRow[];
}): ReadonlyMap<string, DirectoryReach> {
  const out = new Map<string, DirectoryReach>();
  for (const user of directory) {
    out.set(normaliseMemberEmail({ email: user.primaryEmail }), { user, via: "primary" });
  }
  const claims = new Map<string, Map<string, DirectoryReach>>();
  for (const user of directory) {
    for (const { email, reach } of secondaryAddresses({ user })) {
      claimAddress({ claims, email, issued: out, reach });
    }
  }
  for (const [email, claimants] of claims) {
    const [only, ...more] = claimants.values();
    if (only !== undefined && more.length === 0) {
      out.set(email, only);
    }
  }
  return out;
}

/**
 * Build the org chart a roster joins against.
 *
 * @param vantaPeople the Vanta atlas's `person` entities
 * @param vantaGroups the Vanta atlas's `group` entities
 * @param directory every Google directory user
 * @returns the stores, indexed by address
 */
export function orgChartIndex({
  vantaPeople,
  vantaGroups,
  directory,
}: {
  vantaPeople: readonly VantaEntity[];
  vantaGroups: readonly VantaEntity[];
  directory: readonly DirectoryUserRow[];
}): OrgChart {
  const groups = new Map<string, { readonly name: string; readonly size: number }>();
  for (const entity of vantaGroups) {
    const parsed = vantaGroupSchema.safeParse(observedDetail({ entity }));
    if (parsed.success) {
      groups.set(parsed.data.id, { name: parsed.data.name, size: parsed.data.personnelCount });
    }
  }
  const people = vantaPeopleByEmail({ people: vantaPeople });
  const renamed = new Set<string>();
  for (const email of people.keys()) {
    if (email.startsWith(TERMINATED_PREFIX)) {
      renamed.add(email.slice(TERMINATED_PREFIX.length));
    }
  }
  return {
    directory: directoryByEmail({ directory }),
    vantaGroups: groups,
    vantaPeople: people,
    vantaRenamed: renamed,
  };
}
