/**
 * Which disposition each Chronicle v1 method takes, and the rules that decide it.
 *
 * ## READ-ONLY FOREVER, so the HTTP method decides before anything else does
 *
 * The owner's constraint on this atlas is that every request it ever sends is a `GET`. So the first rule
 * is not a judgement about what a method does, it is the wire: **every non-GET is `excluded`**, whatever
 * it reads. Contrast `googleAdmin/dispositions.ts`, whose `NON_GET_READ_VERDICTS` table promotes three
 * POST reads to entities. There is deliberately no such table here — a POST search, a batch get or a text
 * verification is still excluded, and the only thing a rule decides for it is which of the two reasons
 * the row carries. Misfiling a write as a `query` cannot make it callable; both reasons mean never called.
 *
 * ## Why the scope cannot decide it, measured
 *
 * The tempting computable rule is "a method granted `chronicle.readonly` is a read". On the pin in
 * `generated/protoLock.ts`, `chronicle_v1.yaml` grants `chronicle.readonly` to whole services through
 * `Service.*` selectors — `DataTableService.*`, `FeedsService.*`, `NativeDashboardService.*` and others —
 * so `CreateDataTable`, `DeleteFeed`, `GenerateSecret` and every other write in those services is granted
 * the readonly scope too. The vendor's scope name says nothing about the method; the GET does.
 *
 * ## GETs: `List*` and `Get*` are entities, anything else is named or refused
 *
 * A GET whose rpc verb is `List` or `Get` is a resource read under the instance. A GET with any other
 * verb is a custom method — AIP-136 — and is an entity only when {@link GET_CUSTOM_READS} names it with a
 * reason; an unnamed one is `DISPOSITION_UNDECIDED`, so a new custom GET Google publishes fails the
 * generator until somebody has read what it returns.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type GoogleSecopsInventoryError, GoogleSecopsInventoryErrors } from "./errors.js";
import type { GoogleSecopsDisposition, GoogleSecopsExclusionReason, GoogleSecopsHttpMethod } from "./surfaceRow.js";

/**
 * What the disposition rule decided for one method, and why.
 * @internal
 */
export interface GoogleSecopsDispositionVerdict {
  readonly disposition: GoogleSecopsDisposition;
  readonly dispositionBecause: string;
  /** Which refusal applied. `null` unless the disposition is `excluded`. */
  readonly exclusionReason: GoogleSecopsExclusionReason | null;
}

/** The rpc verbs that make a GET a plain resource read. */
const RESOURCE_READ_VERBS: readonly string[] = ["Get", "List"];

/**
 * GETs with a custom verb that nonetheless only read a resource, keyed on the fully qualified method.
 *
 * Asserted live against the inventory by the generator, so an entry naming a method Google renamed fails
 * the run instead of silently matching nothing.
 */
const GET_CUSTOM_READS: Readonly<Record<string, string>> = {
  "google.cloud.chronicle.v1.FeedsService.FetchServiceAccountForCustomer":
    "a custom GET that returns the Google service account Chronicle ingests Cloud Storage feeds as — instance configuration, read without a body",
};

/**
 * The rpc verbs whose POST only reads: a batch or bulk get, a computed summary, a query, a search, or a
 * validation of text the caller supplies. Every one is still excluded — see the header.
 */
const QUERY_VERBS: readonly string[] = [
  "BatchGet",
  "BulkGet",
  "Compute",
  "Execute",
  "Fetch",
  "Query",
  "Search",
  "Verify",
];

/** What each exclusion says, so a row explains itself without a reader opening this file. */
const EXCLUSION_PROSE: Readonly<Record<GoogleSecopsExclusionReason, string>> = {
  mutating:
    "it is not a GET and its verb names no read, so it is taken to change the instance — this atlas is read-only forever and only ever sends GET",
  query:
    "it only reads, but it is a POST whose request carries a body — read-only forever means the door sends GET alone, so a POST read is never called",
};

/** Why a plain GET resource read is an entity. */
const RESOURCE_READ_PROSE = "a GET List/Get read of a resource under the instance";

/**
 * Whether an rpc name begins with one of these verbs at a word boundary, so `Getaway` is not `Get`.
 *
 * @param rpc the bare rpc name
 * @param verbs the verbs to test
 * @returns true when the rpc opens with one of them followed by an upper-case letter or nothing
 */
function opensWith({ rpc, verbs }: { rpc: string; verbs: readonly string[] }): boolean {
  return verbs.some((verb) => rpc.startsWith(verb) && /^(?:[A-Z]|$)/u.test(rpc.slice(verb.length)));
}

/**
 * Decide what this atlas does with one Chronicle method.
 *
 * @param httpMethod the binding's REST method, which decides before anything else
 * @param id the fully qualified method, which {@link GET_CUSTOM_READS} is keyed on
 * @param rpc the bare rpc name, whose leading verb decides the rest
 * @returns the verdict, or `DISPOSITION_UNDECIDED` for a custom GET nobody has judged
 */
export function googleSecopsDispositionFor({
  httpMethod,
  id,
  rpc,
}: {
  httpMethod: GoogleSecopsHttpMethod;
  id: string;
  rpc: string;
}): Result<GoogleSecopsDispositionVerdict, GoogleSecopsInventoryError> {
  if (httpMethod !== "GET") {
    const reason: GoogleSecopsExclusionReason = opensWith({ rpc, verbs: QUERY_VERBS }) ? "query" : "mutating";
    return ok({ disposition: "excluded", dispositionBecause: EXCLUSION_PROSE[reason], exclusionReason: reason });
  }
  if (opensWith({ rpc, verbs: RESOURCE_READ_VERBS })) {
    return ok({ disposition: "entity", dispositionBecause: RESOURCE_READ_PROSE, exclusionReason: null });
  }
  const customRead = GET_CUSTOM_READS[id];
  if (customRead === undefined) {
    return err(GoogleSecopsInventoryErrors.dispositionUndecided({ method: id }));
  }
  return ok({ disposition: "entity", dispositionBecause: customRead, exclusionReason: null });
}

/**
 * Every custom GET this atlas judged a read, for the generator to assert none of them went stale.
 *
 * @returns the fully qualified methods, sorted
 */
export function googleSecopsCustomGetReads(): readonly string[] {
  return Object.keys(GET_CUSTOM_READS).toSorted();
}
