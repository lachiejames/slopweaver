/**
 * `slopweaver identity resolve` — answer "who is this?" off the MEMBER index, escalating to {@link
 * ./identityShow}'s corpus resolution only when the caller opts in.
 *
 * Depth 2: it imports {@link ./identityShow} because an exact hit is reported as a person, and it exports
 * {@link emitLookup} because {@link ./identityNarrow} reports the key its sub-agent picked through the same
 * lookup vocabulary.
 */

import { groupLookupLines, lookupGroup } from "../../../silver/groupMention.js";
import { lookupMentionWithHeardAs, type RoutedMentionLookup, routedLookupRefusals } from "../../../silver/heardAs.js";
import type { IdentityRecord } from "../../../silver/identity.js";
import { lookupMention, type MentionPerson, mentionPeople } from "../../../silver/mentionResolver.js";
import { type NearMatch, nearMentions } from "../../../silver/nearMention.js";
import { resolvePersonForRaw } from "../../../silver/personLookup.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { mentionMatchToJson, nearMatchToJson, renderMentionMatch, renderNoExactMatch } from "./core.js";
import { homeFor, type IdentityDeps, strFlag, verbTail } from "./identityShared.js";
import { emitPerson, resolveFor } from "./identityShow.js";

const RESOLVE_USAGE =
  "usage: slopweaver identity resolve <name|handle|email|id> [--corpus-scan] [--home <dir>] [--corpus <dir>] [--json]";

/**
 * Answer a GROUP token, when the token names one.
 *
 * @param deps the injected edges
 * @param home the store to read the groups out of
 * @param raw the token as the caller wrote it, echoed in the JSON form
 * @param json whether to emit the machine-readable document instead
 * @returns `true` when a group was named and printed, so the caller stops
 */
function emitGroupIfNamed({
  deps,
  home,
  raw,
  json,
}: {
  deps: IdentityDeps;
  home: string;
  raw: string;
  json: boolean;
}): boolean {
  const lines = groupLookupLines({
    lookup: lookupGroup({ groups: deps.loadGroups({ home }), token: raw }),
    token: raw,
  });
  if (lines.length === 0) {
    return false;
  }
  if (json) {
    deps.logger.out({ line: JSON.stringify({ lines, raw }, null, 2) });
    return true;
  }
  for (const line of lines) {
    deps.logger.out({ line });
  }
  return true;
}

/** Emit the no-exact-match answer — the near pass's result and the wording {@link renderNoExactMatch} owns. */
function emitNoExactMatch({
  deps,
  near,
  raw,
  json,
  corpusScanned,
}: {
  deps: IdentityDeps;
  near: readonly NearMatch[];
  raw: string;
  json: boolean;
  corpusScanned: boolean;
}): void {
  if (json) {
    deps.logger.out({
      line: JSON.stringify(
        {
          corpusScanned,
          near: near.map((match) => nearMatchToJson({ near: match })),
          raw,
          reason: "no-exact-match",
        },
        null,
        2,
      ),
    });
    return;
  }
  renderNoExactMatch({ corpusScanned, near, token: raw }).forEach((line) => {
    deps.logger.out({ line });
  });
}

/**
 * Emit what the MEMBER index concluded. A refusal prints its own reason and exits non-zero; only a
 * `resolved` (or a colleague with no Slack account, which is still an identification) exits `EXIT_OK`.
 * An answer reached through a heard-as pin says so, in both forms, so nobody mistakes the pin for the
 * person carrying the token.
 *
 * @returns the process exit code
 */
export function emitLookup({
  deps,
  lookup,
  raw,
  json,
}: {
  deps: IdentityDeps;
  lookup: RoutedMentionLookup;
  raw: string;
  json: boolean;
}): number {
  const pin = lookup.heardAsTarget;
  if (lookup.kind === "resolved" || lookup.kind === "no-account") {
    if (json) {
      const match = mentionMatchToJson({ match: lookup.match });
      deps.logger.out({ line: JSON.stringify(pin === undefined ? match : { ...match, heardAs: pin }, null, 2) });
    } else {
      renderMentionMatch({ match: lookup.match }).forEach((line) => {
        deps.logger.out({ line });
      });
      if (pin !== undefined) {
        deps.logger.out({
          line: `  heard-as: ${JSON.stringify(raw)} is pinned to ${pin} in the identity roster (slopweaver identity roster replace)`,
        });
      }
    }
    return EXIT_OK;
  }
  const refusals = routedLookupRefusals({ key: raw, lookup, source: "slack" });
  if (json) {
    deps.logger.out({ line: JSON.stringify({ raw, reason: lookup.kind, refusals }, null, 2) });
  } else {
    refusals.forEach((line) => {
      deps.logger.error({ msg: line });
    });
  }
  return EXIT_ERROR;
}

/**
 * What `resolve` does once the member index's EXACT ladder has answered nothing: ask whether the token names
 * a group, follow a heard-as pin the human roster declares, run the near pass, and — only when asked — pay
 * for the whole-corpus walk.
 *
 * @param corpus the `--corpus` override, when one was given
 * @param corpusScan whether `--corpus-scan` was given
 * @returns the process exit code
 */
