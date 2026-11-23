/**
 * Where an audit-log pull lands: one GENERATION directory per pull under `$SLOPWEAVER_HOME/atlas/gcp-audit/`,
 * holding `entries.jsonl`, `roles.jsonl` and `manifest.json`.
 *
 * `manifest.json` is written LAST, atomically, and is the completion marker: a directory without one is a
 * pull that stopped part-way, and nothing reads it as an empty success. Entries stream to disk as each page
 * arrives, so a long pull never holds its history in one string. Directories are `0700` and files `0600`:
 * the evidence carries caller IPs and resource names, which is state outside the codebase, never git.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { writeAll, writeFileAtomic, writeFileAtomicStream } from "#lib/writeAtomic.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { stateHomePaths } from "../stateHome.js";
import { type GcpAuditError, GcpAuditErrors } from "./errors.js";
import type { TrimmedGcpAuditEntry } from "./trim.js";

/** The directory every generation sits under. */
const STORE_NAME = "gcp-audit";

/** Private: the evidence names the owner's IPs and every resource they touched. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** A generation id: the pull's UTC instant, filesystem-safe, plus a random suffix. */
const GENERATION_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

/** One logging bucket's retention, as observed at pull time. */
const bucketFact = z.strictObject({
  analyticsEnabled: z.boolean().nullable(),
  container: z.string(),
  lifecycleState: z.string().nullable(),
  locked: z.boolean().nullable(),
  name: z.string(),
  retentionDays: z.number().nullable(),
});

/** One log sink: where a copy of matching entries is routed, which this reader does NOT read. */
const sinkFact = z.strictObject({
  container: z.string(),
  destination: z.string(),
  disabled: z.boolean().nullable(),
  filter: z.string().nullable(),
  includeChildren: z.boolean().nullable(),
  interceptChildren: z.boolean().nullable(),
  name: z.string(),
});

/** One service's audit-log configuration on an allow policy. */
const auditConfigFact = z.strictObject({
  logTypes: z.array(z.string()),
  resource: z.string(),
  service: z.string(),
});

/** One cached role's facts; its permissions sit in `roles.jsonl`. */
const roleFact = z.strictObject({
  deleted: z.boolean().nullable(),
  etag: z.string().nullable(),
  name: z.string(),
  permissionCount: z.number(),
  stage: z.string().nullable(),
  title: z.string().nullable(),
});

/** Something the pull asked for and Google refused, kept so a gap is visible rather than read as a zero. */
const refusalFact = z.strictObject({
  message: z.string(),
  status: z.number().nullable(),
  what: z.string(),
});

/** One `entries:list` batch's outcome. */
const batchFact = z.strictObject({
  entries: z.number(),
  pages: z.number(),
  resourceCount: z.number(),
});

/** The manifest schema, version 1. */
const manifestSchema = z.strictObject({
  auditConfigs: z.array(auditConfigFact),
  batches: z.array(batchFact),
  buckets: z.array(bucketFact),
  containers: z.strictObject({ folders: z.number(), organizations: z.number(), projects: z.number() }),
  coverage: z.enum(["complete", "partial"]),
  entriesWritten: z.number(),
  gaps: z.array(z.string()),
  generation: z.string(),
  org: z.string(),
  principals: z.union([z.array(z.string()), z.literal("all")]),
  pulledAtIso: z.string(),
  quotaProject: z.string(),
  refusals: z.strictObject({
    buckets: z.array(refusalFact),
    discovery: z.array(refusalFact),
    entries: z.array(refusalFact),
    policies: z.array(refusalFact),
    roles: z.array(refusalFact),
    sinks: z.array(refusalFact),
  }),
  roles: z.array(roleFact),
  schemaVersion: z.literal(1),
  since: z.string(),
  sinks: z.array(sinkFact),
});

/** A completed pull's manifest. */
export type GcpAuditManifest = z.output<typeof manifestSchema>;

/** One logging bucket's retention fact. */
export type GcpBucketFact = z.output<typeof bucketFact>;

