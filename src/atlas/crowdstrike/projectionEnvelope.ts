/**
 * The record envelope: what every projected CrowdStrike entity carries beyond the provider's own payload.
 *
 * An id, a provenance record, the first-seen instant and the observed state, assembled once by
 * {@link envelope} — plus the two guards every projection opens and closes with,
 * {@link requireProviderId} and {@link validate}. A projection module that skipped either would produce a
 * record with no stable identity or one `entities.ts` never saw, so they live here rather than being
 * restated per kind.
 */

import type { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import type { AtlasArtifactRef } from "../kit/contract.js";
import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";
import type { CrowdstrikeHost } from "./entities.js";
import { crowdstrikeEntityId } from "./identity.js";
import type { CrowdstrikeKind, CrowdstrikeSurface } from "./model.js";
import { readString } from "./projectionReaders.js";

/**
 * Where a record came from, in the kit's own provenance shape: what a projection knows about a payload's
 * origin before any of it is read.
 *
 * Structural rather than imported: a caller builds one inline as {@link ProjectionContext}`.source`, so
 * this name has no consumer of its own.
 *
 * @internal
 */
export interface CrowdstrikeSourceInput {
  readonly endpoint: string;
  readonly observedAt: string;
  readonly surface: CrowdstrikeSurface;
  /** A URL the PROVIDER handed back. Never one this code assembled from ids. */
  readonly deepLink?: string | null;
  readonly artifacts?: readonly AtlasArtifactRef[];
}

/**
 * Build one record's provenance.
 *
 * `deepLinkStatus` is decided by which surface produced the link, never by whether a link is present: a
 * provider that returned one is `provider-provided`, a browser walk that landed on one is
 * `browser-discovered`, and an absent link is `unverified` — "nobody has looked" — rather than
 * `unavailable`, which would claim the provider offers none.
 *
 * @param input the endpoint, instant, surface and any provider-supplied link
 * @returns the provenance record every entity carries
 *
 * @internal
 */
export function crowdstrikeSource({ input }: { input: CrowdstrikeSourceInput }): CrowdstrikeHost["source"] {
  const { artifacts = [], deepLink: link = null } = input;
  return {
    artifacts: [...artifacts],
    deepLink: link,
    deepLinkStatus: deepLinkStatusFor({ link, surface: input.surface }),
    endpoint: input.endpoint,
    observedAt: input.observedAt,
    surface: input.surface,
  };
}

/** Which of the four provenance statuses a link earns, decided by the surface that produced it. */
function deepLinkStatusFor({
  link,
  surface,
}: {
  link: string | null;
  surface: CrowdstrikeSurface;
}): CrowdstrikeHost["source"]["deepLinkStatus"] {
  if (link === null) {
    return "unverified";
  }
  if (surface === "falcon-console") {
    return "browser-discovered";
  }
  return "provider-provided";
}

/** What every projection needs beyond the provider's own payload. */
export interface ProjectionContext {
  readonly at: string;
  readonly source: CrowdstrikeSourceInput;
}

/**
 * The fields every projected entity shares, assembled once.
 *
 * @returns the id, provenance, first-seen instant and observed state every entity carries
 */
export function envelope({
  kind,
  providerId,
  context,
}: {
  kind: CrowdstrikeKind;
  providerId: string;
  context: ProjectionContext;
}): { firstSeenAt: string; id: string; providerId: string; source: CrowdstrikeHost["source"]; state: "observed" } {
  return {
    firstSeenAt: context.at,
    id: crowdstrikeEntityId({ kind, providerId }),
    providerId,
    source: crowdstrikeSource({ input: context.source }),
    state: "observed",
  };
}

/**
 * Refuse a record whose provider id is absent — the one field nothing downstream can work without.
 *
 * @returns the provider id, or a refusal naming the kind and the field that was empty
 */
export function requireProviderId({
  raw,
  field,
  kind,
}: {
  raw: unknown;
  field: string;
  kind: CrowdstrikeKind;
}): Result<string> {
  const id = readString({ field, raw });
  return id === null
    ? err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.providerIdAbsent({ field, kind }) }))
    : ok(id);
}

/**
 * Validate a projected entity against its own strict schema, naming the kind on refusal.
 *
 * @returns the parsed entity, or up to six refusals naming the kind and the offending path
 */
export function validate<TSchema extends z.ZodType>({
  candidate,
  kind,
  schema,
}: {
  candidate: unknown;
  kind: CrowdstrikeKind;
  schema: TSchema;
}): Result<z.infer<TSchema>> {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues
      .slice(0, 6)
      .map((issue) => `projected ${kind} is not storable — ${issue.path.map(String).join(".")}: ${issue.message}`),
  );
}
