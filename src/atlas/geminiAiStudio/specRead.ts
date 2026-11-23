/**
 * Reading one Google API discovery document into operation rows, and nothing else.
 *
 * ## The envelope check is this atlas's integrity gate
 *
 * `specLock.ts` explains why a digest cannot be the gate here: the endpoint is live and its bytes move. What
 * replaces it is {@link geminiDiscoveryEnvelopeSchema} — the document must announce itself as
 * `discovery#restDescription`, name itself `generativelanguage`, carry the version that was asked for, an
 * eight-digit `revision`, and a `rootUrl` that is exactly the constant origin. A corrupted body, a captive
 * portal's login page, or a document for a different Google service all fail here and publish nothing.
 *
 * ## Everything kept is a NAME
 *
 * The projection is an allowlist: an HTTP method, a path template, parameter names, response field names,
 * scopes, the document's own one-line description, and the disposition this repository decided. A field
 * Google adds next month is dropped at this boundary rather than stored because nobody thought to exclude
 * it.
 *
 * ## The version segment is stripped from the path on purpose
 *
 * A discovery document writes its paths with the version in them — `v1beta/models`. The same operation
 * exists at three versions, and this atlas holds ONE entity per operation carrying all three, so a path
 * shape that embedded the version would make three rows out of one and lose the fact that they are the same
 * thing. What version an operation is published at is a FIELD on the row.
 */
import { z } from "zod";
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import {
  type DiscoveryMethod,
  discoveryParameterSchema,
  discoveryResourceSchema,
  walkDiscoveryResources,
} from "./discoveryTree.js";
import { geminiAiStudioDispositionFor } from "./dispositions.js";
import { GeminiAiStudioAtlasErrors, geminiAiStudioAtlasErrorLines } from "./errors.js";
import { GEMINI_AI_STUDIO_KINDS, type GeminiAiStudioDisposition, type GeminiAiStudioKind } from "./model.js";
import { GEMINI_AI_STUDIO_API_ORIGIN } from "./specLock.js";

/** Google stamps its discovery documents with an eight-digit date. */
const REVISION_PATTERN = /^\d{8}$/;

/**
 * The document's own envelope, which is what proves these bytes are the document at all.
 *
 * @internal
 */
export const geminiDiscoveryEnvelopeSchema = z.looseObject({
  kind: z.literal("discovery#restDescription"),
  name: z.literal("generativelanguage"),
  parameters: z.record(z.string(), discoveryParameterSchema).optional(),
  resources: z.record(z.string(), discoveryResourceSchema).optional(),
  revision: z.string().regex(REVISION_PATTERN),
  rootUrl: z.string().min(1),
  schemas: z.record(z.string(), z.looseObject({ properties: z.record(z.string(), z.unknown()).optional() })).optional(),
  version: z.string().min(1),
});

/**
 * One operation, as this atlas keeps it, before the three versions are folded together.
 *
 * @internal
 */
export interface GeminiAiStudioOperationRow {
  readonly kind: GeminiAiStudioKind;
  /** The version-independent dotted method name, e.g. `tunedModels.operations.get`. */
  readonly providerId: string;
  readonly apiVersion: string;
  readonly method: string;
  readonly operationId: string;
  /** The path template with the leading version segment removed and parameters left as placeholders. */
  readonly pathShape: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly responseSchema: string | null;
  readonly responseFields: readonly string[];
  readonly scopes: readonly string[];
  readonly summary: string | null;
  readonly hasMediaUpload: boolean;
  readonly disposition: GeminiAiStudioDisposition;
  readonly dispositionReason: string;
  readonly dispositionRuleId: string;
}

/**
 * What one document measured, which `sync.ts` compares against the reviewed census.
 *
 * @internal
 */
export interface GeminiAiStudioSpecCensus {
  readonly version: string;
  readonly revision: string;
  readonly operationCount: number;
  readonly rootCount: number;
  readonly schemaCount: number;
  readonly methodCounts: Readonly<Record<string, number>>;
}

/**
 * One document, read.
 *
 * @internal
 */
export interface GeminiAiStudioSpecSurface {
  readonly census: GeminiAiStudioSpecCensus;
  readonly rows: readonly GeminiAiStudioOperationRow[];
  /** Resource roots the document declares that this build has no kind for. A refusal, upstream. */
  readonly unknownRoots: readonly string[];
}

