/**
 * Where the Make atlas lives under `$SLOPWEAVER_HOME`, and what it tells the kit about its own documents.
 *
 * The generation protocol itself — kind files first, manifest last, a digest per file, every document
 * validated before the first byte is written — is `kit/store.ts`, reached through `kit/storeFacade.ts`.
 */
import { isDeepStrictEqual } from "node:util";

import type { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import type { AtlasSnapshot, AtlasStorePaths, AtlasStoreSpec } from "../kit/store.js";
import { createAtlasStore } from "../kit/storeFacade.js";

import { configuredMakeToken } from "./credential.js";
import { MAKE_STORED_DETAIL } from "./details.js";
import {
  MAKE_ATLAS_CHANNELS,
  MAKE_ATLAS_KINDS,
  MAKE_ATLAS_PLATFORM,
  MAKE_ATLAS_SCHEMA_VERSION,
  type MakeAtlasKind,
  type MakeAtlasKindFile,
  type MakeAtlasManifest,
  makeAtlasKindFileSchema,
  makeAtlasManifestSchema,
} from "./model.js";
import { redactMakeToken, redactMakeTokenDeep } from "./redact.js";

/** Every path the Make atlas owns, resolved from the one `$SLOPWEAVER_HOME` contract. */
export type MakeAtlasPaths = AtlasStorePaths<MakeAtlasKind>;

/**
 * What the Make atlas holds right now, as the reader sees it.
 *
 * @internal
 */
export type MakeAtlasSnapshot = AtlasSnapshot<MakeAtlasKind, MakeAtlasKindFile, MakeAtlasManifest>;

/**
 * Why one stored detail is off its kind's allowlist, `null` when it holds exactly what the allowlist keeps.
 * Equality after the cut is the test, not a parse alone: the schemas strip unknown keys, so a leaky detail
 * still PARSES, and only the stripped copy differing from the stored one shows a forbidden field rode in.
 *
 * @param kind the entity's kind, which names its allowlist
 * @param detail one channel's stored detail
 * @returns the reason it is refused, or `null`
 */
function offAllowlist({ kind, detail }: { kind: MakeAtlasKind; detail: unknown }): string | null {
  const cut = MAKE_STORED_DETAIL[kind].safeParse(detail);
  if (!cut.success) {
    return `its detail fails the ${kind} allowlist: ${cut.error.issues.map((issue) => issue.message).join("; ")}`;
  }
  return isDeepStrictEqual(cut.data, detail) ? null : `its detail carries a field the ${kind} allowlist does not keep`;
}

/**
 * The kind-file schema with every entity's detail held to its kind's allowlist. The kit parses each file
 * with this before it writes one and after it reads one, so the allowlist bounds the STORE — a caller of
 * {@link publishMakeAtlas} that skipped the fill's cut, or a file edited on disk, is refused rather than
 * written or served.
 */
const allowlistedKindFileSchema = makeAtlasKindFileSchema.superRefine((file, context) => {
  for (const [index, entity] of file.entities.entries()) {
    for (const channel of MAKE_ATLAS_CHANNELS) {
      const record = entity.channels[channel];
      const why = record === null ? null : offAllowlist({ detail: record.detail, kind: entity.kind });
      if (why !== null) {
        context.addIssue({
          code: "custom",
          // Named by its position, not its provider id: this message is printed, and a refusal is no place to
          // echo stored text the token strip has not reached.
          message: `make ${entity.kind} entity ${String(index)} (${channel}): ${why}`,
          path: ["entities", index, "channels", channel, "detail"],
        });
      }
    }
  }
});

/** Everything the kit needs to read, grade and publish a Make generation. */
export const MAKE_STORE_SPEC: AtlasStoreSpec<MakeAtlasKind, MakeAtlasKindFile, MakeAtlasManifest> = {
  // The fill stamps every kind on every run, a configured run with an attempt and an unconfigured one with
  // its permission block, so only a kind the manifest records neither for is a genuine half-write.
  gradeNeverSucceeded: ({ status }) => {
    if (status === null) {
      return "unpublished";
    }
    const recorded = status.lastAttempt !== null || status.permissionBlocked != null;
    return recorded ? "agrees" : "unpublished";
  },
  kinds: MAKE_ATLAS_KINDS,
  // Every kind is OWED: the fill reads each one, so none is exempt from the fail-closed default.
  kindObligations: { exceptions: {} },
  kindVolumes: { verdicts: [] },
  parseKindFile: ({ json }) => allowlistedKindFileSchema.safeParse(json),
  parseManifest: ({ json }) => makeAtlasManifestSchema.safeParse(json),
  platform: MAKE_ATLAS_PLATFORM,
  schemaVersion: MAKE_ATLAS_SCHEMA_VERSION,
  supersedeRemedy:
    "run: slopweaver atlas make reset --confirm archive — this archives the old generation and installs a fresh, empty one this build can write",
};

/**
 * Resolve every Make atlas path from the state home.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @returns the resolved paths
 */
export function makeAtlasPaths({ home }: { home: string }): MakeAtlasPaths {
  const paths = stateHomePaths({ home }).atlas.make;
  return {
    directory: paths.root,
    home,
    kinds: paths.kinds,
    manifest: paths.manifest,
    superseded: paths.superseded,
  };
}

/** Every store door this atlas opens, built once from its spec — see `kit/storeFacade.ts`. */
const STORE = createAtlasStore({ spec: MAKE_STORE_SPEC });

/**
 * Read the whole atlas, iterating the kind constant rather than the directory.
 *
 * @param paths the resolved paths
 * @returns the snapshot, or every reason it cannot be trusted
 */
export function readMakeAtlas({ paths }: { paths: MakeAtlasPaths }): Result<MakeAtlasSnapshot> {
  const token = configuredMakeToken({ home: paths.home });
  if (token.isErr()) {
    return err([token.error.message]);
  }
  return reasonsStripped({ result: STORE.snapshot({ paths }), token: token.value });
}

/**
 * A failure with the token stripped from every reason. A reason can quote stored text — a JSON parse error
 * quotes the line it choked on — and every one of them is printed, so the token is known BEFORE the store is
 * touched and stripped from whatever the store says back.
 *
 * @param result what the store answered
 * @param token the token configured now, `null` when none is
 * @returns the same answer, every failure reason passed through `redactMakeToken`
 */
function reasonsStripped<TValue>({ result, token }: { result: Result<TValue>; token: string | null }): Result<TValue> {
  if (token === null || result.isOk()) {
    return result;
  }
  return err(result.error.map((reason) => redactMakeToken({ text: reason, token })));
}

/**
 * Read the whole atlas for a reader that PRINTS it, with the token configured now stripped from every string
 * in every file and the manifest. What is stored was stripped of the token configured when it was written;
 * this covers a token rotated in since. The fill's own read stays {@link readMakeAtlas}: the publish
 * compare-and-swap needs the manifest exactly as stored.
 *
 * @param paths the resolved paths
 * @returns the stripped snapshot, or every reason it cannot be trusted or the token cannot be read
 */
export function readMakeAtlasShown({ paths }: { paths: MakeAtlasPaths }): Result<MakeAtlasSnapshot> {
  const token = configuredMakeToken({ home: paths.home });
  if (token.isErr()) {
    return err([token.error.message]);
  }
  const snapshot = reasonsStripped({ result: STORE.snapshot({ paths }), token: token.value });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  if (token.value === null) {
    return ok(snapshot.value);
  }
  const files: Record<MakeAtlasKind, MakeAtlasKindFile | null> = { ...snapshot.value.files };
  for (const kind of MAKE_ATLAS_KINDS) {
    const file = files[kind];
    if (file === null) {
      continue;
    }
    const cut = tokenStripped({ schema: makeAtlasKindFileSchema, token: token.value, value: file, what: kind });
    if (cut.isErr()) {
      return err(cut.error);
    }
    files[kind] = cut.value;
  }
  if (snapshot.value.manifest === null) {
    return ok({ ...snapshot.value, files });
  }
  const manifest = tokenStripped({
    schema: makeAtlasManifestSchema,
    token: token.value,
    value: snapshot.value.manifest,
    what: "the manifest",
  });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  return ok({ ...snapshot.value, files, manifest: manifest.value });
}

/**
 * Publish a generation: every kind file first, then the manifest, with digests stamped from the bytes
 * written.
 *
 * @param paths the resolved paths
 * @param files the kind files to write; a kind absent here is left untouched
 * @param manifest the manifest to publish
 * @param derivedFrom the manifest this generation was built over, `null` when nothing was published
 * @returns the paths written, in order, or every reason publication was refused
 */
export function publishMakeAtlas({
  paths,
  files,
  manifest,
  derivedFrom,
}: {
  paths: MakeAtlasPaths;
  files: Readonly<Partial<Record<MakeAtlasKind, MakeAtlasKindFile>>>;
  manifest: MakeAtlasManifest;
  derivedFrom: MakeAtlasManifest | null;
}): Result<readonly string[]> {
  // The one write boundary, so the token configured now is stripped here from whatever any caller hands it,
  // files and manifest alike; the client stripped the token its fill ran with, and `readMakeAtlasShown`
  // strips the one configured when it reads. What this cannot close: a string is only known to be a token
  // once it is the one in the secrets store, so with none configured there is nothing to strip, and a token
  // Make never issued to this machine is, to it, text like any other.
  const token = configuredMakeToken({ home: paths.home });
  if (token.isErr()) {
    return err([token.error.message]);
  }
  if (token.value === null) {
    return STORE.publish({ derivedFrom, files, manifest, paths });
  }
  const stripped: Partial<Record<MakeAtlasKind, MakeAtlasKindFile>> = {};
  for (const kind of MAKE_ATLAS_KINDS) {
    const file = files[kind];
    if (file === undefined) {
      continue;
    }
    const cut = tokenStripped({ schema: makeAtlasKindFileSchema, token: token.value, value: file, what: kind });
    if (cut.isErr()) {
      return err(cut.error);
    }
    stripped[kind] = cut.value;
  }
  const strippedManifest = tokenStripped({
    schema: makeAtlasManifestSchema,
    token: token.value,
    value: manifest,
    what: "the manifest",
  });
  if (strippedManifest.isErr()) {
    return err(strippedManifest.error);
  }
  return reasonsStripped({
    result: STORE.publish({ derivedFrom, files: stripped, manifest: strippedManifest.value, paths }),
    token: token.value,
  });
}

/**
 * One stored document with the token stripped from every string in it — details, provider ids, gaps,
 * attempt reasons, all of it — and parsed back to its own schema, so a string the strip changed cannot slip
 * a malformed document through.
 *
 * @param value a kind file or the manifest
 * @param schema the document's own schema
 * @param token the token configured now
 * @param what the document, as a refusal names it
 * @returns the stripped document, or why it no longer parses as one
 */
function tokenStripped<TDocument>({
  value,
  schema,
  token,
  what,
}: {
  value: TDocument;
  schema: z.ZodType<TDocument>;
  token: string;
  what: string;
}): Result<TDocument> {
  const parsed = schema.safeParse(redactMakeTokenDeep({ token, value }));
  if (!parsed.success) {
    return err([
      `make ${what}: with the token stripped it no longer parses — ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    ]);
  }
  return ok(parsed.data);
}
