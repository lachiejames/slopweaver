/**
 * The production wiring for a Linear write: the assignee resolved from the identity layers, and the destination
 * team's recorded state catalog.
 *
 * These live apart from the shells so each shell stays a shell — both are injected dependencies there, and
 * both touch something real here.
 *
 * Every resolver reads the store's identity roster ONCE through a required {@link IdentityRosterPort}, so the
 * overrides, the heard-as pins and the freshness revision the derived roster is judged against all come off one
 * snapshot. A store that cannot answer is the resolver's typed refusal, never a resolution against the layers it
 * could still read: who a key names is exactly the question the roster settles.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type AssigneeResolution, resolveAssigneeKey } from "../../../outbound/linear/assigneeIndex.js";
import { type LinearMentionResolution, resolveLinearMentions } from "../../../outbound/linear/mentionIndex.js";
import { readStateCatalog, type StateCatalog } from "../../../outbound/linear/stateCatalog.js";
import { lookupMentionsWithHeardAs } from "../../../silver/heardAs.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import type { IdentityRosterPort } from "../../../silver/identityRoster.js";
import type { IdentityRosterError } from "../../../silver/identityRosterErrors.js";
import { loadDerivedRoster } from "../../../silver/loadDerivedRoster.js";
import { memberDirectory } from "../../../silver/memberDirectory.js";
import { rosterForSend } from "../../../silver/rosterForSend.js";

/**
 * The shape every Linear write's mention seam takes — the live resolver and the dry-run preview alike, bound to
 * one ask instant and one roster port by the verb's own deps factory.
 */
export type LinearMentionResolver = (args: {
  home: string;
  keys: readonly string[];
  verified: ReadonlyMap<string, string>;
}) => Promise<Result<LinearMentionResolution, IdentityRosterError>>;

/**
 * Resolve the assignee key through BOTH identity layers, refreshing the roster just-in-time when the
 * freshness contract says to.
 *
 * EXACT MATCH ONLY, and only over keys a LINEAR identity owns (see `assigneeIndex.ts`). A key that is not an
 * exact match resolves to nothing and the caller turns that into a hard refusal before any write. Never a
 * fuzzy match, never a nearest guess: assigning the wrong colleague is worse than refusing.
 *
 * @param home the state home holding the derived roster
 * @param person the key the form names, or undefined when it assigns nobody
 * @param askedAtIso when this write was asked for, which the roster's freshness is judged against
 * @param identityRoster the door the store's human roster is read through
 * @returns the resolution, its origin layer, and the roster state behind it; or the roster's typed refusal
 */
export async function assigneeFromIdentity({
  home,
  person,
  askedAtIso,
  identityRoster,
}: {
  home: string;
  person: string | undefined;
  askedAtIso: string;
  identityRoster: IdentityRosterPort;
}): Promise<Result<AssigneeResolution, IdentityRosterError>> {
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { roster, freshness } = rosterForSend({
    affectsOutput: person !== undefined,
    askedAtIso,
    home,
    identityRoster: snapshot.value,
  });
  return ok(resolveAssigneeKey({ derived: roster, freshness, overrides: snapshot.value.records, person }));
}

/**
 * Resolve the assignee key WITHOUT refreshing anything — the dry-run reading.
 *
 * A dry run performs no effect at all, and the just-in-time derive {@link assigneeFromIdentity} may run
 * writes silver artifacts, so the preview cannot use it. It reads the derived roster exactly as it stands
 * instead, which catches the common failure (a key nobody has confirmed) while leaving no trace there. A key
 * that fails HERE may still resolve on the live run, because that run refreshes first — which is why the
 * dry-run report says so rather than presenting this as the final answer.
 *
 * @param home the state home holding the derived roster
 * @param person the key the form names, or undefined when it assigns nobody
 * @param identityRoster the door the store's human roster is read through
 * @returns the resolution against the rosters as they currently stand; or the roster's typed refusal
 */
export async function assigneeFromIdentityUnrefreshed({
  home,
  person,
  identityRoster,
}: {
  home: string;
  person: string | undefined;
  identityRoster: IdentityRosterPort;
}): Promise<Result<AssigneeResolution, IdentityRosterError>> {
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const loaded = loadDerivedRoster({ home, rosterRevision: snapshot.value.revision });
  return ok(
    resolveAssigneeKey({
      derived: loaded.roster,
      freshness: loaded.freshness,
      overrides: snapshot.value.records,
      person,
    }),
  );
}

