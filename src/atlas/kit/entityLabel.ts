/**
 * What a row of `slopweaver atlas <platform> read` calls itself, and why a `--query` selected it.
 *
 * ## The defect this closes
 *
 * A read row used to render as an operation plus an opaque id and nothing else:
 *
 * ```text
 * policies  v2-policies-get:/api/v2/policies/<policy-id>#<policy-id>
 *   id <entity-id>  ·  jumpcloud
 * ```
 *
 * That row is `macOS - Example Wi-Fi Configuration`, and it matched
 * `--query password` on a tooltip buried eight levels inside the policy template. A reader could tell
 * neither fact, so every row that DID answer "where is a password rule already enforced" read as an
 * indistinguishable id and the answer reported the atlas as unreachable instead (failure-matrix cell 5).
 *
 * ## Why the name is DERIVED here rather than declared by each adapter
 *
 * `read.ts`'s contract is that "adding an atlas is one adapter plus one registry row". Thirty-seven
 * adapters exist and four build their `AtlasEntityView` as a literal, so a required `name` field would be
 * thirty-seven edits to fix a rendering defect, and four independent guesses at which key to use. Deriving
 * it from the provider's own payload fixes every atlas at once and leaves the adapter contract alone.
 *
 * The bound that buys, stated rather than discovered: this reads the TOP LEVEL of `detail` only.
 * Measured over every kind file under `$SLOPWEAVER_HOME/atlas/` (the tally command is on
 * {@link ATLAS_NAME_KEYS}), a kind file carrying one of those keys there is the common case. It is safe because of a fact about the adapters rather than a guarantee:
 * thirty-three use `firstChannelDetail` and cloudflare unwraps `entity.detail`, so their `detail` IS the
 * provider payload — while `aether`, `crowdstrike` and `github` put the WHOLE stored entity
 * there and survive only because those entities are flat and carry `title` at the top. An adapter that
 * puts a nested payload in `detail` will silently lose its name, and nothing will fail; give it an
 * unwrapping adapter rather than teaching this module to guess a wrapper key. The one nested shape
 * actually in the tree is jumpcloud's `policyresults`, whose inner `detail` is command stdout — promoting
 * that to a headline would be worse than the opaque id it replaced.
 *
 * ## Why the filter and the witness are one walk
 *
 * `selectEntities` tests every entity in the selected kinds before it pages — every row a whole
 * jumpcloud generation holds. So the walk below visits leaves through a callback holding a MUTABLE segment stack and
 * allocates no path string at all; the predicate ignores the stack and stops the moment every token is
 * accounted for, and only {@link atlasQueryMatches} — which runs over the ≤1000 rows of one page — ever
 * renders a path. One walk, so the rows a query selects and the witness shown for them cannot drift.
 * Reproduce the cost: `time slopweaver atlas jumpcloud read --kind policies --query password --limit 1`.
 */
import { isRecord } from "../../lib/parsers.js";

import type { AtlasEntityView } from "./read.js";

/**
 * The keys a provider's own payload names an entity with, in the order they win.
 *
 * Measured over every kind file this install holds — reproduce the tally with
 * `for f in ~/.slopweaver/atlas/*<!---->/*.jsonl; do sed -n 2p "$f" | jq -c 'keys'; done`. First key
 * chosen, by kind file, most often first: `name`, `summary`, `description`, `title`, `synopsis`,
 * `displayName`, then the rest. `description` sits last because it is prose — on
 * `google-admin`, `linear` and `slack` it is the only human handle there is, which is why it is here at
 * all, and {@link ATLAS_NAME_MAX_CHARS} is what keeps it from becoming a paragraph in a headline.
 *
 * There is deliberately no `method` + `path` composite for the kind files that land nothing. A composite is a
 * label this code CONSTRUCTS rather than the entity's own name, and every atlas in that residue is
 * operation-shaped, so its `providerId` already carries the operation verbatim.
 */
