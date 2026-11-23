/**
 * The refusals the JumpCloud atlas authors around its reads rather than inside one — an unconfigured API
 * key, a kind file or channel fold built for the wrong surface, a resume journal that could not be written
 * or removed, and a generation that could not be serialised or is not fit to publish.
 *
 * Its own union rather than members of `errors.ts`'s `JumpcloudReadError`, because that one is switched
 * exhaustively by the coverage grader, and none of these is a fact about what an endpoint answered. Every
 * function raising one keeps its `readonly string[]` contract for the verbs and kit seams it hands results
 * to, so each is built here and printed through {@link jumpcloudAtlasErrorLines} where it is authored.
 *
 * No variant carries the API key or the organisation id: a configuration refusal names the SECRET, and a
 * misfiled entity is named by its stable digest id, never by anything the provider holds about a person.
 *
 * Pure: values in, values out.
 */
import { errorMessage } from "#lib/errorMessage.js";

import type { JumpcloudKind, JumpcloudSurfaceName } from "./model.js";

/** A refusal whose whole content is its sentence. */
interface Plain<C extends string> {
  readonly code: C;
  readonly message: string;
}

/** A refusal that is a list of same-shaped problems, one line each. */
interface Listed<C extends string> extends Plain<C> {
  readonly reasons: readonly string[];
}

/**
 * Every refusal the JumpCloud atlas authors outside an endpoint read.
 *
 * @internal
 */
export type JumpcloudAtlasError =
  | (Plain<"API_KEY_ABSENT"> & { readonly secretName: string })
  | (Plain<"KIND_MISFILED"> & { readonly kind: JumpcloudKind; readonly misfiledCount: number })
  | (Plain<"CHANNEL_EMPTY"> & { readonly kind: JumpcloudKind; readonly channel: JumpcloudSurfaceName })
  | (Plain<"RESUME_UNWRITABLE"> & { readonly path: string; readonly cause: unknown })
  | (Plain<"RESUME_UNREMOVABLE"> & { readonly cause: unknown })
  | (Plain<"GENERATION_UNSERIALISABLE"> & { readonly problems: readonly string[] })
  | (Listed<"GENERATION_UNPUBLISHABLE"> & { readonly problems: readonly string[] });

/** Raise each JumpCloud atlas refusal the way the real code does, so a test built from these catches a drift. */
export const JumpcloudAtlasErrors = {
  apiKeyAbsent: ({ secretName }: { secretName: string }): JumpcloudAtlasError => ({
    code: "API_KEY_ABSENT",
    message: `the JumpCloud atlas is not configured: ${secretName} is required. Set it with: slopweaver secrets set ${secretName}`,
    secretName,
  }),
  channelEmpty: ({ channel, kind }: { channel: JumpcloudSurfaceName; kind: JumpcloudKind }): JumpcloudAtlasError => ({
    channel,
    code: "CHANNEL_EMPTY",
    kind,
    message: `a ${kind} observation was folded onto the ${channel} channel while carrying nothing for it — the sync built the entity for the wrong surface`,
  }),
  kindMisfiled: ({ kind, misfiled }: { kind: JumpcloudKind; misfiled: readonly string[] }): JumpcloudAtlasError => ({
    code: "KIND_MISFILED",
    kind,
    message: `the ${kind} file this run assembled carries ${String(misfiled.length)} entity/entities of another kind: ${misfiled.slice(0, 5).join(", ")}`,
    misfiledCount: misfiled.length,
  }),
  resumeUnremovable: ({ cause }: { cause: unknown }): JumpcloudAtlasError => ({
    cause,
    code: "RESUME_UNREMOVABLE",
    message: `could not remove the JumpCloud resume journal: ${errorMessage({ error: cause })}`,
  }),
  resumeUnwritable: ({ cause, path }: { cause: unknown; path: string }): JumpcloudAtlasError => ({
    cause,
    code: "RESUME_UNWRITABLE",
    message: `could not write the JumpCloud resume journal at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
  unpublishable: ({ problems }: { problems: readonly string[] }): JumpcloudAtlasError => {
    const reasons = [...problems, "nothing was written — this generation is not published"];
    return { code: "GENERATION_UNPUBLISHABLE", message: reasons.join("; "), problems, reasons };
  },
  unserialisable: ({ problems }: { problems: readonly string[] }): JumpcloudAtlasError => ({
    code: "GENERATION_UNSERIALISABLE",
    message: `refusing the whole generation: it cannot be serialised, so nothing can say what would be written — ${problems.join("; ")}`,
    problems,
  }),
} as const;

/**
 * The lines a {@link JumpcloudAtlasError} prints, one per problem. An unpublishable generation gives each
 * incoherence its own line and then the not-published line; every other refusal is its one sentence.
 *
 * @param error the JumpCloud refusal to render, list-carrying or single-sentence
 * @returns one line per problem, in the order they were found
 */
export function jumpcloudAtlasErrorLines({ error }: { error: JumpcloudAtlasError }): readonly string[] {
  if (error.code === "GENERATION_UNPUBLISHABLE") {
    return error.reasons;
  }
  return [error.message];
}
