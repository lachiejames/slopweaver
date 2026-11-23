/**
 * Where the surfaces disagree — and it RESOLVES none of them.
 *
 * `docs/atlas-intent/04-corroboration.md`: corroboration between the API and the browser is itself an OUTPUT, not a
 * build-time check that gets discarded, and what a disagreement MEANS is the owner's call, reserved until they
 * can see real instances. So this verb collects instances and stops. It never picks a winner, never
 * suppresses one surface's row, and never closes a gap on the strength of another surface agreeing.
 *
 * ## Four classes, and two of them are computable before a browser is driven at all
 *
 * Every sibling atlas can only produce a disagreement once its walk has run. Hex is the first here where the
 * published document can be contradicted by two other ANONYMOUS measurements, so a fresh install with no
 * browser session gets real findings on the first sync:
 *
 * - **`undeclared-noun`** — a `/api/v1` noun the router mounts that the published document declares no path
 *   under. `apiProbe.ts` measures it with a control, and it is §2's divergence reached from the API side.
 * - **`undeclared-graphql`** — an operation the shipped web client can send to `app.hex.tech/graphql` that
 *   the published document knows nothing about. MEASURED: this is not a handful of stragglers,
 *   it is a whole API — the document declares 52 REST operations and none of the client's GraphQL ones.
 * - **`browser-only`** — an operation the app's own client called that no api-channel evidence named. A
 *   LEAD rather than a capability: seeing the client call it says Hex HOLDS the data, never that a token may
 *   ask for it.
 * - **`field-divergence`** — an operation both channels know, where one carries a response field name the
 *   other does not. The sharpest of the four and the one a single-surface atlas cannot produce at all.
 *
 * ## A withheld operation can never produce a field divergence, and that is stated rather than silent
 *
 * `webReduction.ts` refuses to record field names for a result-bearing call, so such a row's browser-channel
 * field list is empty by policy. Comparing it to the document's declared fields would report every declared
 * field as browser-absent — technically true and a lie about what was measured, which is the exact failure
 * this file's `unmeasurableBecause` exists to prevent one level up. Those rows are counted and excluded, and
 * the count is reported.
 */
import { absentAsEmpty } from "#lib/absent.js";
import { HEX_PROBE_CENSUS } from "./apiProbe.js";
import { HEX_CLIENT_SURFACE } from "./generated/clientSurface.js";
import type { HexAtlasEntity, HexAtlasKindFile } from "./model.js";

/**
 * What one disagreement between the surfaces is.
 *
 * @internal
 */
export const HEX_DISAGREEMENT_KINDS = [
  "undeclared-noun",
  "undeclared-graphql",
  "browser-only",
  "field-divergence",
] as const;

/**
 * One class of disagreement.
 *
 * @internal
 */
export type HexDisagreementKind = (typeof HEX_DISAGREEMENT_KINDS)[number];

/** One thing the surfaces do not agree about. */
export interface HexDisagreement {
  /** Response field names the one surface has and the other does not, sorted. Empty unless a divergence. */
  readonly fields: readonly string[];
  readonly kind: HexDisagreementKind;
  /** The key being compared — a provider id, a noun, or a GraphQL operation name. */
  readonly providerId: string;
}

/** What a report found, and whether it could have found anything at all. */
export interface HexReport {
  /** How many method rows carry a browser-channel observation. */
  readonly browserKnown: number;
  /** Every disagreement, most specific class first. */
  readonly disagreements: readonly HexDisagreement[];
  /** How many method rows carry an api-channel observation. */
  readonly specKnown: number;
  /** Why the browser half of this report can find nothing, or `null` when the walk has run. */
  readonly unmeasurableBecause: string | null;
  /** Rows excluded from the field comparison because their body is withheld — see this file's header. */
  readonly withheldFromComparison: number;
}

/** The response field names one channel's detail carries. */
function fieldsOf({ detail }: { detail: unknown }): readonly string[] {
  if (typeof detail !== "object" || detail === null) {
    return [];
  }
  const fields = (detail as { responseFields?: unknown }).responseFields;
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [];
}

/** Whether one entity's browser channel refused to describe its body. */
function browserWithheld({ entity }: { entity: HexAtlasEntity }): boolean {
  const detail = entity.channels.browser?.detail;
  if (typeof detail !== "object" || detail === null) {
    return false;
  }
  return typeof (detail as { fieldsWithheldBecause?: unknown }).fieldsWithheldBecause === "string";
}

/** Names in the first list and not the second, sorted. */
function missingFrom({ have, lack }: { have: readonly string[]; lack: readonly string[] }): readonly string[] {
  const known = new Set(lack);
  return have.filter((field) => !known.has(field)).toSorted();
}

