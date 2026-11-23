/**
 * Folding what a browser walk saw the first-party client call into one accumulator per operation.
 *
 * Every walking atlas does exactly this and the Notion and Trelica projections had each written it: a call
 * made on two pages can return different fields on each, so the observed field set is WIDENED rather than
 * letting the last page seen win — keeping only one of those understates the surface, which is the opposite
 * of what a both-surfaces atlas exists to produce.
 *
 * `seenOn` is what turns a list of undocumented operations into something a reader can act on: an operation
 * is a LEAD, and the page it fires on is where that lead can be reproduced.
 *
 * What a platform still owns is the provider key it folds on and the detail it stores. Neither is here.
 */

/**
 * One page's worth of observed calls, as a walk hands them over.
 *
 * @internal
 */
export interface ObservedCallSource<TCall> {
  /** The declared page's own surface name — never its URL, which may carry a tenant label. */
  readonly surface: string;
  /** Where the browser settled, used as the reproduction link when there is one. */
  readonly finalUrl: string;
  readonly calls: readonly TCall[];
}

/**
 * What every page said about one operation, accumulated.
 *
 * @internal
 */
export interface ObservedOperation<TCall> {
  /** The first call seen for this operation, kept for whatever platform fields the detail needs. */
  readonly call: TCall;
  readonly callCount: number;
  /** Which declared page surfaces caused this call, sorted. */
  readonly seenOn: readonly string[];
  /** Every response field name observed across every page, widened and sorted. */
  readonly responseFields: readonly string[];
  /** Where the browser settled on the first page that made this call, or `""` when it never settled. */
  readonly deepLink: string;
}

/** The mutable accumulator, private to the fold below. */
interface Accumulator<TCall> {
  readonly call: TCall;
  readonly seenOn: Set<string>;
  readonly responseFields: Set<string>;
  readonly deepLink: string;
  callCount: number;
}

/**
 * Fold a walk's per-page calls into one accumulator per operation.
 *
 * @param pages every declared page's observation
 * @param keyOf the provider key two channels are matched on, byte-exactly
 * @param fieldsOf the response field names one call carried
 * @returns one entry per distinct operation, keyed by its provider key
 */
export function foldObservedOperations<TCall>({
  pages,
  keyOf,
  fieldsOf,
}: {
  pages: readonly ObservedCallSource<TCall>[];
  keyOf: (input: { call: TCall }) => string;
  fieldsOf: (input: { call: TCall }) => readonly string[];
}): ReadonlyMap<string, ObservedOperation<TCall>> {
  const seen = new Map<string, Accumulator<TCall>>();
  for (const page of pages) {
    for (const call of page.calls) {
      const key = keyOf({ call });
      const existing = seen.get(key);
      if (existing === undefined) {
        seen.set(key, {
          call,
          callCount: 1,
          deepLink: page.finalUrl,
          responseFields: new Set(fieldsOf({ call })),
          seenOn: new Set([page.surface]),
        });
        continue;
      }
      existing.callCount += 1;
      existing.seenOn.add(page.surface);
      for (const field of fieldsOf({ call })) {
        existing.responseFields.add(field);
      }
    }
  }
  return new Map(
    [...seen.entries()].map(([key, accumulated]) => [
      key,
      {
        call: accumulated.call,
        callCount: accumulated.callCount,
        deepLink: accumulated.deepLink,
        responseFields: [...accumulated.responseFields].toSorted(),
        seenOn: [...accumulated.seenOn].toSorted(),
      },
    ]),
  );
}
