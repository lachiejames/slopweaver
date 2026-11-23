/**
 * Reading the Vanta atlas's policies as `policy diff` needs to see them: one flat list with no atlas
 * vocabulary on it.
 *
 * A deliberate seam rather than a convenience. Everything downstream takes {@link PolicyAtlasPolicy}, a plain
 * record a unit test builds by hand. This is the one module that knows an atlas entity has `detail` and
 * `observations`, and it is the only one a change to the atlas's own shape can reach.
 */

import { absentAsNull } from "#lib/absent.js";
import type { VantaEntity } from "../atlas/vanta/model.js";
import { readVantaKindFile, vantaAtlasPaths } from "../atlas/vanta/store.js";
import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

/**
 * One policy as the Vanta atlas holds it — the fields a review page addresses it by and no others.
 *
 * @internal
 */
export interface PolicyAtlasPolicy {
  readonly policyId: string;
  readonly name: string;
}

/** Every policy the atlas holds, read from one atlas generation. */
export interface PolicyAtlasView {
  readonly policies: readonly PolicyAtlasPolicy[];
}

/**
 * One entity's Manage-API detail.
 *
 * An atlas entity carries a detail PER CHANNEL, never one shared one — see `atlas/vanta/model.ts`. The kinds
 * read here are synced from the Manage API, so that is the channel taken, and a browser-only entity correctly
 * yields nothing here rather than a half-populated record.
 *
 * A `stale` channel yields nothing too. The atlas merge KEEPS an entity Vanta stopped listing, marked
 * `stale` with its last detail intact, so reading it as present would address a deleted policy forever.
 *
 * @param entity one stored atlas entity
 * @returns the Manage-API detail of an entity Vanta still lists, or null
 */
export function apiDetail({ entity }: { entity: VantaEntity }): unknown {
  const channel = entity.channels["manage-api"];
  if (channel?.state !== "observed") {
    return null;
  }
  return absentAsNull({ value: channel.detail });
}

/** A record field read as a non-empty string, or null when it is absent, empty or another type. */
function stringField({ record, key }: { record: Record<string, unknown>; key: string }): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** One policy entity's `detail`, reduced to its id and name. */
function policyFrom({ detail }: { detail: unknown }): PolicyAtlasPolicy | null {
  if (!isRecord(detail)) {
    return null;
  }
  const policyId = stringField({ key: "id", record: detail });
  const name = stringField({ key: "name", record: detail });
  if (policyId === null || name === null) {
    return null;
  }
  return { name, policyId };
}

/**
 * Read the policies the Vanta atlas currently holds.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns every policy Vanta still lists, or why the atlas could not be read
 */
export function readPolicyAtlasView({ home }: { home: string }): Result<PolicyAtlasView> {
  const policyFile = readVantaKindFile({ kind: "policy", paths: vantaAtlasPaths({ home }) });
  if (policyFile.isErr()) {
    return err(policyFile.error);
  }
  if (policyFile.value === null) {
    return err(["the Vanta atlas holds no policies — run: slopweaver atlas vanta sync"]);
  }
  const policies: PolicyAtlasPolicy[] = [];
  for (const entity of policyFile.value.entities) {
    const policy = policyFrom({ detail: apiDetail({ entity }) });
    if (policy !== null) {
      policies.push(policy);
    }
  }
  return ok({ policies });
}