/**
 * Read one discovery document into operation rows.
 *
 * @param text the document's bytes as text
 * @param version the version that was asked for, which the document must agree it is
 * @returns the rows and the census, or every reason the document could not be trusted
 */
export function readGeminiAiStudioSurface({
  text,
  version,
}: {
  text: string;
  version: string;
}): Result<GeminiAiStudioSpecSurface> {
  const document = parseEnvelope({ text, version });
  if (document.isErr()) {
    return err(document.error);
  }
  return ok(walkDocument({ document: document.value }));
}

/**
 * Parse the bytes and refuse anything that is not this platform's own discovery document.
 *
 * Split from the walk because the two are different jobs and the gate is the interesting one: this is where
 * a captive portal's login page, a truncated body and a document for a different Google service all stop,
 * and `specLock.ts` explains why it carries that weight rather than a digest.
 */
function parseEnvelope({
  text,
  version,
}: {
  text: string;
  version: string;
}): Result<z.infer<typeof geminiDiscoveryEnvelopeSchema>> {
  let json: unknown;
  try {
    json = safeJsonParse({ label: `gemini ${version} discovery document`, text });
  } catch (cause: unknown) {
    return err(geminiAiStudioAtlasErrorLines({ error: GeminiAiStudioAtlasErrors.documentNotJson({ cause, version }) }));
  }
  const parsed = geminiDiscoveryEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return err(
      geminiAiStudioAtlasErrorLines({
        error: GeminiAiStudioAtlasErrors.envelopeMismatch({ issues: parsed.error.issues, version }),
      }),
    );
  }
  const document = parsed.data;
  if (document.version !== version) {
    return err(
      geminiAiStudioAtlasErrorLines({
        error: GeminiAiStudioAtlasErrors.versionMismatch({ declared: document.version, version }),
      }),
    );
  }
  if (document.rootUrl !== `${GEMINI_AI_STUDIO_API_ORIGIN}/`) {
    return err(
      geminiAiStudioAtlasErrorLines({
        error: GeminiAiStudioAtlasErrors.rootUrlMismatch({ rootUrl: document.rootUrl, version }),
      }),
    );
  }
  return ok(document);
}

/** Walk a validated document into rows and a census. Pure over what {@link parseEnvelope} accepted. */
function walkDocument({
  document,
}: {
  document: z.infer<typeof geminiDiscoveryEnvelopeSchema>;
}): GeminiAiStudioSpecSurface {
  const globalParams = globalParameterNames({ document });
  const schemas = document.schemas ?? {};
  const rows: GeminiAiStudioOperationRow[] = [];
  const unknownRoots = new Set<string>();
  const roots = new Set<string>();
  const methodCounts: Record<string, number> = {};
  walkDiscoveryResources({
    collect: ({ path, method }) => {
      // Non-null: `walkDiscoveryResources` only calls back with a path it has just pushed a segment onto.
      const rootResource = path[0]!;
      roots.add(rootResource);
      countMethod({ httpMethod: method.httpMethod.toLowerCase(), methodCounts });
      if (!isGeminiKind(rootResource)) {
        unknownRoots.add(rootResource);
        return;
      }
      rows.push(rowFor({ globalParams, kind: rootResource, method, path, schemas, version: document.version }));
    },
    resources: document.resources,
  });
  return {
    census: {
      methodCounts,
      operationCount: Object.values(methodCounts).reduce((total, count) => total + count, 0),
      revision: document.revision,
      rootCount: roots.size,
      schemaCount: Object.keys(schemas).length,
      version: document.version,
    },
    rows,
    unknownRoots: [...unknownRoots].toSorted(),
  };
}

/**
 * Whether a resource root is a kind this build publishes a file for.
 *
 * Positional by the compiler's own decision rather than by choice: TypeScript error TS1230 forbids a type
 * predicate naming a destructured binding, which `typescript-patterns.md` lists as an exemption for exactly
 * this shape.
 */
function isGeminiKind(candidate: string): candidate is GeminiAiStudioKind {
  return (GEMINI_AI_STUDIO_KINDS as readonly string[]).includes(candidate);
}

/** A map the parsed document may leave out, read as empty when it does. */
function declaredMap<T>({ map }: { map: Readonly<Record<string, T>> | undefined }): Readonly<Record<string, T>> {
  if (map == null) {
    return {};
  }
  return map;
}