export const ATLAS_NAME_KEYS: readonly string[] = [
  "name",
  "displayName",
  "title",
  "documentTitle",
  "summary",
  "synopsis",
  "label",
  "operationName",
  "operationId",
  "fullName",
  "primaryEmail",
  "email",
  "slug",
  "description",
];

/** How long a derived name may be before it is cut. A headline, not a paragraph — see rule 7. */
export const ATLAS_NAME_MAX_CHARS = 100;

/** How much of a matched field's own text a witness line shows, centred on the hit. */
export const ATLAS_EXCERPT_MAX_CHARS = 90;

/** How many characters of lead-in a witness excerpt keeps before the token it is evidence for. */
const EXCERPT_LEAD_CHARS = 24;

/**
 * How wide a rendered field address may be before its head is elided.
 *
 * {@link ATLAS_QUERY_DEPTH_LIMIT} bounds how MANY segments a path has and says nothing about how wide one
 * is, and every segment past the first is a key the provider chose — so without this the witness line is
 * the one thing the render emits whose length comes from the data. Measured over every stored entity of
 * every readable atlas on this install: the longest path rendered (its widest key an opaque token used as
 * a map key) ran wider than {@link ATLAS_EXCERPT_MAX_CHARS}, so the field this file already capped was
 * the narrower of the two, and this cap clears the widest path that measurement found. Re-measure with
 * `slopweaver atlas <platform> read --query <token> --limit 1000 --json | jq -r '[.entities[].matchedOn[].path|length]|max'`.
 *
 * The cut takes the HEAD rather than the tail: a leaf key is what tells a reader which field answered,
 * and the containers above it are the part a long path is long because of.
 */
export const ATLAS_PATH_MAX_CHARS = 96;

/**
 * How deep the plain-text query walks a provider's `detail`.
 *
 * Bounded rather than unbounded because `detail` is arbitrary provider JSON: an unbounded walk over a
 * cyclic or pathologically deep value would hang the one verb that is meant to answer quickly. Twelve is
 * past the deepest shape any atlas here stores — measure the current deepest with
 * `jq '[paths|length]|max' ~/.slopweaver/atlas/cloudflare/worker-script.json`.
 */
export const ATLAS_QUERY_DEPTH_LIMIT = 12;

/** One string field of an entity, as the query sees it, with the path a reader can go and check. */
interface AtlasQueryField {
  /** The field's address, e.g. `providerId` or `detail.template.configFields[7].label`. */
  readonly path: string;
  /** The field's own text, in the provider's own case. */
  readonly value: string;
}

/** Why one token of a `--query` selected this entity. One per token, never per matching field. */
export interface AtlasQueryMatch {
  /** The lowercased token from the caller's `--query`. */
  readonly token: string;
  /** The matched field's address, head-elided to {@link ATLAS_PATH_MAX_CHARS}. */
  readonly path: string;
  /** The matched field's text around the hit, cut to {@link ATLAS_EXCERPT_MAX_CHARS}. */
  readonly excerpt: string;
  /** How many FURTHER fields of this entity also carried the token. */
  readonly alsoIn: number;
}

/**
 * Cut a string to a budget, saying it was cut.
 *
 * @param text the string to bound
 * @param max the budget, including the ellipsis
 * @returns the string, or its first `max - 1` characters with an ellipsis
 */
function cutTo({ text, max }: { text: string; max: number }): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

/**
 * The name a provider's own payload gives this entity.
 *
 * Returns `null` rather than substituting an id when the payload names it nothing: "this provider offers
 * no name for this record" and "this record is called X" are different facts, and the caller renders them
 * differently. See this module's header for the top-level-only bound.
 *
 * @param detail the entity view's `detail` — whatever shape that platform stores
 * @returns the name, cut to {@link ATLAS_NAME_MAX_CHARS}, or `null` when the payload carries none
 */