/**
 * Resolve every mention key a body names, through BOTH identity layers, refreshing the roster just-in-time
 * when the freshness contract says to.
 *
 * EXACT MATCH ONLY over the keys an assignee may use (see `../../../outbound/linear/personIndex.ts`), plus
 * the MEMBER index's tiered name match (`../../../silver/mentionResolver.ts`), which resolves a bare first
 * name only when exactly one live colleague answers to it and REFUSES — naming them — when more than one
 * does. A key that resolves nowhere becomes a hard refusal that NAMES the candidates, before any write.
 * Never a nearest guess: notifying the wrong colleague is worse than refusing.
 *
 * The member index also decides whether `derive` runs at all here. It needs no derive of its own, so a body
 * whose every mention it settles pays nothing for a just-in-time rebuild that, past the heap ceiling,
 * refuses in minutes and changes nothing.
 *
 * @param home the state home holding member bronze and the derived roster
 * @param keys the mention keys the body names, in first-appearance order
 * @param verified the `--mention-id` ids the caller checked live, which win over the roster
 * @param askedAtIso when this write was asked for, which the roster's freshness is judged against
 * @param identityRoster the door the store's human roster is read through
 * @returns what resolved, the roster state behind it, and the candidates for whatever did not; or the roster's
 *   typed refusal
 */
export async function mentionsFromIdentity({
  home,
  keys,
  verified,
  askedAtIso,
  identityRoster,
}: {
  home: string;
  keys: readonly string[];
  verified: ReadonlyMap<string, string>;
  askedAtIso: string;
  identityRoster: IdentityRosterPort;
}): Promise<Result<LinearMentionResolution, IdentityRosterError>> {
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const overrides = snapshot.value.records;
  const memberLookups = memberMentionLookups({ home, keys, overrides });
  const { roster, freshness } = rosterForSend({
    affectsOutput: keys.some((key) => memberLookups.get(key)?.kind !== "resolved" && !verified.has(key)),
    askedAtIso,
    home,
    identityRoster: snapshot.value,
  });
  return ok(
    resolveLinearMentions({
      derived: roster,
      freshness,
      keys,
      memberLookups,
      overrides,
      verified,
    }),
  );
}

/**
 * The member index's verdict on each mention key — the derive-free leg, shared by the live and dry-run
 * readings so the preview and the write cannot disagree about who a key names.
 *
 * @param home the state home holding member bronze
 * @param keys the mention keys the body names
 * @param overrides the human roster, read once by the caller so its heard-as pins and its override keys come
 *   from the same snapshot
 * @returns one lookup per distinct key
 */
function memberMentionLookups({
  home,
  keys,
  overrides,
}: {
  home: string;
  keys: readonly string[];
  overrides: readonly IdentityRecord[];
}): ReturnType<typeof lookupMentionsWithHeardAs> {
  const directory = memberDirectory({ home });
  return lookupMentionsWithHeardAs({
    keys,
    orgDomains: directory.orgDomains,
    records: overrides,
    rows: directory.rows,
    source: "linear",
  });
}

/**
 * Resolve the mention keys WITHOUT refreshing anything — the dry-run reading.
 *
 * Same reasoning as {@link assigneeFromIdentityUnrefreshed}: a dry run performs no effect at all, and the
 * just-in-time derive writes silver artifacts, so the preview reads the derived roster exactly as it stands.
 *
 * @param home the state home holding member bronze and the derived roster
 * @param keys the mention keys the body names, in first-appearance order
 * @param verified the `--mention-id` ids the caller checked live, which win over the roster
 * @param identityRoster the door the store's human roster is read through
 * @returns the resolution against the rosters as they currently stand; or the roster's typed refusal
 */
export async function mentionsFromIdentityUnrefreshed({
  home,
  keys,
  verified,
  identityRoster,
}: {
  home: string;
  keys: readonly string[];
  verified: ReadonlyMap<string, string>;
  identityRoster: IdentityRosterPort;
}): Promise<Result<LinearMentionResolution, IdentityRosterError>> {
  const snapshot = await identityRoster.read({ home });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const loaded = loadDerivedRoster({ home, rosterRevision: snapshot.value.revision });
  const overrides = snapshot.value.records;
  return ok(
    resolveLinearMentions({
      derived: loaded.roster,
      freshness: loaded.freshness,
      keys,
      memberLookups: memberMentionLookups({ home, keys, overrides }),
      overrides,
      verified,
    }),
  );
}

/**
 * The recorded workflow-state catalog for a destination team.
 *
 * @param home the state home holding the ledger
 * @param teamId the destination team's UUID
 * @returns the catalog, or undefined when `linear states` has never read this team
 */
export function stateCatalogFor({ home, teamId }: { home: string; teamId: string }): StateCatalog | undefined {
  return readStateCatalog({ home, teamId });
}
