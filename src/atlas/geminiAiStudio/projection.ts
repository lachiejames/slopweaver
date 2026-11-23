/**
 * Turning a folded operation into a stored entity.
 *
 * ## The projection is an ALLOWLIST, and every field it keeps is a name
 *
 * Nothing from the discovery documents reaches disk except through the fields named here — an HTTP method, a
 * path template, parameter names, response field names, scopes, Google's own method id and one-line
 * description, and the disposition this repository decided. A field Google adds next month is dropped at
 * this boundary rather than stored because nobody thought to exclude it, which is the same posture
 * `onepassword/model.ts` takes and deliberately unlike the Vanta atlas's wholesale payload.
 *
 * There is no sensitivity gate here and there does not need to be one. The 1Password and JumpCloud atlases
 * need theirs because their responses carry secrets; this channel calls nothing and reads a public document,
 * so the strongest claim available — nothing here is a value at all — is a property of the input rather than
 * of a filter. A live channel would need one, and for a specific reason: `auth_tokens.create` mints an
 * ephemeral token and `files` responses carry signed URIs.
 *
 * ## The deep link is per KIND, and it is honest about being one
 *
 * A discovery document publishes no console address for an operation, so a per-operation link would have to
 * be constructed — which is inventing a link rather than knowing one. {@link geminiAiStudioConsoleLinkFor}
 * maps a kind to the AI Studio page that governs it, hand-written from that product's own navigation, and a
 * kind with no such page gets a null link with `deepLinkStatus: "unavailable"`. That distinction is the
 * whole point of the kit's contract: "the provider offers none" and "nobody has looked" must not read the
 * same.
 */
import { geminiAiStudioEntityId } from "./identity.js";
import type { GeminiAiStudioAtlasEntity, GeminiAiStudioKind, GeminiAiStudioOperationCompiledDetail } from "./model.js";
import { GEMINI_AI_STUDIO_API_ORIGIN } from "./specLock.js";
import type { GeminiAiStudioFoldedOperation } from "./versions.js";

/**
 * The AI Studio page that governs each kind, or `null` where the product publishes none.
 *
 * Hand-written from AI Studio's own navigation and deliberately incomplete: `media`, `dynamic`,
 * `environments`, `auth_tokens`, `cachedContents`, `corpora`, `fileSearchStores` and `generatedFiles` have
 * no page of their own that this atlas can name, and a constructed link would be a guess presented as
 * provenance. Every one of those declares `unavailable` rather than an invented address, and a walk of
 * `browserPages.ts` is what would replace a belief here with a measurement.
 */
const GEMINI_AI_STUDIO_KIND_PAGES: Readonly<Partial<Record<GeminiAiStudioKind, string>>> = {
  batches: "/batch",
  files: "/library",
  models: "/prompts/new_chat",
  operations: "/batch",
  tunedModels: "/tune",
};

/**
 * The AI Studio page a reader opens to see one kind, when the product publishes one.
 *
 * @param kind the kind an operation belongs to
 * @returns the absolute URL, or `null` when AI Studio publishes no page this atlas can name for it
 */
export function geminiAiStudioConsoleLinkFor({ kind }: { kind: GeminiAiStudioKind }): string | null {
  const path = GEMINI_AI_STUDIO_KIND_PAGES[kind];
  return path === undefined ? null : `https://aistudio.google.com${path}`;
}

/**
 * Project one folded operation into an entity carrying only the `compiled` channel.
 *
 * @param operation the operation as the published documents declare it
 * @param at this run's ISO timestamp
 * @returns the entity, with `api` and `browser` left null because neither has looked
 *
 * @internal
 */
export function projectGeminiAiStudioOperation({
  operation,
  at,
}: {
  operation: GeminiAiStudioFoldedOperation;
  at: string;
}): GeminiAiStudioAtlasEntity {
  const detail: GeminiAiStudioOperationCompiledDetail = {
    apiVersions: [...operation.apiVersions],
    disposition: operation.disposition,
    dispositionReason: operation.dispositionReason,
    hasMediaUpload: operation.hasMediaUpload,
    method: operation.method,
    operationId: operation.operationId,
    pathParams: [...operation.pathParams],
    pathShape: operation.pathShape,
    queryParams: [...operation.queryParams],
    responseFields: [...operation.responseFields],
    responseSchema: operation.responseSchema,
    scopes: [...operation.scopes],
    summary: operation.summary,
  };
  const deepLink = geminiAiStudioConsoleLinkFor({ kind: operation.kind });
  // The newest declaring version, which is the one whose scalar values the folded row carries. Non-null:
  // `apiVersions` is `.min(1)` on the stored schema and is built by `versions.ts` from a non-empty group.
  const newest = operation.apiVersions[operation.apiVersions.length - 1]!;
  return {
    channels: {
      api: null,
      browser: null,
      compiled: {
        channel: "compiled",
        detail,
        firstSeenAt: at,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "compiled",
          deepLink,
          deepLinkStatus: deepLink === null ? "unavailable" : "provider-provided",
          endpoint: `${GEMINI_AI_STUDIO_API_ORIGIN}/${newest}${operation.pathShape}`,
          observedAt: at,
        },
        state: "observed",
      },
    },
    id: geminiAiStudioEntityId({ kind: operation.kind, providerId: operation.providerId }),
    kind: operation.kind,
    providerId: operation.providerId,
  };
}

/**
 * Project every folded operation for one kind.
 *
 * @param operations this kind's operations, folded across versions
 * @param at this run's ISO timestamp
 * @returns the entities, in the order the operations arrived
 */
export function projectGeminiAiStudioOperations({
  operations,
  at,
}: {
  operations: readonly GeminiAiStudioFoldedOperation[];
  at: string;
}): readonly GeminiAiStudioAtlasEntity[] {
  return operations.map((operation) => projectGeminiAiStudioOperation({ at, operation }));
}
