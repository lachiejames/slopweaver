/**
 * The record of what `slopweaver linear states` actually SAW — and the authority the issue write door
 * consults before it will send a `stateId`.
 *
 * ## Why a write gate needs a local copy of a live read
 *
 * A workflow-state id is an opaque UUID. Nothing about it says which team it belongs to, whether it exists,
 * or whether it is a state at all — so a wrong one is indistinguishable from a right one by inspection, and
 * `IssueCreateInput` will happily carry it to the provider. The only place a correct one comes from is the
 * team, live. This file is what turns "the caller read it from the team" from an assumption into a
 * CHECKABLE fact: the read verb writes here, the write gate reads here, and a `stateId` with no entry is
 * refused rather than sent.
 *
 * The trap it closes is specific and measured. Before the read verb existed the only visible source of a
 * state id was `corpus/history/linear.jsonl`, and the ingest redaction pass carves a UUID whose final group
 * holds nine or more consecutive digits into `…-956b-[number]efe` — under 0.1% of distinct ids in the real
 * store. A mangled id LOOKS like an id. Without this gate it reaches Linear, and a hand-repaired one reaches
 * a real workflow state nobody chose.
 *
 * ## What it is NOT
 *
 * It is not a cache the write path may fall back on for correctness of the state itself: a team can rename
 * or delete a state after this was written, and nothing here would know. It answers exactly one question —
 * *did this id come out of a real read of this team?* — and that is a question a stale file can still answer
 * honestly, because a state id Linear once issued was never a mangled one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { isRecord } from "../../lib/parsers.js";
import { stateHomePaths } from "../../stateHome.js";

/** One state, as the catalog stores it. Position is deliberately dropped — the gate never orders these. */
interface CatalogState {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

/** One assignable member, as the catalog stores it. */
interface CatalogMember {
  readonly id: string;
  readonly displayName: string;
}

/** Everything one `linear states` read established about one team, as persisted. */
export interface StateCatalog {
  readonly teamId: string;
  readonly teamKey: string;
  readonly readAtIso: string;
  readonly states: readonly CatalogState[];
  readonly members: readonly CatalogMember[];
  /**
   * The URL key of the Linear workspace the read reached, as Linear itself reported it; absent on a catalog recorded
   * before the stamp existed. The PR gate forgives this team's key only while the organisation names the same
   * workspace, so a catalog from another workspace's token, or one an earlier installation left in a reused home,
   * grants nothing.
   */
  readonly workspace?: string;
}

/** The directory holding one catalog per team the read verb has visited. */
function catalogDir({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).ledgers, "linear-states");
}

/**
 * The catalog file for one team.
 *
 * Keyed on the team UUID rather than its key, because the UUID is what the issue form carries and what the
 * gate has in hand — and because a team key can be renamed while its id cannot, so a key-named file would
 * silently become a second catalog for the same team.
 *
 * @param home the state home the ledger lives under
 * @param teamId the team's UUID
 * @returns the absolute path to that team's catalog
 */
export function stateCatalogPath({ home, teamId }: { home: string; teamId: string }): string {
  return join(catalogDir({ home }), `${teamId}.json`);
}

/** The persisted `states` array, dropping any entry that is not shaped like a state. Pure. */
function parseStates({ value }: { value: unknown }): readonly CatalogState[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"].length === 0) {
      return [];
    }
    const name = entry["name"];
    const type = entry["type"];
    return [
      {
        id: entry["id"],
        name: typeof name === "string" ? name : entry["id"],
        // The empty string rather than a default category: `type` is the one field a caller branches on, and
        // inventing a plausible-looking category for an entry that carried none would be worse than none.
        type: typeof type === "string" ? type : "",
      },
    ];
  });
}

/** The persisted `members` array, dropping any entry that is not shaped like a member. Pure. */
function parseMembers({ value }: { value: unknown }): readonly CatalogMember[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry: unknown) => {
    if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"].length === 0) {
      return [];
    }
    const displayName = entry["displayName"];
    return [{ displayName: typeof displayName === "string" ? displayName : entry["id"], id: entry["id"] }];
  });
}

/**
 * Parse a persisted catalog.
 *
 * Returns `undefined` for anything it cannot read, and the callers treat that as ABSENT rather than as
 * empty: an unreadable catalog must refuse a write the same way a missing one does, never wave it through
 * on a zero-length state list.
 *
 * @param raw the persisted JSON
 * @returns the catalog, or undefined when it is absent or unreadable
 */
