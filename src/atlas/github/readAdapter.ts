/**
 * GitHub's projection into the kit's normalized read view.
 *
 * Reads this atlas's own strict store and reshapes it — nothing here parses JSON, repairs a generation or
 * reaches GitHub. Three mappings are this platform's own and worth stating:
 *
 * - **One observation per entity, and the surface it names is real.** Every kind is produced by exactly one
 *   surface: `rest-operation` by the compiled description, the configuration kinds by the live token,
 *   `admin-page` and `web-request` by the driven browser. The entity's own `source.surface` is what the
 *   view reports, so a reader filtering `--surface github-web` gets the browser's work and not a stamp this
 *   adapter chose.
 * - **`scope` is where the setting LIVES.** Unlike the CrowdStrike adapter, which reports the tenant because
 *   Falcon has no hierarchy above a host, GitHub genuinely does: a setting belongs to an organisation, a
 *   repository or an environment, and rendering all of them as `github` would throw away the one axis a
 *   reader most wants to filter on. So the configuration kinds report their own `scopeRef`, and the two
 *   platform-wide kinds report `github`.
 * - **`detail` is the stored record itself.** Every field already survived the projection, which reads only
 *   what the schemas declare, so the record IS the reviewed shape and handing back something else would
 *   mean storing a raw payload twice.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  type AtlasEntityView,
  type AtlasKindView,
  type AtlasReadError,
  AtlasReadErrors,
  type AtlasReadSnapshot,
  coverageCellViews,
  gapViews,
} from "../kit/read.js";
import { GITHUB_ATLAS_DESCRIPTOR } from "./descriptor.js";
import type { GithubEntity } from "./kindFiles.js";
import { GITHUB_KINDS, GITHUB_PLATFORM, GITHUB_SCHEMA_VERSION, type GithubKind } from "./model.js";
import { githubAtlasPaths, readGithubAtlas } from "./store.js";

/**
 * Where one stored entity lives in GitHub's hierarchy.
 *
 * The two platform-wide kinds have no scope of their own — a declared REST operation belongs to GitHub, not
 * to any organisation of ours — so they report the platform. Everything else carries its own.
 *
 * @param entity the stored entity
 * @returns the scope to render
 */
function scopeOf({ entity }: { entity: GithubEntity }): string {
  return "scopeRef" in entity ? entity.scopeRef : GITHUB_PLATFORM;
}

/**
 * One stored entity's observation state, narrowed from the union.
 *
 * A comparison rather than a pass-through, and the reason is a real limit rather than caution: this atlas's
 * kind-file schema is a wide `z.discriminatedUnion`, and at that width TypeScript widens the
 * inferred `state` across the arms to `string` even though every arm declares the same two-member enum. The
 * kit's view type is `"observed" | "stale"`, so the value has to be narrowed somewhere; doing it here, on
 * the one field affected, is smaller than restructuring the union and keeps the schema as the single
 * declaration of what may be stored. Every arm but one admits only these two. `code-scanning-default-setup`
 * overrides `state` with GitHub's own setup state (`configured`, say), so that kind reads `observed` unless
 * the field says `stale`.
 *
 * @param entity the stored entity
 * @returns its observation state
 */
function entityState({ entity }: { entity: GithubEntity }): "observed" | "stale" {
  return entity.state === "stale" ? "stale" : "observed";
}

/**
 * Project one stored entity into the normalized view.
 *
 * @param entity the stored entity
 * @param kind the kind whose file it came from
 * @returns its normalized view
 *
 * @internal
 */
export function githubEntityView({ entity, kind }: { entity: GithubEntity; kind: GithubKind }): AtlasEntityView {
  return {
    detail: entity,
    id: entity.id,
    kind,
    observations: [
      {
        artifacts: entity.source.artifacts,
        deepLink: entity.source.deepLink,
        deepLinkStatus: entity.source.deepLinkStatus,
        endpoint: entity.source.endpoint,
        observedAt: entity.source.observedAt,
        state: entityState({ entity }),
        surface: entity.source.surface,
      },
    ],
    providerId: entity.providerId,
    scope: scopeOf({ entity }),
  };
}

/**
 * Read the GitHub atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readGithubSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  // `stateHomePaths` owns the `$SLOPWEAVER_HOME` default; resolving it here rather than reaching for the
  // env var keeps one answer to "which home" across every verb.
  const paths = githubAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readGithubAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: GITHUB_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: GITHUB_PLATFORM,
        remedy:
          "run: slopweaver atlas github sync — it reads every organisation and repository setting through a closed read-only inventory",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = GITHUB_KINDS.map((kind: GithubKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: "rest-live" }),
      entities: file === null ? [] : file.entities.map((entity) => githubEntityView({ entity, kind })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
      publishedCount: status.entityCount,
    };
  });
  return ok({
    descriptor: GITHUB_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: GITHUB_PLATFORM,
      schemaVersion: GITHUB_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