/** One sink fact. */
export type GcpSinkFact = z.output<typeof sinkFact>;

/** One refusal fact. */
export type GcpRefusalFact = z.output<typeof refusalFact>;

/** One cached role, permissions included, as `roles.jsonl` holds it. */
const cachedRoleSchema = z.strictObject({ name: z.string(), permissions: z.array(z.string()) });

/** One cached role's permission list. */
export type GcpCachedRole = z.output<typeof cachedRoleSchema>;

/**
 * The root every generation sits under.
 *
 * @param home the state home
 * @returns `$home/atlas/gcp-audit`
 */
function gcpAuditRoot({ home }: { home: string }): string {
  return join(stateHomePaths({ home }).atlas.root, STORE_NAME);
}

/**
 * A fresh generation id for a pull starting now.
 *
 * @param nowIso the pull's start instant
 * @param suffix eight hex characters of randomness
 * @returns the id, e.g. `20261003T061500Z-1a2b3c4d`
 */
export function generationIdFor({ nowIso, suffix }: { nowIso: string; suffix: string }): string {
  const stamp = nowIso
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d+Z$/, "Z");
  return `${stamp}-${suffix}`;
}

/** An open entries file a pull appends to. */
export interface GcpEntriesWriter {
  readonly path: string;
  readonly append: (args: { entry: TrimmedGcpAuditEntry }) => void;
  readonly close: () => void;
}

/**
 * Create a generation directory and open its entries file for streaming.
 *
 * @param home the state home
 * @param generation the generation id
 * @returns the writer, or `STORE_FAILED`
 */
export function openGeneration({
  home,
  generation,
}: {
  home: string;
  generation: string;
}): Result<GcpEntriesWriter, GcpAuditError> {
  const directory = join(gcpAuditRoot({ home }), generation);
  const path = join(directory, "entries.jsonl");
  try {
    mkdirSync(directory, { mode: DIR_MODE, recursive: true });
    const handle = openSync(path, "wx", FILE_MODE);
    return ok({
      append: ({ entry }) => {
        writeAll({ handle, text: `${JSON.stringify(entry)}\n` });
      },
      close: () => {
        fsyncSync(handle);
        closeSync(handle);
      },
      path,
    });
  } catch (error: unknown) {
    return err(GcpAuditErrors.storeFailed({ detail: String(error), path }));
  }
}

/**
 * Write a generation's role cache and then its manifest — the manifest last, as the completion marker.
 *
 * @param home the state home
 * @param roles every cached role, permissions included
 * @returns the manifest path, or `STORE_FAILED`
 */
export function publishGeneration({
  home,
  manifest,
  roles,
}: {
  home: string;
  manifest: GcpAuditManifest;
  roles: readonly GcpCachedRole[];
}): Result<string, GcpAuditError> {
  const directory = join(gcpAuditRoot({ home }), manifest.generation);
  const path = join(directory, "manifest.json");
  try {
    writeFileAtomicStream({
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path: join(directory, "roles.jsonl"),
      produce: ({ write }) => {
        for (const role of roles) {
          write({ text: `${JSON.stringify(role)}\n` });
        }
      },
    });
    writeFileAtomic({
      contents: `${JSON.stringify(manifest, null, 2)}\n`,
      dirMode: DIR_MODE,
      fileMode: FILE_MODE,
      path,
    });
    return ok(path);
  } catch (error: unknown) {
    return err(GcpAuditErrors.storeFailed({ detail: String(error), path }));
  }
}

/**
 * Read one generation's manifest.
 *
 * @param home the state home
 * @param generation the generation id
 * @returns the manifest, or `NO_GENERATION` when it is absent (an incomplete pull) or unreadable
 */
