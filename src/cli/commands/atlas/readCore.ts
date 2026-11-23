/**
 * Pure rendering for `slopweaver atlas read` — the `--json` document and the human report. Separated from the
 * shell so every line of output is unit-testable without a home directory. The flag surface and its parser
 * are `./readArgs.ts`'s.
 *
 * This verb is the answer to the one thing the atlases could not do: be READ. Thousands of Cloudflare
 * entities sat on disk reachable only by `jq`, which is not what `docs/atlas-intent/settled-decisions.md` means by _"turning it
 * into verbs so it's easy for the AI to call"_. Nothing here knows a platform's vocabulary — the registry
 * and its adapters own that — so a new atlas joins without this file changing.
 */

import { type AtlasQueryMatch, atlasEntityName, atlasQueryMatches } from "../../../atlas/kit/entityLabel.js";
import type { AtlasEntityView } from "../../../atlas/kit/read.js";
import type {
  AtlasReadAnswer,
  AtlasReadAnswerError,
  AtlasReadBoundary,
  AtlasReadKindBoundary,
} from "../../../atlas/kit/readAnswer.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import type { Result } from "../../../lib/result.js";

/**
 * One entity as the wire carries it — the normalized view, plus the two things a READER needs that no
 * adapter stores: what the provider calls it, and why a `--query` selected it.
 *
 * Additive on purpose, with no `schemaVersion` bump. The bump to 2 existed because a v1 consumer would
 * have read a refusal's `entities: []` as a measured zero; a v2 consumer that ignores two new fields
 * reads nothing false. `readRun.ts` is the only producer and this repo holds no consumer of the entity
 * objects, so the compatibility question is entirely about `jq` scripts outside it.
 * @internal
 */
export type AtlasReadEntityJson = AtlasEntityView & {
  /** What the provider's own payload calls this entity, or `null` when it names it nothing. */
  readonly name: string | null;
  /** One per `--query` token; absent as an empty array when no query was given. */
  readonly matchedOn: readonly AtlasQueryMatch[];
};

/**
 * The `--json` document, version 2 — a union discriminated by `outcome`.
 *
 * Version 1 promised a successful-empty shape (`entities: []`, `matched: 0`) for a selection this verb now
 * refuses, so the number is bumped rather than quietly reused: a consumer pinned to v1 should fail to parse
 * a v2 refusal rather than read its missing `entities` as none.
 *
 * The refusal arm carries no success-shaped field at all. An `entities: []` beside a `code` would be the
 * original defect re-entering through the wire format — a consumer reaching past the outcome and finding
 * exactly the empty array that means nothing.
 * @internal
 */
export type AtlasReadJson =
  | {
      readonly schemaVersion: 2;
      readonly outcome: "selection";
      readonly platform: string;
      readonly generation: AtlasReadAnswer["generation"];
      readonly boundary: AtlasReadBoundary;
      readonly page: {
        readonly matched: number;
        readonly truncated: boolean;
        readonly nextAfter: string | null;
      };
      readonly entities: readonly AtlasReadEntityJson[];
      /** Present only on the `--accept-unproven-empty` path: the refusal this answer was taken past. */
      readonly acceptedUnproven?: { readonly code: string; readonly message: string };
    }
  | {
      readonly schemaVersion: 2;
      readonly outcome: "refused";
      readonly platform: string;
      readonly code: AtlasReadAnswerError["code"];
      readonly message: string;
      readonly generation?: AtlasReadAnswer["generation"];
      readonly boundary?: AtlasReadBoundary;
    };

/**
 * One entity, ready for the wire.
 *
 * @param entity the normalized view
 * @param query the caller's `--query`, or `undefined` when they filtered on something else
 * @returns the view with its derived name and its query witness attached
 */
function entityJson({ entity, query }: { entity: AtlasEntityView; query: string | undefined }): AtlasReadEntityJson {
  if (query === undefined) {
    return { ...entity, matchedOn: [], name: atlasEntityName({ detail: entity.detail }) };
  }
  return {
    ...entity,
    matchedOn: atlasQueryMatches({ entity, query }),
    name: atlasEntityName({ detail: entity.detail }),
  };
}