export function atlasEntityName({ detail }: { detail: unknown }): string | null {
  if (!isRecord(detail)) {
    return null;
  }
  for (const key of ATLAS_NAME_KEYS) {
    const value = detail[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return cutTo({ max: ATLAS_NAME_MAX_CHARS, text: trimmed });
      }
    }
  }
  return null;
}

/**
 * Render a segment stack as an address a reader can check.
 *
 * Array indices are already bracketed by the walker, so they attach to the name before them rather than
 * taking a dot of their own: `detail.configFields[7].label`, never `detail.configFields.[7].label`.
 *
 * @param segments the stack, outermost first
 * @returns the dotted path, head-elided to {@link ATLAS_PATH_MAX_CHARS}
 */
function renderPath({ segments }: { segments: readonly string[] }): string {
  let path = "";
  for (const segment of segments) {
    if (path.length === 0 || segment.startsWith("[")) {
      path += segment;
    } else {
      path += `.${segment}`;
    }
  }
  if (path.length <= ATLAS_PATH_MAX_CHARS) {
    return path;
  }
  return `…${path.slice(path.length - (ATLAS_PATH_MAX_CHARS - 1))}`;
}

/**
 * A container's children as `[segment, value]` pairs, or `null` when the value is not a container.
 *
 * An array's segment is already bracketed here rather than at the join, which is what lets
 * {@link renderPath} stay a string concatenation with no index arithmetic in it.
 *
 * @param value the value to open
 * @returns its children with their own address segments, or `null` for a leaf
 */
function childEntries({ value }: { value: unknown }): readonly (readonly [string, unknown])[] | null {
  if (Array.isArray(value)) {
    return value.map((item, index) => [`[${String(index)}]`, item] as const);
  }
  if (isRecord(value)) {
    return Object.entries(value);
  }
  return null;
}

/**
 * Walk every string leaf of a value, depth-bounded, pushing each one's address onto a shared stack.
 *
 * The stack is MUTATED rather than copied, and the visitor is handed the live array: that is what makes
 * this walk allocate no path per leaf, which is the whole reason the selection filter can share it. A
 * visitor that wants to keep a path renders it immediately.
 *
 * @param value the value to walk
 * @param segments the live segment stack, mutated as the walk descends
 * @param depth how many levels remain
 * @param visit called per string leaf; returning false stops the whole walk
 * @returns false when a visitor stopped the walk, true when it ran to the end
 */
function walkStringLeaves({
  value,
  segments,
  depth,
  visit,
}: {
  value: unknown;
  segments: string[];
  depth: number;
  visit: (leaf: { readonly value: string; readonly segments: readonly string[] }) => boolean;
}): boolean {
  if (depth <= 0) {
    return true;
  }
  if (typeof value === "string") {
    return visit({ segments, value });
  }
  const children = childEntries({ value });
  if (children === null) {
    return true;
  }
  for (const [segment, child] of children) {
    segments.push(segment);
    const keepGoing = walkStringLeaves({ depth: depth - 1, segments, value: child, visit });
    segments.pop();
    if (!keepGoing) {
      return false;
    }
  }
  return true;
}

/**
 * Visit every field of an entity a `--query` is tested against, in the one order both callers use.
 *
 * The identity fields come first and the provider's `detail` after, so the shallowest, most identifying
 * field is the one a witness reports. Changing this order changes which field a reader is sent to.
 *
 * @param entity the entity to walk
 * @param visit called per field; returning false stops the walk
 */
function forEachQueryField({
  entity,
  visit,
}: {
  entity: AtlasEntityView;
  visit: (leaf: { readonly value: string; readonly segments: readonly string[] }) => boolean;
}): void {
  if (!visit({ segments: ["providerId"], value: entity.providerId })) {
    return;
  }
  if (!visit({ segments: ["scope"], value: entity.scope })) {
    return;
  }
  if (!visit({ segments: ["kind"], value: entity.kind })) {
    return;
  }
  walkStringLeaves({
    depth: ATLAS_QUERY_DEPTH_LIMIT,
    segments: ["detail"],
    value: entity.detail,
    visit,
  });
}

