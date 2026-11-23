/**
 * The Zod schemas a catalogue file must satisfy to be read back. Pure.
 *
 * ## Why a schema rather than a cast
 *
 * The same rule `src/datadog/rawRequest.ts` states for a Datadog response, applied to this package's own
 * file: a document that does not contain what a catalogue contains is a FAULT, and coercing it to an empty
 * or partial catalogue is the confident wrong answer the whole arrangement is against. A cast would make a
 * hand-edited manifest, a half-written file or a document from a previous schema version read as valid and
 * then fail somewhere further away, with a message about a missing property rather than about the file.
 *
 * The schemas are declared beside the interfaces rather than derived from them (`z.infer`) because the
 * interfaces are the contract a reader reads and a `z.infer` alias would hide it behind a runtime value.
 * The cost is that the two can drift, and {@link ../../__tests__/unit/datadog/detective/store.test.ts} is
 * what catches that: it round-trips a fully-populated value of each interface through its own schema, so a
 * field added to one and not the other fails rather than silently disappearing from what is stored.
 *
 * The ROW schema itself lives in {@link ../census/schema}, beside the type it pins.
 */

import { z } from "zod";

import { CENSUS_PRODUCTS } from "../census/product.js";
import { SHAPE_FAMILIES } from "./family.js";

/** The service map, as the manifest carries it. */
const serviceMapSchema = z.object({
  dashboards: z.array(z.object({ id: z.string(), title: z.string() })).readonly(),
  edges: z.array(z.object({ operation: z.string(), service: z.string(), spans: z.number() })).readonly(),
  entities: z.array(z.object({ kind: z.string(), name: z.string(), owner: z.string().nullable() })).readonly(),
  indexes: z.array(z.object({ name: z.string(), retentionDays: z.number().nullable() })).readonly(),
  metricNamespaces: z.array(z.object({ names: z.number(), namespace: z.string() })).readonly(),
  monitors: z.array(z.object({ id: z.number(), name: z.string(), query: z.string(), type: z.string() })).readonly(),
  pipelines: z.array(z.object({ enabled: z.boolean(), id: z.string(), name: z.string() })).readonly(),
  rumApplications: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })).readonly(),
});

/** The manifest, as it sits in its own file. */
export const catalogueManifestSchema = z.object({
  builtAtIso: z.string(),
  map: serviceMapSchema,
  notMeasured: z.array(z.string()).readonly(),
  products: z
    .array(
      z.object({
        exemplified: z.number(),
        notMeasured: z.array(z.string()).readonly(),
        product: z.enum(CENSUS_PRODUCTS),
        rows: z.number(),
      }),
    )
    .readonly(),
  retentionDays: z.number().nullable(),
  rows: z.number(),
  schemaVersion: z.number(),
  services: z.array(z.object({ events: z.number(), product: z.enum(CENSUS_PRODUCTS), service: z.string() })).readonly(),
  site: z.string(),
  window: z.object({ fromIso: z.string(), toIso: z.string() }),
});

/**
 * One cached Datadog event, as it sits on one line of the hits cache.
 *
 * `attributes` is `z.unknown()` on purpose: it is Datadog's own tree, its shape differs per surface and per
 * service, and a schema that named its fields would refuse exactly the events this repository has not seen
 * yet — which is every event worth investigating. What the schema pins is the ENVELOPE, which this package
 * writes and therefore controls.
 */
export const datadogRecordSchema = z.object({
  attributes: z.unknown(),
  env: z.string(),
  family: z.enum(SHAPE_FAMILIES),
  id: z.string(),
  link: z.string(),
  occurredAtIso: z.string(),
  service: z.string(),
  status: z.string().nullable(),
  text: z.string(),
});
