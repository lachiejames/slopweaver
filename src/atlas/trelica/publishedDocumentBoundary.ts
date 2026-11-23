/**
 * The strict boundary every published OpenAPI document is admitted by — one schema for all four, because the
 * vendor generates all four with one tool and they share one node grammar.
 *
 * ## The node grammar is strict; the names inside it are not enumerated
 *
 * A path, a schema component, a media type and a property name are the very surface `publishedSpec.ts`
 * discovers, so each sits as a `z.record` key: Trelica adding an endpoint is the atlas learning something, and
 * must never be a refusal. What IS fixed is the key set of each node TYPE — an operation, a parameter, a
 * response, a schema — so a node growing a key this version does not know is refused and named, never read
 * around.
 *
 * MEASURED over the two documents the tenant serves (`apps`, `people`; `auth` and `flow` answer
 * 404): 22 path items, 33 operations, 80 parameters, 150 responses, 89 media types, every schema keyword below,
 * and `#/components/schemas` as the only `$ref` target. Reproduce with
 * `curl -s https://<tenant>/api/apps/docs/v1/swagger.json` and a walk of each node type's key set.
 *
 * Optionality follows the OpenAPI specification where it makes a field optional and the parse already handles
 * its absence — an operation with no `security` inherits the document's schemes, a media type with no `schema`
 * declares no fields — and the specification's REQUIRED fields are required here too.
 *
 * ## Schemas nest a fixed number of levels
 *
 * The boundary bans `z.lazy`, so a schema is declared as a finite chain: each level reads its `$ref`, its
 * `items` (the next level down) and its `properties`' NAMES. A property's own schema is never walked into by the
 * parse, so it is the all-unread node, which still fixes its keyword set. The measured `items` chain is five
 * hops deep; the last level declares no `items`, and every read `$ref` must name a component, so the parse's
 * walk never leaves what this boundary validated.
 */
import { z } from "zod";

import { defineBoundary } from "../../lib/boundary.js";

import { unreadTrelicaKeys } from "./boundaryShapes.js";

/** Every schema keyword the documents carry that the parse does not read. */
const UNREAD_SCHEMA_KEYWORDS = [
  "additionalProperties",
  "allOf",
  "default",
  "description",
  "enum",
  "format",
  "maximum",
  "minLength",
  "minimum",
  "nullable",
  "oneOf",
  "readOnly",
  "required",
  "type",
] as const;

/** A property's own schema: its keyword set is fixed, and nothing under it is read. */
const unreadSchemaNode = z.strictObject(
  unreadTrelicaKeys({ keys: [...UNREAD_SCHEMA_KEYWORDS, "$ref", "items", "properties"] }),
);

/**
 * A `$ref` the parse follows: only into the component map, which is admitted at the top level. A reference
 * anywhere else would land the walk in a subtree this boundary declares unread.
 */
const componentRef = z.string().regex(/^#\/components\/schemas\/[^/]+$/);

/**
 * The deepest schema level: its `$ref` and property names are read, and it declares no `items`, so a sixth hop
 * is refused by name rather than walked into unvalidated.
 */
const schemaLevel5 = z.strictObject({
  $ref: componentRef.optional(),
  properties: z.record(z.string(), unreadSchemaNode).optional(),
  ...unreadTrelicaKeys({ keys: UNREAD_SCHEMA_KEYWORDS }),
});

/** One schema level whose `items` are the next level down. */
function schemaLevel<I extends z.ZodType>({ items }: { items: I }) {
  return z.strictObject({
    $ref: componentRef.optional(),
    items: items.optional(),
    properties: z.record(z.string(), unreadSchemaNode).optional(),
    ...unreadTrelicaKeys({ keys: UNREAD_SCHEMA_KEYWORDS }),
  });
}

/** A top-level schema: a component, or the one a media type declares. */
const schemaLevel0 = schemaLevel({
  items: schemaLevel({ items: schemaLevel({ items: schemaLevel({ items: schemaLevel({ items: schemaLevel5 }) }) }) }),
});

/** One media type on a request or response body. */
const mediaTypeSchema = z.strictObject({
  schema: schemaLevel0.optional(),
  ...unreadTrelicaKeys({ keys: ["example"] }),
});

/** One operation: everything the parse reduces to names. */
const operationSchema = z.strictObject({
  operationId: z.string().optional(),
  parameters: z
    .array(
      z.strictObject({
        in: z.string(),
        name: z.string(),
        ...unreadTrelicaKeys({ keys: ["description", "required", "schema"] }),
      }),
    )
    .optional(),
  requestBody: z
    .strictObject({
      content: z.record(z.string(), mediaTypeSchema),
      ...unreadTrelicaKeys({ keys: ["required"] }),
    })
    .optional(),
  responses: z.record(
    z.string(),
    z.strictObject({
      content: z.record(z.string(), mediaTypeSchema).optional(),
      ...unreadTrelicaKeys({ keys: ["description"] }),
    }),
  ),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
  summary: z.string().optional(),
  ...unreadTrelicaKeys({ keys: ["description", "tags"] }),
});

/** The published document, as the vendor generates all four. */
const publishedDocumentSchema = z.strictObject({
  components: z
    .strictObject({
      schemas: z.record(z.string(), schemaLevel0).optional(),
      securitySchemes: z
        .record(
          z.string(),
          z.strictObject(unreadTrelicaKeys({ keys: ["bearerFormat", "description", "flows", "scheme", "type"] })),
        )
        .optional(),
    })
    .optional(),
  info: z.strictObject({
    title: z.string(),
    version: z.string(),
    ...unreadTrelicaKeys({ keys: ["contact", "description"] }),
  }),
  paths: z.record(
    z.string(),
    z.strictObject({
      delete: operationSchema.optional(),
      get: operationSchema.optional(),
      head: operationSchema.optional(),
      options: operationSchema.optional(),
      patch: operationSchema.optional(),
      post: operationSchema.optional(),
      put: operationSchema.optional(),
      trace: operationSchema.optional(),
    }),
  ),
  servers: z.array(z.strictObject({ url: z.string(), ...unreadTrelicaKeys({ keys: ["description"] }) })).optional(),
  ...unreadTrelicaKeys({ keys: ["openapi", "tags"] }),
});

/** One published document as admitted. */
export type TrelicaPublishedDocumentBody = z.output<typeof publishedDocumentSchema>;

/** One operation as admitted. */
export type TrelicaPublishedOperationBody = z.output<typeof operationSchema>;

/** The boundary every published document is read through, `GET /api/<document>/docs/v1/swagger.json`. */
export const trelicaPublishedDocumentBoundary = defineBoundary({
  endpoint: "GET /api/<document>/docs/v1/swagger.json",
  schema: publishedDocumentSchema,
});
