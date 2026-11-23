/**
 * The corpus home registers: the bronze corpus, the provider atlases, the published pages, the four
 * measurement roots and the two Datadog caches — the bulk data trees the installation accumulates.
 *
 * Spread fourth into `HOME_REGISTERS` (`../homeRegisters.ts`); a new row of this category goes here.
 */
import type { HomeRegister } from "../homeRegisters.js";

/** The corpus and measurement registers, in the order `HOME_REGISTERS` reports them. */
export const CORPUS_REGISTERS: readonly HomeRegister[] = [
  {
    kind: "bronze corpus",
    measure: "walk",
    pathKey: "corpusBronze",
    relativePath: "corpus/bronze",
    shape: "directory",
    table: "content",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "provider atlases",
    measure: "walk",
    pathKey: "atlasRoot",
    relativePath: "atlas",
    shape: "directory",
    table: "atlas_entity",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "published pages",
    measure: "walk",
    pathKey: "publishedPages",
    relativePath: "published-pages",
    shape: "directory",
    table: undefined,
    tier: "durable",
    unmirroredBecause:
      "`store pages-import` carries it into the published-page tables, whose home is the store, and the folder is deleted once every reader is proven against them",
  },
  {
    kind: "bakeoff measurements",
    measure: "walk",
    pathKey: "bakeoff",
    relativePath: "bakeoff",
    rowFilter: { column: "class", value: "bakeoff" },
    shape: "directory",
    table: "measurement_location",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "datadog screenshots",
    measure: "walk",
    pathKey: "datadogShotsDir",
    relativePath: "datadog-shots",
    rowFilter: { column: "class", value: "datadog-shots" },
    shape: "directory",
    table: "measurement_location",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "evidence",
    measure: "walk",
    pathKey: "evidenceDir",
    relativePath: "evidence",
    rowFilter: { column: "class", value: "evidence" },
    shape: "directory",
    table: "measurement_location",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "proof",
    measure: "walk",
    pathKey: "proofDir",
    relativePath: "proof",
    rowFilter: { column: "class", value: "proof" },
    shape: "directory",
    table: "measurement_location",
    tier: "durable",
    unmirroredBecause: undefined,
  },
  {
    kind: "datadog hits cache",
    measure: "walk",
    pathKey: "datadogHits",
    relativePath: "datadog/hits.jsonl",
    shape: "jsonl",
    table: undefined,
    tier: "durable",
    unmirroredBecause:
      "raw Datadog events cached so a re-read costs no quota; `src/datadog/detective/hitsCache.ts` says it must " +
      "never become a store of Datadog, so no leg imports it",
  },
  {
    kind: "datadog catalogue",
    measure: "walk",
    pathKey: "datadogCatalogueRoot",
    relativePath: "datadog/catalogue",
    shape: "directory",
    table: undefined,
    tier: "durable",
    unmirroredBecause:
      "a rebuilt census of Datadog shapes whose home is a table of its own, not the measurement tables — " +
      'docs/store/fleet-state-and-measurements.md § "The measurements" names the follow-up',
  },
];
