/**
 * Which atlases carry a per-user access level, and which of their own fields IS that level.
 *
 * ## Why a row is on the integration's manifest rather than the atlas registration
 *
 * `atlas/kit/read.ts`'s header states the property this obeys: the normalized view is "deliberately the
 * INTERSECTION of what the existing stores can answer, not a superset anybody has to grow into… A field no
 * platform can fill would be a field that lies on two of the three." There are thirty-seven registrations and
 * only four of them carry a per-user level at all, so an `accessLevel` projection on
 * `AtlasPlatformRegistration` would be a field thirty-three rows must decline.
 *
 * The sharper reason is that **which field is "the level" is a property of THIS question, not of the atlas**.
 * Cloudflare's `gatewaySeat` is an access level to an access review and a capability flag to every other
 * reader. So each row is the optional `accessReview` of its integration's manifest, named for the question, and
 * `unit/accessReview/levels.test.ts` is what holds it to the real kind and surface names.
 *
 * ## Verbatim means verbatim
 *
 * A level is rendered as the platform's own value and never normalised into a grade. `ACTIVATED`,
 * `Administrator With Billing`, `MEMBER` and `true` are four vocabularies and folding them into one would
 * destroy the only thing an auditor can check against the provider's own console. {@link verbatimLevel}
 * therefore stringifies and does not interpret, and an ABSENT field is `null` — distinct from a field present
 * and false, because an absent field inside a record is not evidence a setting is off.
 *
 * ## A kind that mixes surface families
 *
 * JumpCloud's `systemusers` kind holds three declared families at once — MEASURED on a published
 * generation: one `v1-systemusers-list`, one `v1-systemusers-get` and one `v1-systemusers-totp-info` record
 * per person, plus `v1-sshkey-list` records for whoever holds a key (reproduce with
 * `slopweaver atlas jumpcloud read --kind systemusers --limit 1 --json`, whose first record is a
 * `totp-info` carrying `enrollmentDate` and nothing else). Only the `v1-systemusers-get` family carries the
 * person. So a spec names its family, the family name is a DECLARED row of
 * `atlas/jumpcloud/generated/surfaces.ts`, and the guard test asserts it still is — because a renamed surface
 * that silently emptied the privileged table would print an ISO A.8.2 evidence pack with no rows in it,
 * which reads as "no privileged accounts".
 */
import { isRecord } from "#lib/parsers.js";

import { accessReviewRowsOf } from "../integrations/policyRows.js";
import { registeredIntegrations } from "../integrations/registry.js";

/**
 * One field of a platform's own record, rendered as that platform writes it.
 *
 * @internal
 */
export interface AccessLevelField {
  /** What to call it on a row, in this report's words. */
  readonly label: string;
  /** The path into the record's detail, outermost key first. */
  readonly path: readonly string[];
}

/** One value a level field resolved to on one row. */
export interface AccessLevelValue {
  readonly label: string;
  /** The platform's own value, stringified and never interpreted; `null` when the field is ABSENT. */
  readonly value: string | null;
}

/**
 * What counts as still HOLDING an account on one platform, in that platform's own vocabulary.
 *
 * @internal
 */
export interface AccessHoldRule {
  /** The level field's label, which must be one this platform declares. */
  readonly label: string;
  /** The values of that field that mean the account is live. */
  readonly whenValue: readonly string[];
}

/** One atlas that carries a per-user access level, and how to read it. */
export interface AccessPlatformSpec {
  /** The atlas platform name, as `atlas/registry.ts` registers it. */
  readonly platform: string;
  /** How to name the platform on a page. */
  readonly display: string;
  /** The kind holding the people. */
  readonly kind: string;
  /**
   * The declared surface family a person record's `providerId` opens with, or `null` when the kind holds
   * exactly one family. See this module's header for the JumpCloud measurement that makes it required.
   */
  readonly surfaceFamily: string | null;
  /** The path to the address the roster spine joins on. */
  readonly emailPath: readonly string[];
  /** The path to a display name, used for reading and never for joining. */
  readonly displayPath: readonly string[];
  /** The platform's own level fields, in the order a row prints them. */
  readonly levels: readonly AccessLevelField[];
  /** Any one of these matching means the person still holds an account here. */
  readonly holds: readonly AccessHoldRule[];
}

