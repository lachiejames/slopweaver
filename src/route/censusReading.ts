/**
 * Which Datadog services a question names, read from the census MANIFEST alone. Pure.
 *
 * ## Why this is not `store detect`'s gate
 *
 * `src/datadog/detective/gate.ts` matches keywords a session CHOSE against every row, by containment in
 * both directions. Fed a raw question instead, that rule floods: MEASURED against the installed
 * census, the token `the` matched 2,026 row labels and `api` matched 18 services. `route plan` and
 * `turn brief` have no chosen keywords and run on every question, so this reader is deliberately narrower
 * and cheaper — service names only, from the ~100 KB manifest rather than the ~50 MB rows — and it names the
 * deeper match (`store detect`) as the next step instead of performing it.
 *
 * ## The matching rule
 *
 * A question token names a service when it is:
 *
 * - **the service's whole name** (`jobs-api`, `postgres`), unless the word is too common to be a name;
 * - **a hyphenated run of two or more of its own segments** (`sync-partners` inside
 *   `acme-nightly-job-sync-partners`).
 *
 * **One SEGMENT alone is deliberately NOT a match**, and that is the sharpest edge here: a review pass
 *   measured `support` naming
 *   `acme-nightly-job-sync-support-kb`, `rewrite` naming `acme-admin-e2e-rewrite`, `generic` naming
 *   `generic-di`, and `invoice`, `location`, `storage`, `contacts` and `knowledge` each naming exactly one
 *   job — so "who can I ask for support on this?" made Datadog a REQUIRED leg and demoted the corpus to
 *   optional. A denylist cannot enumerate English, which is what the segment rule needed it to do. A
 *   session that wants `airtable` or `hubspot` still has `store detect`, where the keyword was CHOSEN.
 *
 * Never containment either: `sso` sits inside `processor`, and a reader that matched it would send every
 * question about payment processing to Datadog.
 *
 * The one denylist that remains covers WHOLE-name matches, and its job is bounded rather than open-ended: it
 * has to cover only the census's own single-word service names, which this install prints with
 * `slopweaver datadog catalogue show --json | jq -r '.manifest.services[].service' | grep -v -- -`.
 */

import type { CatalogueManifest } from "../datadog/detective/catalogue.js";

/**
 * Words that are service names or segments on some estate and ordinary English in a question. Matching them
 * would route on the question's grammar rather than its subject.
 */
const COMMON_WORDS = new Set([
  "acme",
  "alerts",
  "backup",
  "change",
  "client",
  "create",
  "delete",
  "directory",
  "errors",
  "events",
  "fields",
  "public",
  "report",
  "requests",
  "script",
  "service",
  "software",
  "status",
  "systems",
  "update",
  "workflows",
]);

/**
 * The prefix every census match carries into a plan's `matched` list.
 *
 * Exported because `sourcePlan.ts` both writes it and, in `termMatchCount`, has to tell a census HINT from one
 * of the question's own words when it ranks the legs.
 */
export const CENSUS_MATCH_PREFIX = "census:service:";

/** One service a question named, and how much it emitted in the census window. */
export interface CensusServiceMatch {
  /** The question's own word that matched, lowercased. */
  readonly token: string;
  readonly service: string;
  /** Events summed across every product the service emitted in the census window. */
  readonly events: number;
}

/** What the census said about one question. */
export interface CensusReading {
  /** Every matched service, most-emitting first. */
  readonly matches: readonly CensusServiceMatch[];
}

/**
 * Split a question into lowercased tokens, keeping the characters a service slug is made of.
 *
 * @param question the question as asked
 * @returns the distinct tokens, in first-seen order
 */
function tokensOf({ question }: { question: string }): readonly string[] {
  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9._-]+/u)
    .map((token) => token.replaceAll(/^[.\-_]+|[.\-_]+$/gu, ""))
    .filter((token) => token.length > 0);
  return [...new Set(tokens)];
}

/**
 * The segments a slug is made of.
 *
 * @param slug a service name or a hyphenated token
 * @returns its segments, split on hyphen and underscore
 */
function segmentsOf({ slug }: { slug: string }): readonly string[] {
  return slug.split(/[-_]/u).filter((segment) => segment.length > 0);
}

/**
 * Whether `needle`'s segments appear contiguously, in order, inside `haystack`'s.
 *
 * @returns true for a contiguous run
 */
function containsRun({ haystack, needle }: { haystack: readonly string[]; needle: readonly string[] }): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    if (needle.every((segment, offset) => haystack[start + offset] === segment)) {
      return true;
    }
  }
  return false;
}

/**
 * Read which services a question names.
 *
 * @param manifest the census manifest — only its service volumes are read
 * @param question the question as asked
 * @returns the matched services, most-emitting first
 */
