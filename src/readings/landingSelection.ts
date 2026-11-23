/**
 * Whether a `github landing` document was read as the owner. The readings ledger's landing producer is the Queue's and the
 * console's reading of the owner's pull requests, so a document whose own `selection` names another author, or none, is
 * refused by `recordReading` itself — every door into the ledger (`github landing --record-reading`, `reading record`,
 * `supervisor tick-capture`) passes through it. Without it a bump seat's every-author reading becomes the newest and
 * puts a colleague's pull request on the owner's Queue. The site's own copy of the predicate is
 * `site/lib/landingIsOwners.ts`, which `src/` cannot share.
 */
import { isRecord } from "#lib/parsers.js";

import { isSkipDocument, producerSlug } from "./row.js";

/** The slug the ledger files every landing reading under, however the producer was spelled. */
const LANDING_SLUG = "github-landing";

/**
 * Why a document may not be recorded under `producer`, or nothing when it may.
 *
 * Only the landing producer is judged, by slug, since `reading last` finds it by slug. A document older than the
 * `selection` field, and a cadence skip (`kind: "skipped"`, whose `selection` is a string key and which `lastReading`
 * never serves), pass; a selection object not read as `@me`, a selection of any other shape, or a document that is not
 * an object at all, is refused — the site's parser drops that malformed reading rather than drawing it.
 *
 * @param producer the producer as the caller spelled it
 * @param document the parsed document
 * @returns the refusal's reason, or `undefined` when the document may be recorded
 */
export function landingSelectionRefusal({
  producer,
  document,
}: {
  producer: string;
  document: unknown;
}): string | undefined {
  if (producerSlug({ producer }) !== LANDING_SLUG) {
    return undefined;
  }
  if (!isRecord(document)) {
    return "must be a JSON object — the page and the Queue draw nothing from any other shape";
  }
  const selection = document["selection"];
  if (selection === undefined || isSkipDocument({ document })) {
    return undefined;
  }
  if (isRecord(selection) && typeof selection["author"] === "string" && selection["author"].toLowerCase() === "@me") {
    return undefined;
  }
  return (
    "must be read with --author @me — the landing ledger is the Queue's reading of the owner's pull requests, " +
    "so anybody else's is never recorded"
  );
}
