/**
 * Where the two surfaces disagree — and it RESOLVES none of them.
 *
 * `docs/atlas-intent/04-corroboration.md`: corroboration between the API and the browser is itself an OUTPUT, not a
 * build-time check that gets discarded, and what a disagreement MEANS is the owner's call, reserved until
 * the owner can see real instances. So this verb collects instances and stops. It never picks a winner, never
 * suppresses one surface's row, and never closes a gap on the strength of the other surface agreeing.
 *
 * Three disagreements are computable from what the two channels store, and each answers a different
 * question:
 *
 * - **`browser-only`** — an operation the console's own client calls that no published definition declares.
 *   This is the class the both-surfaces ruling exists for: _"there are things via the browser you can't get
 *   by API"_. Each is a LEAD rather than a capability — seeing the client call it says Twilio HOLDS the
 *   data, never that an ordinary API key may ask for it.
 * - **`spec-only`** — an operation the definitions declare that the console never called. Expected in bulk
 *   and reported anyway, because the SHAPE of it is informative: a whole product no console page touches is
 *   a product whose surface is API-only, which is a fact about Twilio.
 * - **`field-divergence`** — an operation both surfaces know, where one carries a response field name the
 *   other does not. This is the sharpest of the three and the one a single-surface atlas cannot produce at
 *   all.
 *
 * A report over a generation whose browser channel has never been filled says so and lists nothing, rather
 * than reporting every operation as `spec-only` — which would be technically true and a lie about what was
 * measured.
 */
import { absentAsEmpty } from "#lib/absent.js";
import type { TwilioAtlasEntity, TwilioAtlasKindFile } from "./model.js";

/** What one disagreement between the two surfaces is. */
const TWILIO_DISAGREEMENT_KINDS = ["browser-only", "spec-only", "field-divergence"] as const;

/** One class of disagreement. */
type TwilioDisagreementKind = (typeof TWILIO_DISAGREEMENT_KINDS)[number];

/** One operation the two surfaces do not agree about. */
interface TwilioDisagreement {
  /** Response field names the one surface has and the other does not, sorted. Empty unless a divergence. */
  readonly fields: readonly string[];
  readonly kind: TwilioDisagreementKind;
  /** `<METHOD> <path shape>` — the key the two channels are matched on. */
  readonly providerId: string;
}

/** What a report found, and whether it could have found anything at all. */
export interface TwilioReport {
  /** Every disagreement, most specific class first. */
  readonly disagreements: readonly TwilioDisagreement[];
  /** How many method rows carry an api-channel observation. */
  readonly specKnown: number;
  /** How many method rows carry a browser-channel observation. */
  readonly browserKnown: number;
  /** Why this report can find nothing, or `null` when both channels have looked. */
  readonly unmeasurableBecause: string | null;
}

/** The response field names one channel's detail carries. */
function fieldsOf({ detail }: { detail: unknown }): readonly string[] {
  if (typeof detail !== "object" || detail === null) {
    return [];
  }
  const fields = (detail as { responseFields?: unknown }).responseFields;
  return Array.isArray(fields) ? fields.filter((field): field is string => typeof field === "string") : [];
}

/** Names in the first list and not the second, sorted. */
function missingFrom({ have, lack }: { have: readonly string[]; lack: readonly string[] }): readonly string[] {
  const known = new Set(lack);
  return have.filter((field) => !known.has(field)).toSorted();
}

/** The disagreement one entity carries, or `null` when both channels agree or only one has looked. */
function disagreementFor({ entity }: { entity: TwilioAtlasEntity }): TwilioDisagreement | null {
  const spec = entity.channels.api;
  const browser = entity.channels.browser;
  if (spec === null && browser !== null) {
    return { fields: [], kind: "browser-only", providerId: entity.providerId };
  }
  if (spec !== null && browser === null) {
    return { fields: [], kind: "spec-only", providerId: entity.providerId };
  }
  if (spec === null || browser === null) {
    return null;
  }
  const specFields = fieldsOf({ detail: spec.detail });
  const browserFields = fieldsOf({ detail: browser.detail });
  const fields = [
    ...missingFrom({ have: browserFields, lack: specFields }),
    ...missingFrom({ have: specFields, lack: browserFields }),
  ].toSorted();
  return fields.length === 0 ? null : { fields, kind: "field-divergence", providerId: entity.providerId };
}

/** How the three classes sort: the ones a reader acts on first. */
const KIND_ORDER: Readonly<Record<TwilioDisagreementKind, number>> = {
  "browser-only": 0,
  "field-divergence": 1,
  "spec-only": 2,
};

/**
 * Collect every disagreement the stored `method` kind carries.
 *
 * Pure: it reads a kind file and returns findings. It writes nothing, closes nothing, and prefers neither
 * surface — see this file's header on why that is the ruling rather than a limitation.
 *
 * @param methods the stored `method` kind file, or `null` when nothing has been published
 * @returns the findings, and why there can be none when a channel has never looked
 */
export function reportTwilioDisagreements({ methods }: { methods: TwilioAtlasKindFile | null }): TwilioReport {
  const entities = absentAsEmpty({ value: methods?.entities });
  const specKnown = entities.filter((entity) => entity.channels.api !== null).length;
  const browserKnown = entities.filter((entity) => entity.channels.browser !== null).length;
  if (browserKnown === 0) {
    return {
      browserKnown,
      disagreements: [],
      specKnown,
      unmeasurableBecause:
        "the browser channel holds no operation at all, so nothing can disagree with anything. Reporting " +
        `all ${String(specKnown)} spec-declared operations as browser-absent would be technically true and ` +
        "a lie about what was measured. Run `slopweaver atlas twilio walk` once the console is signed in",
    };
  }
  const disagreements = entities
    .map((entity) => disagreementFor({ entity }))
    .filter((found): found is TwilioDisagreement => found !== null)
    .toSorted(
      (left, right) =>
        KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || left.providerId.localeCompare(right.providerId),
    );
  return { browserKnown, disagreements, specKnown, unmeasurableBecause: null };
}
