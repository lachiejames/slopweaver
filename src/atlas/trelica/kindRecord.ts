/**
 * One value per Trelica atlas kind, kept apart from `model.ts` so the schema file stays one a reviewer can hold.
 */
import type { TrelicaAtlasKind } from "./model.js";

/**
 * One value per kind, spelled out so the compiler refuses a kind added to `TRELICA_ATLAS_KINDS` until it is
 * given one here.
 *
 * @param of the value for one kind
 * @returns a record holding every kind
 */
export function trelicaKindRecord<T>({ of }: { of: (kind: TrelicaAtlasKind) => T }): Record<TrelicaAtlasKind, T> {
  return {
    "access-review": of("access-review"),
    "ai-alert": of("ai-alert"),
    "ai-usage": of("ai-usage"),
    app: of("app"),
    assessment: of("assessment"),
    contract: of("contract"),
    device: of("device"),
    integration: of("integration"),
    method: of("method"),
    page: of("page"),
    person: of("person"),
    role: of("role"),
    team: of("team"),
    workflow: of("workflow"),
    "workflow-run": of("workflow-run"),
  };
}