/**
 * Build the `--json` document from the answer or the refusal.
 *
 * Takes the whole `Result` rather than an unwrapped page, which is the compiler-enforced half of this
 * verb's honesty: there is no shape a caller can hand this function that has already lost the boundary.
 *
 * @param result what the kit answered
 * @param acceptUnproven whether the caller opened the named escape hatch, which turns an
 *   `ATLAS_READ_EMPTY_UNPROVEN` refusal into an answer carrying the refusal it was taken past
 * @returns the document to print
 */
export function atlasReadJson({
  result,
  acceptUnproven,
}: {
  result: Result<AtlasReadAnswer, AtlasReadAnswerError>;
  acceptUnproven: boolean;
}): AtlasReadJson {
  if (result.isOk()) {
    const answer = result.value;
    return {
      boundary: answer.boundary,
      entities: answer.page.entities.map((entity) => entityJson({ entity, query: answer.boundary.selection.query })),
      generation: answer.generation,
      outcome: "selection",
      page: { matched: answer.page.matched, nextAfter: answer.page.nextAfter, truncated: answer.page.truncated },
      platform: answer.generation.platform,
      schemaVersion: 2,
    };
  }
  const error = result.error;
  if (acceptUnproven && error.code === "ATLAS_READ_EMPTY_UNPROVEN") {
    return {
      acceptedUnproven: { code: error.code, message: error.message },
      boundary: error.boundary,
      entities: [],
      generation: error.generation,
      outcome: "selection",
      page: { matched: 0, nextAfter: null, truncated: false },
      platform: error.platform,
      schemaVersion: 2,
    };
  }
  if (error.code === "ATLAS_READ_EMPTY_UNPROVEN") {
    return {
      boundary: error.boundary,
      code: error.code,
      generation: error.generation,
      message: error.message,
      outcome: "refused",
      platform: error.platform,
      schemaVersion: 2,
    };
  }
  return {
    code: error.code,
    message: error.message,
    outcome: "refused",
    platform: error.platform,
    schemaVersion: 2,
  };
}

/**
 * The two head lines that say WHICH entity this row is.
 *
 * The provider's own name leads when there is one, and the `providerId` it displaces moves onto the id
 * line rather than out of the output: an operation handle is still the reproduction path, it just is not
 * the thing a reader identifies a row by. With no name the pair is byte-for-byte what it always was, so
 * the ~16% of kinds whose provider offers no name lose nothing.
 *
 * @param entity the entity to identify
 * @param name its derived name, or `null` when the provider's payload carries none
 * @returns the two lines
 */
function renderEntityHead({ entity, name }: { entity: AtlasEntityView; name: string | null }): readonly string[] {
  if (name === null) {
    return [`${entity.kind}  ${entity.providerId}`, `  id ${entity.id}  ·  ${entity.scope}`];
  }
  return [`${entity.kind}  ${name}`, `  id ${entity.id}  ·  ${entity.scope}  ·  ${entity.providerId}`];
}

/**
 * One witness line per `--query` token — the field that carried it, and what that field says.
 *
 * @param match the token's first matching field, and how many others also carried it
 * @returns the line
 */
function renderQueryMatch({ match }: { match: AtlasQueryMatch }): string {
  if (match.alsoIn === 0) {
    return `  matched "${match.token}" at ${match.path} — ${match.excerpt}`;
  }
  return `  matched "${match.token}" at ${match.path} (+${String(match.alsoIn)} more) — ${match.excerpt}`;
}

/**
 * Render one entity as the human lines it deserves — its identity, why the query selected it, then one
 * line per surface that saw it.
 *
 * @param entity the entity to render
 * @param query the caller's `--query`, or `undefined` when they filtered on something else
 * @returns the lines, without a trailing blank
 */
function renderEntity({ entity, query }: { entity: AtlasEntityView; query: string | undefined }): readonly string[] {
  const lines = [...renderEntityHead({ entity, name: atlasEntityName({ detail: entity.detail }) })];
  if (query !== undefined) {
    lines.push(...atlasQueryMatches({ entity, query }).map((match) => renderQueryMatch({ match })));
  }
  lines.push(...entity.observations.map((observation) => renderObservation({ observation })));
  return lines;
}