export function readManifest({
  home,
  generation,
}: {
  home: string;
  generation: string;
}): Result<GcpAuditManifest, GcpAuditError> {
  if (!GENERATION_ID.test(generation)) {
    return err(GcpAuditErrors.noGeneration({ why: `${generation} is not a generation id` }));
  }
  const path = join(gcpAuditRoot({ home }), generation, "manifest.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return err(GcpAuditErrors.noGeneration({ why: `${generation} has no manifest, so its pull never finished` }));
  }
  const parsed = manifestSchema.safeParse(safeJsonParse({ label: path, text }));
  if (!parsed.success) {
    return err(GcpAuditErrors.noGeneration({ why: `${path} does not parse: ${parsed.error.message}` }));
  }
  return ok(parsed.data);
}

/**
 * The newest generation whose pull finished.
 *
 * @param home the state home
 * @returns its id, or `NO_GENERATION` when none has a manifest
 */
export function latestGeneration({ home }: { home: string }): Result<string, GcpAuditError> {
  const root = gcpAuditRoot({ home });
  let names: readonly string[];
  try {
    names = readdirSync(root);
  } catch {
    return err(GcpAuditErrors.noGeneration({ why: `nothing has been pulled into ${root}` }));
  }
  const finished = names
    .filter((name) => GENERATION_ID.test(name))
    .filter((name) => statSync(join(root, name, "manifest.json"), { throwIfNoEntry: false }) !== undefined)
    .toSorted();
  const newest = finished.at(-1);
  if (newest === undefined) {
    return err(GcpAuditErrors.noGeneration({ why: `no pull under ${root} finished` }));
  }
  return ok(newest);
}

/** The parse of one stored entry line, kept loose only in that every field was written by this module. */
const storedEntrySchema = z.strictObject({
  authorization: z.array(
    z.strictObject({
      granted: z.boolean(),
      permission: z.string().nullable(),
      resource: z.string().nullable(),
    }),
  ),
  callerIp: z.string().nullable(),
  eventId: z.string(),
  eventIdSource: z.enum(["insert-id", "derived"]),
  logKind: z.enum(["activity", "data_access", "policy", "system_event"]),
  methodName: z.string().nullable(),
  origin: z.custom<TrimmedGcpAuditEntry["origin"]>((value) => typeof value === "string"),
  principal: z.string().nullable(),
  resourceName: z.string().nullable(),
  serviceName: z.string().nullable(),
  statusCode: z.number().nullable(),
  timestamp: z.string(),
  userAgent: z.string().nullable(),
});

/**
 * Stream a generation's entries, one at a time, never holding the file.
 *
 * @param home the state home
 * @param generation the generation id
 * @param onEntry called once per stored entry, in file order
 * @returns the count of lines that did not parse, or `STORE_FAILED`
 */
export function streamEntries({
  home,
  generation,
  onEntry,
}: {
  home: string;
  generation: string;
  onEntry: (args: { entry: TrimmedGcpAuditEntry }) => void;
}): Result<{ unreadable: number }, GcpAuditError> {
  const path = join(gcpAuditRoot({ home }), generation, "entries.jsonl");
  let unreadable = 0;
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        const parsed = storedEntrySchema.safeParse(safeJsonParse({ label: path, text: line }));
        if (parsed.success) {
          onEntry({ entry: parsed.data });
        } else {
          unreadable += 1;
        }
      },
      path,
    });
  } catch (error: unknown) {
    return err(GcpAuditErrors.storeFailed({ detail: String(error), path }));
  }
  return ok({ unreadable });
}

/**
 * Read a generation's role cache.
 *
 * @param home the state home
 * @param generation the generation id
 * @returns every cached role, or `STORE_FAILED`
 */
export function readRoles({
  home,
  generation,
}: {
  home: string;
  generation: string;
}): Result<readonly GcpCachedRole[], GcpAuditError> {
  const path = join(gcpAuditRoot({ home }), generation, "roles.jsonl");
  const roles: GcpCachedRole[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        if (line.trim().length === 0) {
          return;
        }
        roles.push(cachedRoleSchema.parse(safeJsonParse({ label: path, text: line })));
      },
      path,
    });
  } catch (error: unknown) {
    return err(GcpAuditErrors.storeFailed({ detail: String(error), path }));
  }
  return ok(roles);
}
