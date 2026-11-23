/**
 * The census assertion `atlas clerk sync` runs before it publishes — split out of `sync.ts`, whose overview
 * says why the assertion is aimed at this reader rather than at Clerk's pinned documents.
 */
import { countOf } from "#lib/collections.js";

import { CLERK_METHOD_CENSUS, CLERK_SPEC_PINS, CLERK_TOTAL_CENSUS, clerkSpecPinFor } from "./specLock.js";
import type { ClerkSpecCensus } from "./specRead.js";

/**
 * Every way this run's own numbers can disagree with what was reviewed.
 *
 * Exported so a test can drive it without 1.6 MB of documents: the numbers it checks are the whole point of
 * the verb, and a check reachable only through a network fetch is a check nothing exercises.
 *
 * Both halves are asserted — every document's own census AND the totals — because a reader that gained an
 * operation in one document and lost one in another leaves the total untouched.
 *
 * @param censuses what this run measured, one per document
 * @returns every disagreement, or `null` when the census is exactly the pinned one
 *
 * @internal
 */
export function clerkCensusMismatch({ censuses }: { censuses: readonly ClerkSpecCensus[] }): readonly string[] | null {
  const problems: string[] = [];
  const expect = ({ label, got, want }: { label: string; got: number; want: number }): void => {
    if (got !== want) {
      problems.push(`${label}: read ${String(got)}, pinned ${String(want)}`);
    }
  };
  if (censuses.length !== CLERK_SPEC_PINS.length) {
    problems.push(`documents: read ${String(censuses.length)}, pinned ${String(CLERK_SPEC_PINS.length)}`);
  }
  const methodTotals = new Map<string, number>();
  let paths = 0;
  let operations = 0;
  let schemas = 0;
  let webhookEvents = 0;
  for (const census of censuses) {
    const pin = clerkSpecPinFor({ document: census.document });
    expect({ got: census.pathCount, label: `${census.document} paths`, want: pin.pathCount });
    expect({ got: census.operationCount, label: `${census.document} operations`, want: pin.operationCount });
    expect({ got: census.schemaCount, label: `${census.document} component schemas`, want: pin.schemaCount });
    expect({ got: census.webhookEventCount, label: `${census.document} webhook events`, want: pin.webhookEventCount });
    // A method one side never counted is zero there, and every key of BOTH sides is compared, so a misspelled
    // method reads as a mismatch rather than slipping through as a zero.
    const read = new Map(Object.entries(census.methodCounts));
    const pinned = new Map(Object.entries(pin.methodCounts));
    for (const method of new Set([...pinned.keys(), ...read.keys()])) {
      expect({
        got: countOf({ counts: read, key: method }),
        label: `${census.document} ${method} operations`,
        want: countOf({ counts: pinned, key: method }),
      });
    }
    paths += census.pathCount;
    operations += census.operationCount;
    schemas += census.schemaCount;
    webhookEvents += census.webhookEventCount;
    for (const [method, count] of read) {
      methodTotals.set(method, countOf({ counts: methodTotals, key: method }) + count);
    }
  }
  expect({ got: paths, label: "total paths", want: CLERK_TOTAL_CENSUS.pathCount });
  expect({ got: operations, label: "total operations", want: CLERK_TOTAL_CENSUS.operationCount });
  expect({ got: schemas, label: "total component schemas", want: CLERK_TOTAL_CENSUS.schemaCount });
  expect({ got: webhookEvents, label: "total webhook events", want: CLERK_TOTAL_CENSUS.webhookEventCount });
  for (const [method, want] of Object.entries(CLERK_METHOD_CENSUS)) {
    expect({ got: countOf({ counts: methodTotals, key: method }), label: `${method} operations`, want });
  }
  if (problems.length === 0) {
    return null;
  }
  return [
    "the compiled census does not match the pinned one, so nothing was published",
    ...problems,
    "the documents are digest-verified before they are parsed, so this is a change in THIS reader rather than in Clerk's documents — see `sync.ts` on why that is what the assertion is for",
  ];
}
