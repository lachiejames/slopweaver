/**
 * The ESTATE half of this atlas: the records this organisation actually holds, not the operations that
 * could reach them.
 *
 * ## The defect this closes, measured twice by the same question
 *
 * `slopweaver atlas datadog read --kind monitor` answered "29 matching STORED entities" and every one of
 * them was an SDK operation compiled from `@datadog/datadog-api-client` — `v2-monitors-update-monitor-config-policy`,
 * `PATCH /api/v2/monitor/policy/{policy_id}` — while this organisation ran hundreds of monitors it held none
 * of. Two dogfood turns hit it independently and both abandoned the atlas for
 * `slopweaver datadog raw`. `kit/estateEvidence.ts` is the GRADING half of the same finding, and it is what
 * makes a kind say so out loud; this file is the half that makes the sentence stop being true.
 *
 * ## It issues NO request of its own, and that is the design rather than a saving
 *
 * `v1-monitors-list-monitors`, `v1-dashboards-list-dashboards` and `v1-notebooks-list-notebooks` are all
 * `disposition: "entity"` with no `{parameter}` in their path, so all three are ALREADY inside
 * `DATADOG_API_ADMITTED` and the live pass already calls them and already projects their answers. What was
 * missing was never the request. It was that the answer went into one operation entity's `detail` and
 * nothing ever addressed the records inside it. So this file reads the outcome the pass has in hand and
 * explodes it, which means the acquisition registry stays exactly as closed as `apiAcquisition.ts` says it
 * is: there is no second transport, no second budget and no operation reachable here that is not reachable
 * there.
 *
 * ## One extractor per row, never a "find the array" heuristic
 *
 * The three envelopes disagree, MEASURED live against this install's site with
 * `slopweaver datadog raw --method GET --path /api/v1/monitor` and its two siblings: monitors come back as
 * a BARE array, dashboards under `dashboards`, notebooks under `data`. A generic "first array in the body"
 * rule would have worked on all three that morning and silently picked a widget list the day a response
 * grew one. Each row names its own field, so a shape change is a zero this file reports rather than a wrong
 * answer it invents.
 *
 * ## What this does NOT do
 *
 * It keeps whatever page the live pass kept, and no more. `v1-monitors-list-monitors` pages under `offset`
 * and the other two are `limit-only`, so `syncApi.ts`'s `api-first-page-only` gap already names the
 * parameter a walk would have to send — and an estate count is a count of STORED records, never of what
 * Datadog holds. Reporting a first page as the estate would be the "reported N, reached one" failure
 * `descriptor.ts` says this atlas refuses to repeat.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type DatadogAtlasError, DatadogAtlasErrors } from "./errors.js";
import { DATADOG_SURFACES } from "./generated/surfaces.js";
import type { DatadogKind } from "./model.js";

/** One record this organisation holds, with the provider's own identifier for it. */
interface DatadogEstateRecord {
  /** Datadog's own id, rendered as a string — numeric for a monitor or notebook, a slug for a dashboard. */
  readonly providerId: string;
  /** The record as stored, already projected through this kind's field denials by the caller. */
  readonly record: unknown;
}

/** What one page body yielded, including what it could not identify — a zero is never left to be inferred. */
export interface DatadogEstateExtraction {
  readonly records: readonly DatadogEstateRecord[];
  /** Entries that were present and carried no usable `id`. Reported rather than silently dropped. */
  readonly unidentified: number;
}

/** One kind whose estate this atlas holds, and the operation whose answer carries it. */
export interface DatadogEstateRow {
  readonly kind: DatadogKind;
  /** The registry operation name, exactly as `generated/surfaces.ts` spells it. */
  readonly surface: string;
  /** What one record is, in the provider's own word, for the coverage cell's prose. */
  readonly noun: string;
  /** Pull this envelope's records out of ONE page body. */
  readonly extract: ({ body }: { body: unknown }) => DatadogEstateExtraction;
}

/**
 * Whether a value is a JSON object this file may index.
 *
 * @param value the projected body, or a member of one
 * @returns `true` when it is a non-null object and not an array
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The entries at one named field, or none when the body does not carry an array there.
 *
 * @param body one page as the provider sent it, already projected
 * @param field the envelope field this operation puts its collection under
 * @returns the entries, empty when the field is absent or is not an array
 */
function entriesAt({ body, field }: { body: unknown; field: string }): readonly unknown[] {
  if (!isObject(body)) {
    return [];
  }
  const held = body[field];
  if (!Array.isArray(held)) {
    return [];
  }
  return held;
}

/**
 * The entries of a body that IS the collection.
 *
 * @param body one page as the provider sent it, already projected
 * @returns the entries, empty when the body is not an array
 */