async function emitExactMiss({
  deps,
  home,
  raw,
  json,
  people,
  corpus,
  corpusScan,
}: {
  deps: IdentityDeps;
  home: string;
  raw: string;
  json: boolean;
  people: readonly MentionPerson[];
  corpus: string | undefined;
  corpusScan: boolean;
}): Promise<number> {
  // The member index holds PEOPLE and has never held a usergroup, so before reporting an absence, ask
  // whether the token names a GROUP. MEASURED: dozens of usergroups sat in a real workspace's structure
  // bronze and every one of them read here as "no colleague answers to it" — the same answer a colleague
  // who does not exist gets. Nothing was missing from the store; nothing READ it.
  if (emitGroupIfNamed({ deps, home, json, raw })) {
    return EXIT_OK;
  }
  // A heard-as pin after the group, so a declared pronunciation never shadows a real usergroup handle, and
  // before the near pass, because `Smitty` is two edits from `smith` and the near pass rightly finds nobody.
  // A name the owner has said stands for a given person resolves to that person (`../../../silver/heardAs.ts`). The store
  // roster is read only past the group check; an outage is a refusal, never an answer from an empty roster.
  const roster = await deps.loadRoster({ home });
  if (roster.isErr()) {
    deps.logger.error({ msg: roster.error.message });
    return EXIT_ERROR;
  }
  const pinned = lookupMentionWithHeardAs({ people, records: roster.value, source: "slack", token: raw });
  if (pinned.heardAsTarget !== undefined || pinned.heardAsUnaddressable !== undefined) {
    return emitLookup({ deps, json, lookup: pinned, raw });
  }
  // The NEAR pass, before any sentence about absence is printed. MEASURED: this verb told a
  // session that "Tobyn Barten" was "a real absence, not a stale roster" while the member index held Tobin
  // Barton across three sources, and the session correctly concluded the person was not in the corpus and
  // stopped. See {@link ../../../silver/nearMention} for the budget, and for why a near match may never be
  // promoted to a resolution.
  const near = nearMentions({ people, token: raw });
  if (!corpusScan) {
    emitNoExactMatch({ corpusScanned: false, deps, json, near, raw });
    return EXIT_EXPECTED_EMPTY;
  }
  return emitCorpusScan({ corpus, deps, home, json, near, overrides: roster.value, raw });
}

/**
 * The paid half of `resolve --corpus-scan`: the whole-corpus walk, whose protect-list refusal is an error, never a
 * miss.
 *
 * @param corpus the `--corpus` override, when one was given
 * @param overrides the store roster's confirmed people, read once by the caller
 * @param near the near pass's matches, reported again when the walk also finds nobody
 * @returns the process exit code
 */
function emitCorpusScan({
  corpus,
  deps,
  home,
  json,
  near,
  overrides,
  raw,
}: {
  corpus: string | undefined;
  deps: IdentityDeps;
  home: string;
  json: boolean;
  near: readonly NearMatch[];
  overrides: readonly IdentityRecord[];
  raw: string;
}): number {
  const resolution = resolveFor({ corpus, deps, home, overrides });
  if (resolution.isErr()) {
    deps.logger.error({ msg: resolution.error });
    return EXIT_ERROR;
  }
  const resolved = resolvePersonForRaw({ raw, resolution: resolution.value });
  // A corpus scan that also found nobody answers in the SAME shape as the member-index miss, never
  // `emitPerson`'s bare `no canonical person`: a reader who paid for the walk is owed what was established.
  if (resolved.kind === "unknown") {
    emitNoExactMatch({ corpusScanned: true, deps, json, near, raw });
    return EXIT_EXPECTED_EMPTY;
  }
  return emitPerson({ deps, json, raw, resolved });
}

/**
 * Run `identity resolve <raw>` over injected dependencies — the testable shell. Exits `EXIT_EXPECTED_EMPTY`
 * (a deliberate signal, not a fault) when the token maps to no known person.
 *
 * @param argv the full process argv
 * @param deps the effectful seams
 * @returns the process exit code
 */
export async function runIdentityResolveWithDeps({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: IdentityDeps;
}): Promise<number> {
  const rest = verbTail({ argv, verb: "resolve" });
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.logger.out({ line: RESOLVE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlags({
    allowPositionals: true,
    args: rest,
    spec: { boolean: ["json", "corpus-scan"], string: ["corpus", "home"] },
  });
  if (parsed.isErr()) {
    parsed.error.forEach((e) => {
      deps.logger.error({ msg: e });
    });
    deps.logger.error({ msg: RESOLVE_USAGE });
    return EXIT_USAGE;
  }
  const raw = parsed.value.positionals[0];
  if (raw === undefined) {
    deps.logger.error({ msg: "resolve needs a name, handle, email or id" });
    deps.logger.error({ msg: RESOLVE_USAGE });
    return EXIT_USAGE;
  }
  const json = parsed.value.values["json"] === true;
  const home = homeFor({ deps, values: parsed.value.values });
  const directory = deps.loadDirectory({ home });
  directory.warnings.forEach((w) => {
    deps.logger.warn({ msg: w });
  });
  const people = mentionPeople({ orgDomains: directory.orgDomains, rows: directory.rows });
  const lookup = lookupMention({ people, source: "slack", token: raw });
  if (lookup.kind !== "unknown") {
    return emitLookup({ deps, json, lookup, raw });
  }
  return emitExactMiss({
    corpus: strFlag({ key: "corpus", values: parsed.value.values }),
    corpusScan: parsed.value.values["corpus-scan"] === true,
    deps,
    home,
    json,
    people,
    raw,
  });
}
