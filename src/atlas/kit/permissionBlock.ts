/**
 * A surface this credential is NOT PERMITTED to read, recorded as a fact rather than left as prose.
 *
 * Owner ruling: information that is unreachable because of permissions, and not for another reason, is
 * accounted for in the atlas setup. It is made clear that something is reachable if the owner's permissions
 * are raised but not reachable under the current ones, and it is very visible, so that an agent never has to
 * guess whether missing coverage is because the atlas is wrong or because of permissions.
 *
 * That rule is why this is a FIELD and not a sentence in `lastAttempt.reasons`. Every atlas already
 * wrote the English — JumpCloud's `stateFor` says "this administrator may not read this family", GitHub
 * raises `scopeRefused`, Cloudflare classifies a 403 as `permission-refused` — and an agent reading any of
 * them has to parse a paragraph to learn the one thing that changes what it should do. A reader now branches
 * on `permissionBlocked != null`.
 *
 * It rides the manifest's per-kind status rather than a coverage cell because the manifest is what a
 * generation vouches for, and `answerable.ts`, `atlas doctor` and the capability profile all read it.
 *
 * `unblockedBy` is the half the ruling actually asks for: not "this failed" but "this is reachable if the
 * grant named here is added". An entry that cannot name one is describing a broken read, not a boundary.
 *
 * ## Why this is its own module rather than a declaration in `./store.ts`
 *
 * MEASURED, and it is the reason for the file rather than a preference: about thirty atlas model
 * modules declare their own manifest schema, and `./store.ts` imports `../atlasFile.js`, which reaches back
 * into that tree. Declaring the schema in `store.ts` and importing it from `braze/model.ts` put
 * `atlasPermissionBlockSchema` inside an import cycle, so it evaluated as `undefined` and eight suites died
 * at load with `Cannot read properties of undefined (reading 'nullish')` while every test in them passed.
 * This module imports nothing but Zod, so no cycle can reach it.
 */
import { z } from "zod";

/** See this module's header — the one field that tells a reader "permissions", not "the atlas is wrong". */
export interface AtlasPermissionBlock {
  /** When this boundary was last observed, so a stale one is visible as stale. */
  readonly at: string;
  /** The platform's own words for the refusal — its message, its status, its scope name. */
  readonly detail: string;
  /** The named grant that would make this surface reachable: a scope, a role, a plan tier. */
  readonly unblockedBy: string;
}

/** {@link AtlasPermissionBlock}, as a schema — see this module's header for why the field exists at all. */
export const atlasPermissionBlockSchema = z
  .object({
    at: z.iso.datetime(),
    detail: z.string().min(1),
    unblockedBy: z.string().min(1),
  })
  .strict();
