/**
 * The Zod schema a census row must satisfy. Pure.
 *
 * It exists because a stored file that does not hold what a census holds is a fault, and coercing it to a
 * partial one produces the confident wrong answer this whole arrangement is against — the rule
 * {@link ../detective/schema} states for the catalogue it replaces. It reads Slopweaver's OWN record, so it is
 * not a provider boundary; what Datadog answers on the unified track is `./boundaries.ts`.
 */

import { z } from "zod";

import { CENSUS_PRODUCTS } from "./product.js";

/** One attribute path and the types seen at it. */
const leafPathSchema = z.object({
  path: z.string(),
  types: z.array(z.string()).readonly(),
});

/** One allowlisted facet's kept values, or the fact that it kept none. */
const facetValuesSchema = z.object({
  distinct: z.number(),
  path: z.string(),
  values: z.array(z.string()).readonly().nullable(),
});

/** One thing counted underneath a row. */
const memberSchema = z.object({
  count: z.number(),
  name: z.string(),
});

/** One census row, as it sits on one line of the rows file. */
export const censusRowSchema = z.object({
  count: z.number().nullable(),
  countFrom: z.enum(["aggregate", "page", "none"]),
  envs: z.array(z.string()).readonly(),
  exemplars: z.number(),
  facets: z.array(facetValuesSchema).readonly(),
  firstSeenIso: z.string().nullable(),
  identity: z.string(),
  key: z.string(),
  label: z.string(),
  lastSeenIso: z.string().nullable(),
  members: z.array(memberSchema).readonly(),
  membersTruncated: z.boolean(),
  paths: z.array(leafPathSchema).readonly(),
  product: z.enum(CENSUS_PRODUCTS),
  query: z.string(),
  service: z.string(),
  statuses: z.array(z.string()).readonly(),
  template: z.string().nullable(),
});