/** The names of the parameters every method of the document accepts; a document declaring none has none. */
function globalParameterNames({
  document,
}: {
  document: z.infer<typeof geminiDiscoveryEnvelopeSchema>;
}): ReadonlySet<string> {
  if (document.parameters === undefined) {
    return new Set();
  }
  return new Set(Object.keys(document.parameters));
}

/** Count one more method declared with this HTTP verb; the first one the walk meets starts its tally at one. */
function countMethod({ methodCounts, httpMethod }: { methodCounts: Record<string, number>; httpMethod: string }): void {
  const counted = methodCounts[httpMethod];
  if (counted === undefined) {
    methodCounts[httpMethod] = 1;
    return;
  }
  methodCounts[httpMethod] = counted + 1;
}

/** Project one document method into a row. */
function rowFor({
  method,
  path,
  kind,
  version,
  globalParams,
  schemas,
}: {
  method: DiscoveryMethod;
  path: readonly string[];
  kind: GeminiAiStudioKind;
  version: string;
  globalParams: ReadonlySet<string>;
  schemas: Readonly<Record<string, { properties?: Record<string, unknown> | undefined }>>;
}): GeminiAiStudioOperationRow {
  // Non-null on both: `split` always yields at least one element, and `walkResources` never calls back
  // with an empty path.
  const methodName = method.id.split(".").at(-1)!;
  const providerId = `${path.join(".")}.${methodName}`;
  const httpMethod = method.httpMethod.toUpperCase();
  const decided = geminiAiStudioDispositionFor({
    input: {
      leafResource: path.at(-1)!,
      method: httpMethod,
      methodName,
      rootResource: kind,
    },
  });
  const responseSchema = unsetFieldAsNull({ key: "$ref", record: method.response });
  const declared = responseSchema === null ? undefined : schemas[responseSchema];
  return {
    apiVersion: version,
    disposition: decided.disposition,
    dispositionReason: decided.reason,
    dispositionRuleId: decided.ruleId,
    hasMediaUpload: method.supportsMediaUpload === true,
    kind,
    method: httpMethod,
    operationId: method.id,
    pathParams: requiredParameterOrder({ method }),
    pathShape: stripVersionSegment({ path: method.path, version }),
    providerId,
    queryParams: queryParameterNames({ globalParams, method }),
    responseFields: Object.keys(declaredMap({ map: declared?.properties })).toSorted(),
    responseSchema,
    scopes: declaredScopes({ method }),
    summary: firstLine({ description: method.description }),
  };
}

/** The method's required parameters in its own declared order; a method declaring no order requires none. */
function requiredParameterOrder({ method }: { method: DiscoveryMethod }): readonly string[] {
  if (method.parameterOrder === undefined) {
    return [];
  }
  return [...method.parameterOrder];
}

/** The method's own query parameters, sorted, leaving out the document-wide ones; a method declaring none has none. */
function queryParameterNames({
  method,
  globalParams,
}: {
  method: DiscoveryMethod;
  globalParams: ReadonlySet<string>;
}): readonly string[] {
  if (method.parameters === undefined) {
    return [];
  }
  return Object.entries(method.parameters)
    .filter(([name, parameter]) => parameter.location === "query" && !globalParams.has(name))
    .map(([name]) => name)
    .toSorted();
}

/** The OAuth scopes the method declares, sorted; a method declaring none names none. */
function declaredScopes({ method }: { method: DiscoveryMethod }): readonly string[] {
  if (method.scopes === undefined) {
    return [];
  }
  return [...method.scopes].toSorted();
}

/**
 * Remove the leading version segment from a path template, so the same operation at three versions folds to
 * one shape. A path that does not start with the version is returned unchanged rather than mangled.
 */
function stripVersionSegment({ path, version }: { path: string; version: string }): string {
  const prefix = `${version}/`;
  return path.startsWith(prefix) ? `/${path.slice(prefix.length)}` : path;
}

/** The document's own description, first line only, or `null` when it declares none. */
function firstLine({ description }: { description: string | undefined }): string | null {
  if (description === undefined) {
    return null;
  }
  // Non-null: `split` on a non-empty separator always yields at least one element.
  const head = description.split("\n")[0]!.trim();
  if (head === "") {
    return null;
  }
  return head;
}
