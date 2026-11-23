/**
 * Reading one `entityInventory.ts` row through its strict boundary, and refusing a read that is not whole.
 *
 * Merge is channel-scoped and an entity a run does not observe goes stale (`merge.ts`). So a read that was
 * refused, answered a drifted shape, flagged a page truncated, or held fewer records than the total the
 * provider itself stated must never reach the merge — it would mark every record it missed stale as if Trelica
 * had stopped knowing about it. Each function here answers either the whole list or the reason it is not.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import type { TrelicaCallResult, TrelicaClient, TrelicaPage, TrelicaPagesResult } from "./client.js";
import type { TrelicaCall } from "./inventory.js";
import type { TrelicaAtlasEntity } from "./model.js";
import type { TrelicaBoundary } from "./trelicaBoundary.js";

/** The nine kinds a raised role opened. */
const TRELICA_ENTITY_KINDS = [
  "access-review",
  "assessment",
  "contract",
  "device",
  "integration",
  "person",
  "team",
  "workflow",
  "workflow-run",
] as const;

/** One of the nine 15-Oct kinds. */
export type TrelicaEntityKind = (typeof TRELICA_ENTITY_KINDS)[number];

/** What one kind's read came to: a whole, admitted list, or the reason there is none this run. */
export type TrelicaEntityRead =
  | {
      readonly kind: TrelicaEntityKind;
      readonly held: true;
      readonly entities: readonly TrelicaAtlasEntity[];
      /** What the coverage cell says was read. */
      readonly reason: string;
    }
  | { readonly kind: TrelicaEntityKind; readonly held: false; readonly reason: string };

/** What one kind's reader returns: the kind's outcome and every call that answered. */
export interface TrelicaKindOutcome {
  readonly read: TrelicaEntityRead;
  readonly calls: readonly TrelicaCallResult[];
}

/**
 * A kind with no list this run.
 *
 * @param reasons why it was not read whole
 * @returns the outcome, carrying no calls
 */
export function unreadTrelicaKind({
  kind,
  reasons,
}: {
  kind: TrelicaEntityKind;
  reasons: readonly string[];
}): TrelicaKindOutcome {
  return { calls: [], read: { held: false, kind, reason: reasons.join("; ") } };
}

/** The longest reason carried into a coverage cell or a gap; a drift report can name every drifted key. */
const REASON_CAP = 400;

/** A reason cut to {@link REASON_CAP} characters. */
function heldTrelicaReason({ text }: { text: string }): string {
  return text.length > REASON_CAP ? `${text.slice(0, REASON_CAP)}…` : text;
}

/**
 * One answered read as the call it was, so the method map records it like every other admitted call. `items` is
 * each record's census view, never the answer itself, and the raw pages are not carried on.
 */
function asCall<T>({ result, items }: { result: TrelicaPagesResult<T>; items: readonly unknown[] }): TrelicaCallResult {
  return {
    callId: result.callId,
    httpMethod: result.httpMethod,
    items,
    path: result.path,
    statusCode: result.statusCode,
    total: items.length,
  };
}

/**
 * Call one row and admit every page through its boundary, refusing a read that is not whole.
 *
 * @param client the session-holding client
 * @param call the `entityInventory.ts` row
 * @param boundary the row's strict page boundary
 * @returns every admitted record and the call as made, or why the read is not whole
 */
export async function readTrelicaList<T>({
  client,
  call,
  boundary,
}: {
  client: TrelicaClient;
  call: TrelicaCall;
  boundary: TrelicaBoundary<TrelicaPage<T>>;
}): Promise<Result<{ records: readonly T[]; call: TrelicaCallResult }>> {
  const answered = await client.list({ boundary, call });
  if (answered.isErr()) {
    return err([heldTrelicaReason({ text: answered.error.message })]);
  }
  const records: T[] = [];
  const views: unknown[] = [];
  let stated = 0;
  let truncated = false;
  for (const page of answered.value.pages) {
    records.push(...page.items);
    const view = boundary.censusView({ value: page });
    views.push(...(isRecord(view) && Array.isArray(view["items"]) ? view["items"] : []));
    stated = page.total;
    truncated = truncated || page.resultsTruncated;
  }
  if (truncated) {
    return err([`${call.path} flagged a page as truncated, so the list it answered is not the whole of it`]);
  }
  if (records.length !== stated) {
    return err([`${call.path} answered ${String(records.length)} of the ${String(stated)} record(s) it stated`]);
  }
  return ok({ call: asCall({ items: views, result: answered.value }), records });
}

/**
 * Call one unpaged row that answers a single document, and admit it through its boundary.
 *
 * @param client the session-holding client
 * @param call the row
 * @param boundary the row's strict boundary
 * @returns the admitted document and the call as made, or why it was not admitted
 */
export async function readTrelicaOne<T>({
  client,
  call,
  boundary,
}: {
  client: TrelicaClient;
  call: TrelicaCall;
  boundary: TrelicaBoundary<T>;
}): Promise<Result<{ record: T; call: TrelicaCallResult }>> {
  const answered = await client.one({ boundary, call });
  if (answered.isErr()) {
    return err([heldTrelicaReason({ text: answered.error.message })]);
  }
  // `one` answers exactly the one admitted page, or an error.
  const record = answered.value.pages[0]!;
  return ok({ call: asCall({ items: [boundary.censusView({ value: record })], result: answered.value }), record });
}