/** One line per surface that saw an entity — its deep link, or why a surface that holds none has none. */
function renderObservation({ observation }: { observation: AtlasEntityView["observations"][number] }): string {
  const head = `  ${observation.surface}  ${observation.state}  ${observation.observedAt}  ${observation.endpoint}`;
  if (observation.deepLink === null) {
    return `${head}  (no link — ${observation.deepLinkStatus})`;
  }
  return `${head}  ${observation.deepLink}`;
}

/**
 * Say when a kind last synced successfully, naming the never-succeeded case rather than substituting for it.
 *
 * Written as a branch rather than a `??` because "never" is a DIFFERENT fact from an instant, not a
 * fallback for a missing one — a kind that has never acquired anything is the exact case this verb's
 * refusal exists for, and the `no-silent-fallback` gate is what keeps that distinction
 * visible at the line rather than at the operator.
 *
 * @param lastSuccessAt the instant the kind last synced successfully, or `null` if it never has
 * @returns the instant, or the word that names its absence
 */
function lastSuccessLabel({ lastSuccessAt }: { lastSuccessAt: string | null }): string {
  if (lastSuccessAt === null) {
    return "never";
  }
  return lastSuccessAt;
}

/**
 * The generation line both an answer and a refusal print, so the two cannot drift apart.
 *
 * @param generation the generation view being described
 * @returns the one line, naming an unpublished generation rather than substituting a date for it
 */
function renderGenerationLine({ generation }: { generation: AtlasReadAnswer["generation"] }): string {
  if (generation.updatedAt === null) {
    return `generation never published  ·  schema v${String(generation.schemaVersion)}`;
  }
  return `generation ${generation.updatedAt}  ·  schema v${String(generation.schemaVersion)}`;
}

/**
 * Render one kind's evidence boundary — what this atlas can and cannot say about it.
 *
 * @param kind the kind boundary to render
 * @returns the lines, one kind's worth
 */
function renderKindBoundary({ kind }: { kind: AtlasReadKindBoundary }): readonly string[] {
  const lines = [
    `  ${kind.kind}  ${kind.freshness.verdict}  last success ${lastSuccessLabel({ lastSuccessAt: kind.lastSuccessAt })}`,
  ];
  // The manifest's own latest-attempt flag, printed even though `unprovenReasons` judges the CELLS: a
  // Codex review pass found a kind whose last refresh failed rendering identically to one whose did not,
  // which is the same defect this verb exists to close, one level in. `freshness.notes` rides with it
  // because that is where "historical" says how old, and a bare verdict is a word without a measurement.
  if (kind.latestAttemptFailed) {
    lines.push("    LATEST ATTEMPT FAILED  the stored records may be short of what the provider holds");
  }
  for (const note of kind.freshness.notes) {
    lines.push(`    ${note}`);
  }
  for (const cell of kind.coverage) {
    const failed = cell.latestAttemptFailed ? "  (latest attempt failed)" : "";
    lines.push(`    ${cell.surface}  ${cell.state}  ${cell.reason}${failed}`);
  }
  if (kind.permissionBlocked !== null) {
    lines.push(`    PERMISSION BLOCKED  ${kind.permissionBlocked.detail}  (${kind.permissionBlocked.unblockedBy})`);
  }
  for (const gap of kind.gaps.filter((candidate) => candidate.status === "open")) {
    lines.push(`    OPEN GAP  ${gap.condition}`);
  }
  for (const reason of kind.emptyIsUnproven) {
    lines.push(`    A ZERO HERE WOULD PROVE NOTHING  ${reason}`);
  }
  // Printed LAST, and phrased about what the records are rather than about what a zero would be: this is
  // the one line here that fires when the kind DID return something, so a reader who has already decided
  // the answer is non-empty has to meet it after the counts rather than before them.
  if (kind.estateNotEstablished !== null) {
    lines.push(`    NOT ANSWERABLE ABOUT THE ESTATE  ${kind.estateNotEstablished}`);
  }
  return lines;
}

/**
 * Render the claim boundary every answer is made under.
 *
 * @param boundary the answer's boundary
 * @returns the lines a reader must see before quoting any count
 */