/** The disagreement one entity carries, or `null` when the channels agree or only one has looked. */
function disagreementFor({ entity }: { entity: HexAtlasEntity }): HexDisagreement | null {
  const spec = entity.channels.api;
  const browser = entity.channels.browser;
  if (spec === null && browser !== null) {
    return { fields: [], kind: "browser-only", providerId: entity.providerId };
  }
  if (spec === null || browser === null || browserWithheld({ entity })) {
    return null;
  }
  const fields = [
    ...missingFrom({ have: fieldsOf({ detail: browser.detail }), lack: fieldsOf({ detail: spec.detail }) }),
    ...missingFrom({ have: fieldsOf({ detail: spec.detail }), lack: fieldsOf({ detail: browser.detail }) }),
  ].toSorted();
  return fields.length === 0 ? null : { fields, kind: "field-divergence", providerId: entity.providerId };
}

/**
 * The nouns the router mounts that the published document declares no path under.
 *
 * Computed from the two committed measurements rather than from the store, so it answers on a fresh install
 * before anything is synced. The document's own nouns are the first path segment after `/v1/`, which is why
 * `semantic-(projects|models)` — the one path key Hex writes as a regular expression — matches neither
 * mounted noun and both of them show up here. That is the finding rather than a parsing failure: the
 * document's own key does not name either route it clearly means.
 *
 * @param declaredPaths every path key the pinned document declares
 * @returns one disagreement per mounted-but-undeclared noun, sorted
 */
export function undeclaredNouns({ declaredPaths }: { declaredPaths: readonly string[] }): readonly HexDisagreement[] {
  // The second segment of `/v1/<noun>/…`. A path with no second segment contributes nothing rather than an
  // empty string standing in for one — an empty noun would match no census row and quietly widen the finding.
  const declared = new Set(
    declaredPaths
      .map((path) => path.split("/").filter((segment) => segment.length > 0)[1])
      .filter((noun): noun is string => noun !== undefined),
  );
  return HEX_PROBE_CENSUS.filter((row) => row.evidence === "mounted-401" && !declared.has(row.noun))
    .map((row): HexDisagreement => ({ fields: [], kind: "undeclared-noun", providerId: row.noun }))
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/**
 * The GraphQL operations the shipped client can send that the published document knows nothing about.
 *
 * The published document declares REST operations only — it has no GraphQL section at all — so every named
 * operation the client carries is undeclared by construction. That is stated rather than hidden behind a
 * set difference that always returns everything: the comparison is trivial, and the FINDING is that a whole
 * first-party API exists outside the published surface.
 *
 * @returns one disagreement per client GraphQL operation, sorted
 */
export function undeclaredGraphqlOperations(): readonly HexDisagreement[] {
  return HEX_CLIENT_SURFACE.graphqlOperations
    .map((operation): HexDisagreement => ({ fields: [], kind: "undeclared-graphql", providerId: operation.name }))
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/** How the four classes sort: the ones a reader acts on first. */
const KIND_ORDER: Readonly<Record<HexDisagreementKind, number>> = {
  "browser-only": 1,
  "field-divergence": 0,
  "undeclared-graphql": 3,
  "undeclared-noun": 2,
};

/**
 * Collect every disagreement the stored generation carries.
 *
 * Pure: it reads a kind file and two committed measurements and returns findings. It writes nothing, closes
 * nothing, and prefers no surface — see this file's header on why that is the ruling rather than a limitation.
 *
 * @param methods the stored `method` kind file, or `null` when nothing has been published
 * @param declaredPaths every path key the pinned document declares
 * @returns the findings, and why the browser half can produce none when the walk has never run
 */
export function reportHexDisagreements({
  methods,
  declaredPaths,
}: {
  methods: HexAtlasKindFile | null;
  declaredPaths: readonly string[];
}): HexReport {
  const entities = absentAsEmpty({ value: methods?.entities });
  const specKnown = entities.filter((entity) => entity.channels.api !== null).length;
  const browserKnown = entities.filter((entity) => entity.channels.browser !== null).length;
  const anonymous = [...undeclaredNouns({ declaredPaths }), ...undeclaredGraphqlOperations()];
  const withheldFromComparison = entities.filter(
    (entity) => entity.channels.api !== null && entity.channels.browser !== null && browserWithheld({ entity }),
  ).length;
  const fromStore =
    browserKnown === 0
      ? []
      : entities
          .map((entity) => disagreementFor({ entity }))
          .filter((found): found is HexDisagreement => found !== null);
  return {
    browserKnown,
    disagreements: [...fromStore, ...anonymous].toSorted(
      (left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.providerId.localeCompare(right.providerId),
    ),
    specKnown,
    unmeasurableBecause:
      browserKnown === 0
        ? "the browser channel holds no operation at all, so nothing observed can disagree with anything. " +
          `The ${String(anonymous.length)} anonymous finding(s) above stand regardless — they are measured ` +
          "without a session. Run `slopweaver atlas hex walk` once app.hex.tech is signed in to add the " +
          "browser half"
        : null,
    withheldFromComparison,
  };
}
