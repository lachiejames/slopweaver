/**
 * Folding every published document's declaration of ONE operation into the single detail its entity carries.
 *
 * Two documents declaring one operation is the vendor's editorial choice rather than a defect (`model.ts`'s
 * published detail says why), so the projection folds them instead of minting two entities with one id. The
 * fold is pure and lives here so each of its two arms — the first document to declare an operation, and every
 * later one — is a branch a test can name.
 */
import type { TrelicaMethodPublishedDetail } from "./model.js";
import type { TrelicaPublishedDocumentSurface } from "./publishedSpec.js";

/** One operation one published document declares, reduced to names. */
type TrelicaPublishedDeclaration = TrelicaPublishedDocumentSurface["operations"][number];

/** Every name either list carries, once each, sorted, so the fold's output never depends on document order. */
function sortedUnion({ held, added }: { held: readonly string[]; added: readonly string[] }): string[] {
  return [...new Set([...held, ...added])].toSorted();
}

/**
 * The `operationId` or `summary` the fold keeps. OpenAPI makes both optional, so each declaring document may
 * give or omit it: an earlier document's stands, and a later one supplies it only where every earlier
 * document declared none.
 */
function firstDeclaredName({
  held,
  declaration,
  key,
}: {
  held: TrelicaMethodPublishedDetail;
  declaration: TrelicaPublishedDeclaration;
  key: "operationId" | "summary";
}): string | null {
  const earlier = held[key];
  if (earlier === null) {
    return declaration[key];
  }
  return earlier;
}

/**
 * Fold one document's declaration of an operation onto what earlier documents in this run already declared.
 *
 * @param held what earlier documents declared for this operation, or `undefined` when this is the first
 *   document in this run to declare it — a first sighting, never a missing record
 * @param declaration this document's own declaration
 * @returns the folded detail: every name list unioned and sorted, the earlier document's `operationId` and
 *   `summary` kept where it declared them
 */
export function foldTrelicaPublishedDeclaration({
  held,
  declaration,
}: {
  held: TrelicaMethodPublishedDetail | undefined;
  declaration: TrelicaPublishedDeclaration;
}): TrelicaMethodPublishedDetail {
  if (held === undefined) {
    return {
      bodyParams: sortedUnion({ added: declaration.bodyParams, held: [] }),
      documents: [declaration.document],
      operationId: declaration.operationId,
      pathParams: sortedUnion({ added: declaration.pathParams, held: [] }),
      queryParams: sortedUnion({ added: declaration.queryParams, held: [] }),
      responseFields: sortedUnion({ added: declaration.responseFields, held: [] }),
      security: sortedUnion({ added: declaration.security, held: [] }),
      summary: declaration.summary,
    };
  }
  return {
    bodyParams: sortedUnion({ added: declaration.bodyParams, held: held.bodyParams }),
    documents: sortedUnion({ added: [declaration.document], held: held.documents }),
    operationId: firstDeclaredName({ declaration, held, key: "operationId" }),
    pathParams: sortedUnion({ added: declaration.pathParams, held: held.pathParams }),
    queryParams: sortedUnion({ added: declaration.queryParams, held: held.queryParams }),
    responseFields: sortedUnion({ added: declaration.responseFields, held: held.responseFields }),
    security: sortedUnion({ added: declaration.security, held: held.security }),
    summary: firstDeclaredName({ declaration, held, key: "summary" }),
  };
}