/**
 * Split a caller's `--query` into the tokens every entity must carry all of.
 *
 * Deduplicated, which changes no selection — `--query password password` already selected exactly what
 * `--query password` did — and keeps a witness from printing the same line twice.
 *
 * @param query the caller's words
 * @returns the distinct lowercased tokens, empty when the query is only whitespace
 */
export function atlasQueryTokens({ query }: { query: string }): readonly string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter((token) => token.length > 0),
    ),
  ];
}

/**
 * Whether one entity carries every token somewhere.
 *
 * The hot path: this runs once per stored entity before any paging, so it renders no path, keeps no
 * field, and stops as soon as the last outstanding token is accounted for.
 *
 * @param entity the entity to test
 * @param tokens the lowercased tokens from {@link atlasQueryTokens}
 * @returns true when every token appears in at least one of the entity's fields
 */
export function entityCarriesTokens({
  entity,
  tokens,
}: {
  entity: AtlasEntityView;
  tokens: readonly string[];
}): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const outstanding = new Set(tokens);
  forEachQueryField({
    entity,
    visit: ({ value }) => {
      const lowered = value.toLowerCase();
      for (const token of outstanding) {
        if (lowered.includes(token)) {
          outstanding.delete(token);
        }
      }
      return outstanding.size > 0;
    },
  });
  return outstanding.size === 0;
}

/**
 * The text around a token inside the field that carried it, so a reader sees the evidence and not the
 * whole payload.
 *
 * @param value the matched field's own text
 * @param token the lowercased token it carried
 * @returns the excerpt, with an ellipsis on whichever side was cut
 */
function excerptAround({ value, token }: { value: string; token: string }): string {
  if (value.length <= ATLAS_EXCERPT_MAX_CHARS) {
    return value;
  }
  const at = value.toLowerCase().indexOf(token);
  const start = Math.max(0, at - EXCERPT_LEAD_CHARS);
  const end = Math.min(value.length, start + ATLAS_EXCERPT_MAX_CHARS);
  const head = start > 0 ? "…" : "";
  const tail = end < value.length ? "…" : "";
  return `${head}${value.slice(start, end)}${tail}`;
}

/**
 * Why each token of a `--query` selected this entity — the field it hit, and what that field says.
 *
 * One entry per TOKEN rather than per matching field, because a token buried in a policy template hits
 * dozens of them and a reader wants the shallowest one plus a count, not a page of them (rule 7). Runs
 * over one page's entities only; {@link entityCarriesTokens} is what decides the page.
 *
 * @param entity the entity to explain
 * @param query the caller's `--query`, unsplit
 * @returns one match per token that appears, in token order; empty when the query selected nothing
 */
export function atlasQueryMatches({
  entity,
  query,
}: {
  entity: AtlasEntityView;
  query: string;
}): readonly AtlasQueryMatch[] {
  const tokens = atlasQueryTokens({ query });
  if (tokens.length === 0) {
    return [];
  }
  const first = new Map<string, AtlasQueryField>();
  const counts = new Map<string, number>();
  forEachQueryField({
    entity,
    visit: ({ value, segments }) => {
      const lowered = value.toLowerCase();
      for (const token of tokens) {
        if (lowered.includes(token)) {
          const seen = counts.get(token);
          if (seen === undefined) {
            counts.set(token, 1);
            first.set(token, { path: renderPath({ segments }), value });
          } else {
            counts.set(token, seen + 1);
          }
        }
      }
      return true;
    },
  });
  const matches: AtlasQueryMatch[] = [];
  for (const token of tokens) {
    const field = first.get(token);
    const count = counts.get(token);
    if (field !== undefined && count !== undefined) {
      matches.push({
        alsoIn: count - 1,
        excerpt: excerptAround({ token, value: field.value }),
        path: field.path,
        token,
      });
    }
  }
  return matches;
}
