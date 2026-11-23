/**
 * Why one digest citation cannot be photographed — `./digestShots.ts`'s `timeseriesViewOf` refusals.
 *
 * Each lands as one `no shot` line under a seated digest row, so a caller only ever DISPLAYS `message`; the
 * `code` is what a test names, and what tells the three apart without reading prose.
 */

/** The citation does not parse as an address at all. */
export interface CitationNotAnAddressError {
  readonly code: "CITATION_NOT_AN_ADDRESS";
  readonly message: string;
  readonly citationUrl: string;
}

/** The citation points at a console area no capture adapter covers. */
export interface CitationViewUncoveredError {
  readonly code: "CITATION_VIEW_UNCOVERED";
  readonly message: string;
  readonly citationUrl: string;
  readonly pathname: string;
}

/**
 * The citation is a logs view whose row is not a log-line count — a `logs-facet-sum` probe's sum — while the
 * adapter's summary counts log lines, so no capture of it can reconcile with the row.
 */
export interface CitationNotACountError {
  readonly code: "CITATION_NOT_A_COUNT";
  readonly message: string;
  readonly citationUrl: string;
  /** The citation's own `agg_t`, e.g. `sum`. */
  readonly aggregation: string;
  /** The citation's own `agg_m`, e.g. `@violations`, or `null` when it names none. */
  readonly measure: string | null;
}

/** Every reason one citation takes no picture. */
export type DigestShotViewError = CitationNotAnAddressError | CitationViewUncoveredError | CitationNotACountError;

/**
 * Construct one {@link DigestShotViewError}. Tests build fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const DigestShotViewErrors = {
  notACount: ({
    citationUrl,
    aggregation,
    measure,
  }: {
    readonly citationUrl: string;
    readonly aggregation: string;
    readonly measure: string | null;
  }): CitationNotACountError => {
    let measured = "an unnamed measure";
    if (measure !== null && measure !== "") {
      measured = measure;
    }
    return {
      aggregation,
      citationUrl,
      code: "CITATION_NOT_A_COUNT",
      measure,
      message:
        `citation '${citationUrl}' takes the ${aggregation} of ${measured}, and the capture adapter's summary ` +
        "counts log lines — no picture of it can reconcile with the row, so the card keeps its link and takes none",
    };
  },
  notAnAddress: ({ citationUrl }: { readonly citationUrl: string }): CitationNotAnAddressError => ({
    citationUrl,
    code: "CITATION_NOT_AN_ADDRESS",
    message: `citation '${citationUrl}' is not an address, so there is no view to photograph`,
  }),
  viewUncovered: ({
    citationUrl,
    pathname,
    covered,
  }: {
    readonly citationUrl: string;
    readonly pathname: string;
    readonly covered: readonly string[];
  }): CitationViewUncoveredError => ({
    citationUrl,
    code: "CITATION_VIEW_UNCOVERED",
    message:
      `citation '${citationUrl}' points at ${pathname}, and the capture adapters cover ` +
      `${covered.join(", ")} — the card keeps its link and takes no picture for this item`,
    pathname,
  }),
} as const;