function renderBoundary({ boundary }: { boundary: AtlasReadBoundary }): readonly string[] {
  const lines = [
    "claim boundary — counts are of STORED records, never the provider's own population;",
    "  a full page does not establish provider completeness; an absent field inside an entity's",
    "  detail is not evidence that the setting is off, unset or absent at the provider.",
  ];
  for (const exclusion of boundary.withheldBy) {
    lines.push(`  WITHHELD (${exclusion.ground})  ${exclusion.because}`);
  }
  if (boundary.boundedByCount > 0) {
    lines.push(
      `  ${String(boundary.boundedByCount)} further declared exclusion(s) bound what this atlas does without` +
        " withholding a record — see `atlas <platform> coverage`",
    );
  }
  for (const kind of boundary.kinds) {
    lines.push(...renderKindBoundary({ kind }));
  }
  return lines;
}

/**
 * Render the generation's own disagreements with its manifest.
 *
 * @param generation the generation view
 * @returns one line per non-empty anomaly array
 */
function renderGenerationAnomalies({ generation }: { generation: AtlasReadAnswer["generation"] }): readonly string[] {
  const lines: string[] = [];
  if (generation.missing.length > 0) {
    lines.push(`MISSING (the manifest vouches for these and the files are gone): ${generation.missing.join(", ")}`);
  }
  if (generation.superseded.length > 0) {
    lines.push(`SUPERSEDED (on disk under the pre-\`.jsonl\` name): ${generation.superseded.join(", ")}`);
  }
  if (generation.mismatched.length > 0) {
    lines.push(`MISMATCHED (file is not the generation the manifest published): ${generation.mismatched.join(", ")}`);
  }
  if (generation.unpublished.length > 0) {
    lines.push(`UNPUBLISHED (a file the manifest does not vouch for): ${generation.unpublished.join(", ")}`);
  }
  return lines;
}

/**
 * Render one answer — the page, and the boundary it was selected under.
 *
 * @param answer the qualified answer
 * @returns every line to print
 */
function renderAnswer({ answer }: { answer: AtlasReadAnswer }): readonly string[] {
  const { generation, page } = answer;
  const noun = page.matched === 1 ? "entity" : "entities";
  const lines = [
    `${generation.platform} atlas — ${String(page.matched)} matching STORED ${noun}`,
    renderGenerationLine({ generation }),
    ...renderGenerationAnomalies({ generation }),
    "",
    ...renderBoundary({ boundary: answer.boundary }),
    "",
  ];
  if (page.entities.length === 0) {
    lines.push("no stored entity matched these filters; this does not establish that the provider holds none");
    return lines;
  }
  for (const entity of page.entities) {
    lines.push(...renderEntity({ entity, query: answer.boundary.selection.query }), "");
  }
  if (page.truncated && page.nextAfter !== null) {
    lines.push(
      `showing ${String(page.entities.length)} of ${String(page.matched)} — continue with --after ${page.nextAfter}`,
    );
  }
  return lines;
}

/**
 * Render the whole human report — the answer, or the refusal that says which evidence is missing.
 *
 * A refusal prints the same boundary the answer would have, then the four-line escape-hatch refusal the
 * register owns. Printing less than the answer would have is how a refusal becomes a thing readers route
 * around rather than act on.
 *
 * @param result what the kit answered
 * @param acceptUnproven whether the caller opened the named escape hatch
 * @returns every line to print
 */
export function renderAtlasRead({
  result,
  acceptUnproven,
}: {
  result: Result<AtlasReadAnswer, AtlasReadAnswerError>;
  acceptUnproven: boolean;
}): readonly string[] {
  if (result.isOk()) {
    return renderAnswer({ answer: result.value });
  }
  const error = result.error;
  if (error.code !== "ATLAS_READ_EMPTY_UNPROVEN") {
    return [error.message];
  }
  const head = [
    `${error.platform} atlas — 0 matching STORED entities`,
    renderGenerationLine({ generation: error.generation }),
    ...renderGenerationAnomalies({ generation: error.generation }),
    "",
    ...renderBoundary({ boundary: error.boundary }),
    "",
  ];
  if (acceptUnproven) {
    return [...head, `ANSWERED UNPROVEN under --accept-unproven-empty: ${error.message}`];
  }
  return [
    ...head,
    ...hatchRefusalLines({ detail: error.message, hatch: hatchFor({ id: "atlas-read-unproven-empty" }) }),
  ];
}
