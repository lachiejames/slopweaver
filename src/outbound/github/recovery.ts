/**
 * Where a partial `--edit` gets the form it merges into: the ledger's cached form, else the live body itself.
 *
 * ## The ledger is a CACHE here, not an authority
 *
 * Authorisation is a live authorship read-back; this module answers the narrower question of what the prior state
 * actually was. An absent or undecodable record is a cache miss, never a refusal, and the live body is parsed
 * instead.
 *
 * ## A digest match is NOT enough to trust the cached form
 *
 * `confirmPr` digests the body GitHub STORED while keeping the form slopweaver SENT. If a server ever normalises what
 * it stores, the digest still matches while the stored form no longer renders those bytes. So a cache hit requires
 * the cached form's render to be the live body's exact leading bytes, which subsumes the digest. What follows that
 * prefix must carry no markup a renderer emits — the same opaque-trailing test `./parse.ts` applies. The digest's
 * presence is still required, as the marker of a COMPLETE record.
 *
 * "Exact" is read with CRLF as LF (`./lineEndings.ts`), the one normalisation GitHub's web editor applies and the
 * parser already reads through. A byte-only prefix used to miss every CRLF body; that was harmless only while the
 * update verb PATCHed LF bytes over it on every no-op re-send. The update verb now reads that re-send as unchanged
 * and sends nothing, so a CRLF body stays CRLF, and a byte-only miss would parse it and lose every risk item below
 * the top one. The trailing region comes back with LF, the same as the parsed path hands it back.
 *
 * The cache is also the only place the risk items below the top one survive: the description publishes the top
 * item alone, so a body parsed off GitHub carries just that one.
 *
 * A body in a pre-C3 shape has no C3 preimage and is refused naming the conversion verb.
 *
 * ## Pasted media rides beside the form, never in it
 *
 * A screenshot a human pasted into the live description on github.com comes back as `pasted`, keyed by the parse
 * (`./pastedMedia.ts`), for the write to put back where it was. A pasted body tries the cache a second time with those
 * keys, so it keeps the cached risk items exactly as an unpasted body does.
 *
 * ## Non-body fields always come from the live pull request
 *
 * The body never carries `title`, `target` or `draft`, so a cached form's copies of them are only as fresh as the
 * last write. They are overlaid from the live read here, on both paths, so there is one answer rather than two.
 */
import { carriesAny, DESCRIPTION_SENTINELS } from "./bodyMarkers.js";
import { lfLineEndings } from "./lineEndings.js";
import { parsePrBody } from "./parse.js";
import { type PrRecord } from "./prLedger.js";
import { type C3PastedMediaBlock, renderPrBody } from "./render.js";
import type { PrForm, PrTarget } from "./types.js";

/**
 * Where the form to merge into came from, or why there is none.
 *
 * `trailing` is the opaque third-party region that followed the rendered description, empty when there was none. A
 * caller writing the description back re-appends it as read. A refusal carries the code of what declined, so a
 * caller can name the conversion for a pre-C3 body.
 */
export type FormRecovery =
  | {
      readonly kind: "cached";
      readonly form: PrForm;
      readonly pasted: readonly C3PastedMediaBlock[];
      readonly trailing: string;
    }
  | {
      readonly kind: "parsed";
      readonly form: PrForm;
      readonly pasted: readonly C3PastedMediaBlock[];
      readonly trailing: string;
    }
  | { readonly kind: "refused"; readonly code: string; readonly reason: string };

/** The live shell fields, which are never taken from the cache. */
type LiveShell = { readonly title: string; readonly target: PrTarget; readonly draft: boolean };

/**
 * Whether the ledger's stored form, with the media pasted into the live body put back, still renders the live body's
 * leading bytes exactly, CRLF read as LF.
 *
 * `number` is compared so a record left behind by a DIFFERENT pull request that once occupied this branch pair
 * cannot supply a form for this one.
 */
function cacheHit({
  record,
  liveBody,
  number,
  pasted,
}: {
  record: PrRecord | undefined;
  liveBody: string | undefined;
  number: number;
  pasted: readonly C3PastedMediaBlock[];
}): { form: PrForm; trailing: string } | undefined {
  if (record?.form === undefined || record.bodyHash === undefined || record.number !== number) {
    return undefined;
  }
  const rendered = renderPrBody({ form: record.form, pasted });
  if (liveBody === undefined || rendered.isErr()) {
    return undefined;
  }
  const live = lfLineEndings({ text: liveBody });
  if (!live.startsWith(rendered.value)) {
    return undefined;
  }
  const trailing = live.slice(rendered.value.length);
  if (trailing.length > 0 && carriesAny({ markers: DESCRIPTION_SENTINELS, text: trailing })) {
    return undefined;
  }
  return { form: record.form, trailing };
}

/**
 * Find the form a partial edit should merge into.
 *
 * @param record the ledger record for this pull request's locus, when there is one
 * @param liveBody the description as GitHub currently stores it
 * @param live the live title, routing fields and draft state, which always win over the cache
 * @param number the pull-request number the address resolved to
 * @returns the recovered form, where it came from, any pasted media to put back and any third-party block to
 *   re-append, or a refusal naming the remedy
 */
export function recoverPrForm({
  record,
  liveBody,
  live,
  number,
}: {
  record: PrRecord | undefined;
  liveBody: string | undefined;
  live: LiveShell;
  number: number;
}): FormRecovery {
  const shell = { draft: live.draft, target: live.target, title: live.title };
  const cached = cacheHit({ liveBody, number, pasted: [], record });
  if (cached !== undefined) {
    return { form: { ...cached.form, ...shell }, kind: "cached", pasted: [], trailing: cached.trailing };
  }
  const parsed = parsePrBody({ body: liveBody });
  if (parsed.isErr()) {
    return {
      code: parsed.error.code,
      kind: "refused",
      reason: `a partial --edit needs the description's current form to merge into, and it has none: ${parsed.error.message}`,
    };
  }
  const { body, pasted, remainder } = parsed.value;
  // Only the parse can key a paste safely, so a pasted body tries the cache a second time with the parse's keys: a
  // hit keeps the risk items below the top one, which the published body does not carry.
  const cachedPasted = pasted.length === 0 ? undefined : cacheHit({ liveBody, number, pasted, record });
  if (cachedPasted !== undefined) {
    return { form: { ...cachedPasted.form, ...shell }, kind: "cached", pasted, trailing: cachedPasted.trailing };
  }
  return { form: { ...body, ...shell }, kind: "parsed", pasted, trailing: remainder };
}
