/**
 * The per-source facts beyond list membership that ingesting integrations declare on their corpus row: which ones
 * report progress under their own phase prefix, and what refresh's missing-token refusal tells the reader to set.
 *
 * Held apart from `./corpusSources.ts` because those are the corpus source LISTS, typed by the members each was
 * filtered to and frozen as non-empty tuples, while these are a set membership test and a per-source string. Each
 * is derived here once, from the manifests, so a new ingesting integration is its manifest and nothing else.
 */
import type { TokenedSource } from "./corpusSources.js";
import type { CorpusIntegrationMetadata, IntegrationManifest } from "./manifest.js";
import { registeredIntegrations } from "./registry.js";

/** What one set of manifests derives here. */
interface DerivedCorpusProjections {
  /** The sources whose fetch reports progress under phases that open with the source's own id, in ordinal order. */
  readonly progressPhases: readonly string[];
  /** The exact missing-token hint each token-gated source declares, keyed by source id. */
  readonly missingTokenHints: ReadonlyMap<string, string>;
}

/**
 * The progress-phase sources and the missing-token hints, derived from the given manifests.
 *
 * Takes the manifests rather than reading the registry, so a test can add a fixture integration and watch it appear;
 * production passes {@link registeredIntegrations}.
 *
 * @param manifests the integrations to derive from, in any order — the phase list is ordered by corpus ordinal
 * @returns the frozen progress-phase list and the hint per token-gated source
 */
export function corpusProjectionsOf({
  manifests,
}: {
  manifests: readonly IntegrationManifest[];
}): DerivedCorpusProjections {
  const ingesting = manifests
    .flatMap((manifest): { corpus: CorpusIntegrationMetadata; id: string }[] =>
      manifest.corpus === undefined ? [] : [{ corpus: manifest.corpus, id: manifest.id }],
    )
    .toSorted((left, right) => left.corpus.ordinal - right.corpus.ordinal);
  const progressPhases = ingesting.filter((row) => row.corpus.progressPhase).map((row) => row.id);
  Object.freeze(progressPhases);
  const missingTokenHints = new Map<string, string>();
  for (const { corpus, id } of ingesting) {
    if (corpus.upfrontTokenGate) {
      missingTokenHints.set(id, corpus.missingTokenHint);
    }
  }
  return { missingTokenHints, progressPhases };
}

/** The production derivation, once. */
const DERIVED: DerivedCorpusProjections = corpusProjectionsOf({ manifests: registeredIntegrations() });

/**
 * The sources whose phase strings (`slack.channel`, `github.repos`, …) carry a leading source token: every ingesting
 * integration whose manifest says `progressPhase`.
 */
export const PROGRESS_PHASE_SOURCES: readonly string[] = DERIVED.progressPhases;

/**
 * What refresh's missing-token refusal tells the reader to set for one token-gated source, word for word as its
 * manifest declares it.
 *
 * @param source a source `refresh` refuses up front when its token is unset
 * @returns the hint naming the env var(s) or store file to set
 */
export function missingTokenHintFor({ source }: { source: TokenedSource }): string {
  const hint = DERIVED.missingTokenHints.get(source);
  if (hint === undefined) {
    // An invariant, not a runtime branch: `upfrontTokenGate: true` does not compile without `missingTokenHint`, and
    // `TokenedSource` is derived from exactly those rows.
    throw new Error(`${source} is token-gated but no manifest declares its missing-token hint`);
  }
  return hint;
}