export function censusServiceMatches({
  manifest,
  question,
}: {
  manifest: Pick<CatalogueManifest, "services">;
  question: string;
}): CensusReading {
  const totals = new Map<string, number>();
  for (const volume of manifest.services) {
    const seen = totals.get(volume.service);
    totals.set(volume.service, seen === undefined ? volume.events : seen + volume.events);
  }
  const services = [...totals.keys()];
  const matches: CensusServiceMatch[] = [];
  for (const token of tokensOf({ question })) {
    for (const service of servicesNamedBy({ services, token })) {
      matches.push({ events: totals.get(service)!, service, token });
    }
  }
  const unique = new Map(matches.map((match) => [match.service, match]));
  return {
    matches: [...unique.values()].toSorted(
      (left, right) => right.events - left.events || left.service.localeCompare(right.service),
    ),
  };
}

/**
 * The services one token names under the module's matching rule.
 *
 * @param services every service name the census holds
 * @param token one lowercased question token
 * @returns the named services, empty when the token names none
 */
function servicesNamedBy({ services, token }: { services: readonly string[]; token: string }): readonly string[] {
  if (COMMON_WORDS.has(token)) {
    return [];
  }
  const exact = services.filter((service) => service.toLowerCase() === token);
  if (exact.length > 0) {
    return exact;
  }
  const tokenSegments = segmentsOf({ slug: token });
  if (tokenSegments.length < 2) {
    // One segment on its own is ordinary English as often as it is a name — the header carries the measured
    // list — so it is not a match here at all, and `store detect` is where a CHOSEN keyword goes deeper.
    return [];
  }
  return services.filter((service) =>
    containsRun({ haystack: segmentsOf({ slug: service.toLowerCase() }), needle: tokenSegments }),
  );
}

/**
 * The block a turn brief prints about the census, or nothing when the question named no service.
 *
 * A miss prints nothing on purpose: this reader only knows service names, so a question about a log pattern
 * or an error code misses here and is `store detect`'s to find. The age line rides every hit, because a hit
 * on a stale census is still a hit on an old picture.
 *
 * @param reading what {@link censusServiceMatches} found
 * @param ageLine the census's age, from `src/datadog/detective/censusAge.ts`
 * @returns the lines to print
 */
export function censusBriefLines({ reading, ageLine }: { reading: CensusReading; ageLine: string }): readonly string[] {
  if (reading.matches.length === 0) {
    return [];
  }
  const shown = reading.matches.slice(0, 5);
  const first = shown[0]!;
  return [
    "DATADOG CENSUS — this question names services the telemetry estate holds; what HAPPENED is a read away:",
    ...shown.map(
      (match) =>
        `  - ${match.service} (from "${match.token}") — ${match.events.toLocaleString("en-US")} event(s) in the census window`,
    ),
    ...(reading.matches.length > shown.length
      ? [`  - and ${String(reading.matches.length - shown.length)} more service(s)`]
      : []),
    `  ${ageLine}`,
    `  next: slopweaver datadog logs 'service:${first.service} status:error' --from 24h --by __dd.log_identity.raw_msg_fingerprint`,
    `        slopweaver store detect "<the question>" --term ${first.service} [--term <pattern or code>]  — fans Datadog detectives out`,
  ];
}

/**
 * Whether a capability row's command runs a Datadog verb — `slopweaver datadog …` or `slopweaver atlas
 * datadog …` — read from the argv, so no id convention decides it.
 *
 * Read off the MATERIALISED command, which has one consequence worth stating: a Datadog row graded
 * unavailable has had its command CLEARED (`./atlasReading.ts`, `./commandReading.ts`), so it matches nothing
 * here and the census hint is inert wherever Datadog is unreachable. That is the right direction, because a
 * hint pointing at a leg nobody can run is worse than none.
 *
 * On the GENERIC table the hint does land, and on two rows: `genericCapabilities.ts`'s own `telemetry` row
 * (`datadog verify`) and the `datadog-atlas` row `atlasCapability.ts` derives for every registered platform.
 * An earlier draft of this comment said the opposite — that the generic telemetry row ships unavailable, so a
 * census hint needed an install's own profile — which was true when written and stopped being true once every registered source became routable. Measure it rather than trust either
 * sentence: `route plan --question "<a census service name>" --json`, with `--profile` and without.
 *
 * @param command the row's command, launcher first
 * @returns true when the row reads Datadog
 */
export function commandRunsDatadog({ command }: { command: readonly string[] }): boolean {
  const [, first, second] = command;
  return first === "datadog" || (first === "atlas" && second === "datadog");
}