function entriesOf({ body }: { body: unknown }): readonly unknown[] {
  if (!Array.isArray(body)) {
    return [];
  }
  return body;
}

/**
 * Turn entries into identified records, counting the ones that carry no id rather than dropping them quietly.
 *
 * An `id` may be a number (a monitor, a notebook) or a string (a dashboard), and nothing else is accepted:
 * a boolean or an object at `id` is a shape this file does not understand, and calling it an identifier
 * would mint an entity whose identity is `"[object Object]"`.
 *
 * @param entries the collection's own members
 * @returns the identified records and how many members had no usable id
 */
function identify({ entries }: { entries: readonly unknown[] }): DatadogEstateExtraction {
  const records: DatadogEstateRecord[] = [];
  let unidentified = 0;
  for (const entry of entries) {
    if (!isObject(entry)) {
      unidentified += 1;
      continue;
    }
    const id = entry["id"];
    if (typeof id === "number") {
      records.push({ providerId: String(id), record: entry });
      continue;
    }
    if (typeof id === "string" && id.length > 0) {
      records.push({ providerId: id, record: entry });
      continue;
    }
    unidentified += 1;
  }
  return { records, unidentified };
}

/**
 * Every kind whose ESTATE this atlas fills, and from which operation.
 *
 * Three rows rather than a rule, because "which operation returns the things themselves" is a judgement
 * about each API and not a property the registry carries: `v1-monitors-list-monitors` returns monitors and
 * `v2-monitors-list-monitor-config-policies` returns policies, and both are `entity` rows in the `monitor`
 * kind. `estateAcquisition.test.ts` pins every `surface` here against the committed registry, so a row
 * naming an operation this build cannot issue fails rather than silently acquiring nothing.
 * @internal
 */
export const DATADOG_ESTATE_ROWS: readonly DatadogEstateRow[] = [
  {
    extract: ({ body }) => identify({ entries: entriesOf({ body }) }),
    kind: "monitor",
    noun: "monitor",
    surface: "v1-monitors-list-monitors",
  },
  {
    extract: ({ body }) => identify({ entries: entriesAt({ body, field: "dashboards" }) }),
    kind: "dashboard",
    noun: "dashboard",
    surface: "v1-dashboards-list-dashboards",
  },
  {
    extract: ({ body }) => identify({ entries: entriesAt({ body, field: "data" }) }),
    kind: "notebooks",
    noun: "notebook",
    surface: "v1-notebooks-list-notebooks",
  },
];

/**
 * The estate row for one kind, or `null` when this atlas holds no estate for it.
 *
 * @param kind the kind a pass is publishing
 * @returns the row, or `null` — which is the answer for 143 of the 146 kinds
 */
export function datadogEstateRowFor({ kind }: { kind: DatadogKind }): DatadogEstateRow | null {
  const row = DATADOG_ESTATE_ROWS.find((one) => one.kind === kind);
  if (row === undefined) {
    return null;
  }
  return row;
}

/**
 * Extract one kind's estate out of the pages its list operation answered with.
 *
 * REFUSES on a collision rather than publishing one: `datadogEntityId` hashes `kind` and `providerId`, so a
 * record whose id happened to equal a registry operation name in the same kind would merge INTO that
 * operation's entity and silently overwrite its compiled channel. No such id exists today — Datadog ids are
 * numbers and slugs, operation names are `v1-…` surface names — which is exactly why it has to be a refusal
 * rather than a comment saying it cannot happen.
 *
 * @param row the estate row being filled
 * @param bodies the pages the live pass kept, already projected through this kind's field denials
 * @returns the records and the unidentified count, or the collision that stopped publication
 */
export function datadogEstateRecords({
  row,
  bodies,
}: {
  row: DatadogEstateRow;
  bodies: readonly unknown[];
}): Result<DatadogEstateExtraction, DatadogAtlasError> {
  const operationNames = new Set(DATADOG_SURFACES.filter((one) => one.kind === row.kind).map((one) => one.name));
  const records: DatadogEstateRecord[] = [];
  let unidentified = 0;
  for (const body of bodies) {
    const page = row.extract({ body });
    unidentified += page.unidentified;
    for (const record of page.records) {
      if (operationNames.has(record.providerId)) {
        return err(
          DatadogAtlasErrors.unexpectedShape({
            detail: `a ${row.noun} came back with id \`${record.providerId}\`, which is also the name of an operation the registry carries for kind \`${row.kind}\` — storing it would merge this record into that operation's entity and overwrite its compiled channel`,
            surface: row.surface,
          }),
        );
      }
      records.push(record);
    }
  }
  return ok({ records, unidentified });
}