const ACCESS_REVIEW_ROWS = accessReviewRowsOf({ manifests: registeredIntegrations() });

/**
 * The atlases that hold access and carry a per-user level, in the order a report prints them, before the roster
 * spine they are all judged against.
 */
export const ACCESS_LEVEL_TABLE: readonly AccessPlatformSpec[] = ACCESS_REVIEW_ROWS.accessLevels;

/**
 * The platform whose people are the roster every other platform is judged against.
 *
 * Held apart from {@link ACCESS_LEVEL_TABLE}, so its own read stamp and boundary are gathered by the same code path
 * as the others and nothing joins against it twice.
 */
export const ROSTER_SPINE: AccessPlatformSpec = ACCESS_REVIEW_ROWS.rosterSpine;

/**
 * Read one path out of a record's detail without asserting anything about its shape.
 *
 * @param detail the entity detail, exactly as the atlas stored it
 * @param path the keys to walk, outermost first
 * @returns the value found, or `undefined` when any step of the path is absent
 */
export function readDetailPath({ detail, path }: { detail: unknown; path: readonly string[] }): unknown {
  let cursor: unknown = detail;
  for (const key of path) {
    if (!isRecord(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return cursor;
}

/**
 * Render one resolved value the way the platform wrote it.
 *
 * A boolean becomes `true`/`false` and a number its own digits, because those are what the provider's console
 * shows. A number is the PARSED value, so it prints in JavaScript's canonical form — a stored `1e3` reads
 * `1000`, the record's raw text being gone by the time the atlas hands it over — except `-0`, which `String`
 * would print as `0` and is kept distinct. An object or an array is NOT flattened into prose — it is reported
 * as its JSON, so a level that turns out to be structured is visible as structured rather than as
 * `[object Object]`. That JSON is `JSON.stringify`'s, so a `-0` nested inside one reads `0`: the `-0` kept
 * above is a top-level scalar's.
 *
 * @param value whatever {@link readDetailPath} found
 * @returns the verbatim rendering, or `null` when the field was absent or explicitly null
 */
export function verbatimLevel({ value }: { value: unknown }): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Object.is(value, -0)) {
    return "-0";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Every level field of one spec, resolved against one record's detail.
 *
 * A field the platform stored as an explicit `null` is reported as its JSON, `null`, exactly as a structured
 * value is — only a field the record does not carry at all is `null` here, so the two never print alike.
 *
 * @param spec the platform whose fields to read
 * @param detail the record's detail
 * @returns one value per declared field, in the spec's own order
 */
export function levelValuesOf({
  spec,
  detail,
}: {
  spec: AccessPlatformSpec;
  detail: unknown;
}): readonly AccessLevelValue[] {
  return spec.levels.map((field) => {
    const stored = readDetailPath({ detail, path: field.path });
    if (stored === null) {
      return { label: field.label, value: "null" };
    }
    return { label: field.label, value: verbatimLevel({ value: stored }) };
  });
}

/**
 * Whether one row's levels mean the person still holds an account on this platform.
 *
 * ANY matching rule is enough, because Cloudflare's two seats are two independent ways to hold access and a
 * person with only a gateway seat holds one.
 *
 * @param spec the platform whose rules apply
 * @param levels the row's resolved levels
 * @returns true when at least one declared rule matches
 */
export function holdsAccount({
  spec,
  levels,
}: {
  spec: AccessPlatformSpec;
  levels: readonly AccessLevelValue[];
}): boolean {
  return spec.holds.some((rule) =>
    levels.some((level) => level.label === rule.label && level.value !== null && rule.whenValue.includes(level.value)),
  );
}
