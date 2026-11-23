/**
 * Which of the four dispositions each Nightfall operation takes, and the one rule that decides it.
 *
 * ## The rule, stated once
 *
 * `docs/atlas-intent/06-holdings.md`: a family is highly voluminous when its records are **time-series
 * OBSERVATIONS** — emitted by the platform rather than created by a person, unbounded, growing with the
 * clock, and identified by an INSTANT rather than by a name somebody chose. Configuration is the
 * complement: what a person or a system CREATED, and what can be listed exhaustively.
 *
 * On this platform the rule cuts unusually cleanly, and that is worth stating because it is the whole
 * shape of this atlas. Nightfall's workflow APIs return two utterly different things under one bearer
 * token:
 *
 * - **Detections** — violations, findings, exfiltration events, posture events, and the activity feeds
 *   beside each. Every one is something the product NOTICED at an instant. `GET /violations` defaults to a
 *   trailing ninety days and pages by cursor with no declared ceiling; the vendor's own parameter names are
 *   `createdAfter`, `createdBefore` and `updatedAfter`. These are the highly-voluminous class, and the
 *   handover that commissioned this atlas named them as such before a line was written.
 * - **Inventory** — MCP servers, devices, plugins, hooks, IDE extensions, GitHub repositories, endpoint
 *   devices and the domain and MCP collections an administrator authored. Each is enumerable, each is
 *   identified by a name or a UUID somebody or something chose, and none grows with the clock. These are
 *   entities, and holding them is the point: nothing else on this machine holds Nightfall's view of which
 *   MCP servers and AI plugins are running on the fleet.
 *
 * ## Why the detections are shape-indexed rather than excluded
 *
 * Because "Nightfall has no violation feed" is false, and an atlas that said it would be worse than one
 * that did not exist. A shape-indexed family is REACHED — called over a bounded window, its record field
 * names and its window count recorded — and simply never publishes a row per detection. The disposition is
 * how this atlas says "I looked, and I deliberately do not store every row", which an exclusion cannot say.
 *
 * There is a second reason here that no sibling atlas has. A DLP violation record is, by construction, a
 * description of sensitive data somebody touched: who, from which device, to which destination, and which
 * detector fired. Storing the feed whole would make this atlas the densest concentration of exactly the
 * material the product exists to protect. Shape-indexing is the right disposition on the owner's rule and
 * is also the only defensible one on the content.
 *
 * ## Nothing here is `probe-only`, and that is a fact about the vendor
 *
 * The sibling atlases carry probe-only rows for credential-validation calls — `GET /users/me` and its
 * kin. Nightfall publishes no such endpoint in any of the six documents: a caller learns whether its key
 * works by making a real request and reading the `401`. So the count is zero rather than the concept being
 * unused, and `generateNightfallSurfaces.ts` asserts the census rather than letting it drift.
 */
import type { NightfallAtlasKind } from "./model.js";
import type { NightfallDisposition, NightfallExclusionReason } from "./surfaceRow.js";

/**
 * What the disposition rule decided for one operation, and why.
 * @internal
 */
export interface NightfallDispositionVerdict {
  readonly disposition: NightfallDisposition;
  /** Why this is not a plain `entity`. `null` only when it is one. */
  readonly dispositionBecause: string | null;
  /** Which refusal applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: NightfallExclusionReason | null;
}

/**
 * Every kind whose records are time-series observations.
 *
 * A LIST of kinds rather than a predicate over paths, because the criterion is about what a record IS and
 * the vendor's own resource nouns already say it. Asserted total against the registry by the generator, so
 * a document that grows a seventh kind fails the run instead of defaulting to `entity`.
 */
const OBSERVATIONAL_KINDS: readonly NightfallAtlasKind[] = [
  "exfiltration-activity",
  "exfiltration-event",
  "finding",
  "posture-activity",
  "posture-event",
  "violation",
];

/** The methods that change a tenant. Read from the document's own verb, never inferred from a path. */
const MUTATING_METHODS = new Set(["PUT", "PATCH", "DELETE"]);

/**
 * Every POST this atlas has judged one by one, with what it does.
 *
 * A POST is not automatically a write here and is not automatically anything else either — the Datadog
 * atlas's review found a `POST .../snapshots` that created one and a `GET` that spent credit, so the verb
 * decides nothing on its own. There are five POSTs across the six documents and each is named.
 */
const POST_VERDICTS: Readonly<Record<string, NightfallExclusionReason>> = {
  "dlp-post-violations-actions": "mutating",
  "dlp-post-findings-by-finding-id-annotate": "mutating",
  "dlp-post-findings-by-finding-id-unannotate": "mutating",
  "apps-post-endpoint-collections": "mutating",
  "apps-post-endpoint-collections-by-collection-uuid-domains": "mutating",
  "apps-post-endpoint-mcp-collections": "mutating",
  "apps-post-endpoint-mcp-collections-by-collection-uuid-items": "mutating",
  "scan-post-v3-scan": "egressing",
  "scan-post-v3-upload": "egressing",
  "scan-post-v3-upload-by-file-id-finish": "mutating",
  "scan-post-v3-upload-by-file-id-scan": "side-effecting",
};

/** What to say about each exclusion reason, so a row explains itself without a reader opening this file. */
const EXCLUSION_PROSE: Readonly<Record<NightfallExclusionReason, string>> = {
  egressing:
    "issuing it would send this machine's own content to the vendor as the request body — the scan family takes your data as its input, so an atlas cannot call it to map it",
  mutating: "it changes the tenant, and this atlas only ever reads",
  "side-effecting":
    "it makes Nightfall ACT — classifying an uploaded file is billed work with a result, not an observation of existing state",
};

/**
 * Decide what this atlas does with one operation.
 *
 * @param kind the atlas kind the operation contributes to
 * @param method the document's own HTTP method
 * @param name the registry-unique operation name, which is what a POST verdict is keyed on
 * @returns the disposition and the reason it is not a plain entity
 */
export function nightfallDispositionFor({
  kind,
  method,
  name,
}: {
  kind: string;
  method: string;
  name: string;
}): NightfallDispositionVerdict {
  if (method === "POST") {
    const reason = POST_VERDICTS[name];
    if (reason === undefined) {
      throw new Error(`nightfallDispositionFor: no verdict for POST ${name} — judge it in dispositions.ts`);
    }
    return { disposition: "excluded", dispositionBecause: EXCLUSION_PROSE[reason], exclusionReason: reason };
  }
  if (MUTATING_METHODS.has(method)) {
    return {
      disposition: "excluded",
      dispositionBecause: EXCLUSION_PROSE.mutating,
      exclusionReason: "mutating",
    };
  }
  if (OBSERVATIONAL_KINDS.some((candidate) => candidate === kind)) {
    return {
      disposition: "shape-index",
      dispositionBecause:
        "its records are time-series observations the product emitted, unbounded and identified by an instant — the highly-voluminous disposition of docs/atlas-intent/06-holdings.md, so the family is reached over a bounded window and its shape stored, never a row per detection",
      exclusionReason: null,
    };
  }
  return { disposition: "entity", dispositionBecause: null, exclusionReason: null };
}

/**
 * Every kind the observational rule names, for the generator to assert it left none of them behind.
 *
 * @returns the observational kind names, sorted
 */
export function nightfallObservationalKinds(): readonly NightfallAtlasKind[] {
  return OBSERVATIONAL_KINDS;
}