export function parseStateCatalog({ raw }: { raw: string }): StateCatalog | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed["teamId"] !== "string" || typeof parsed["readAtIso"] !== "string") {
      return undefined;
    }
    const teamKey = parsed["teamKey"];
    const workspace = parsed["workspace"];
    return {
      members: parseMembers({ value: parsed["members"] }),
      readAtIso: parsed["readAtIso"],
      states: parseStates({ value: parsed["states"] }),
      teamId: parsed["teamId"],
      teamKey: typeof teamKey === "string" ? teamKey : parsed["teamId"],
      ...(typeof workspace === "string" ? { workspace } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read one team's catalog.
 *
 * @param home the state home
 * @param teamId the destination team's UUID
 * @returns the catalog, or undefined when this team has never been read
 */
export function readStateCatalog({ home, teamId }: { home: string; teamId: string }): StateCatalog | undefined {
  try {
    return parseStateCatalog({ raw: readFileSync(stateCatalogPath({ home, teamId }), "utf8") });
  } catch {
    return undefined;
  }
}

/**
 * The team key of every team a live `linear states` read has recorded under this home, with the workspace the
 * organisation named when it was recorded. A catalog that recorded no key of its own (its `teamKey` fell back to
 * the team id) names none. Whether a key is the install's own is the caller's judgement against that workspace.
 *
 * @param home the state home
 * @returns the keys and their recorded workspaces, in directory order; none when no team has been read
 */
export function stateCatalogTeams({
  home,
}: {
  home: string;
}): readonly { readonly teamKey: string; readonly workspace: string | undefined }[] {
  let names: readonly string[];
  try {
    names = readdirSync(catalogDir({ home }));
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!name.endsWith(".json")) {
      return [];
    }
    const catalog = readStateCatalog({ home, teamId: name.slice(0, -".json".length) });
    if (catalog === undefined || catalog.teamKey === catalog.teamId) {
      return [];
    }
    return [{ teamKey: catalog.teamKey, workspace: catalog.workspace }];
  });
}

/**
 * Record what a live read established, replacing whatever was there.
 *
 * REPLACE rather than merge, deliberately: a state deleted on the team must disappear here, and merging
 * would make this file a permanent superset of everything the team has ever had — which is precisely the
 * stale-id source the gate exists to remove.
 *
 * @param home the state home
 * @param catalog what the read verb saw
 */
export function writeStateCatalog({ home, catalog }: { home: string; catalog: StateCatalog }): void {
  writeFileAtomic({
    contents: `${JSON.stringify(catalog, undefined, 2)}\n`,
    path: stateCatalogPath({ home, teamId: catalog.teamId }),
  });
}

/**
 * The command an operator must run to make a refusal actionable, named with the team it applies to. With no
 * catalog there is no team key on record, so the command prints the flag's own placeholder for the operator to fill.
 */
function readVerbHint({ teamKey }: { teamKey: string | undefined }): string {
  if (teamKey === undefined) {
    return "slopweaver linear states --team <team-key>";
  }
  return `slopweaver linear states --team ${teamKey}`;
}

/**
 * Refuse a `stateId` the read verb has never seen for this team.
 *
 * Fails CLOSED on an absent catalog, and that is the whole design rather than caution: with no catalog there
 * is no evidence the id came from a real read, and the only OTHER place one can be copied from is bronze,
 * where a fraction of them are mangled. "We could not check" and "it is fine" are different answers.
 *
 * @param stateId the id the form asks to write, or undefined when it sets none
 * @param teamId the destination team, named in the refusal so the operator knows which team to read
 * @param teamKey the team's human key when it is known, so the suggested command is copy-pasteable
 * @param catalog the recorded read for that team, or undefined when there has never been one
 * @returns one refusal line, or empty when the id may be written
 */
export function stateIdRefusals({
  stateId,
  teamId,
  teamKey,
  catalog,
}: {
  stateId: string | undefined;
  teamId: string;
  teamKey: string | undefined;
  catalog: StateCatalog | undefined;
}): readonly string[] {
  if (stateId === undefined) {
    return [];
  }
  if (catalog === undefined) {
    return [
      `stateId ${stateId} cannot be written: nothing has read team ${teamId}'s workflow states, so there is ` +
        "no evidence this id came from the team rather than from bronze — where a UUID whose last group is " +
        `nine or more digits is stored mangled. Run \`${readVerbHint({ teamKey })}\` and use an id it prints.`,
    ];
  }
  if (catalog.states.some((state) => state.id === stateId)) {
    return [];
  }
  return [
    `stateId ${stateId} is not one of the ${String(catalog.states.length)} workflow states read from team ` +
      `${catalog.teamKey} at ${catalog.readAtIso}. Slopweaver writes only a state id it has seen from the ` +
      `provider. Re-run \`${readVerbHint({ teamKey: catalog.teamKey })}\` — the state may have been added ` +
      "since, or the id may be a mangled copy out of the corpus.",
  ];
}

/**
 * Refuse an assignee the destination team cannot actually take.
 *
 * Unlike {@link stateIdRefusals} this does NOT fail closed on an absent catalog, and the asymmetry is
 * deliberate: an assignee id is resolved from the confirmed identity roster, which is itself a real source,
 * whereas a state id has no source but this one. So the catalog adds a check here when it exists and demands
 * nothing when it does not.
 *
 * @param assigneeId the resolved Linear user id, or undefined when the form assigns nobody
 * @param catalog the recorded read for the destination team, or undefined when there has never been one
 * @returns one refusal line, or empty when the assignee may be written
 */
export function assigneeMembershipRefusals({
  assigneeId,
  catalog,
}: {
  assigneeId: string | undefined;
  catalog: StateCatalog | undefined;
}): readonly string[] {
  if (assigneeId === undefined || catalog === undefined || catalog.members.length === 0) {
    return [];
  }
  if (catalog.members.some((member) => member.id === assigneeId)) {
    return [];
  }
  return [
    `assignee ${assigneeId} is not among the ${String(catalog.members.length)} members read from team ` +
      `${catalog.teamKey} at ${catalog.readAtIso}, so this issue would be assigned to someone who cannot ` +
      `pick it up. Re-run \`${readVerbHint({ teamKey: catalog.teamKey })}\` if they have joined since.`,
  ];
}
