/**
 * The host-neutral description of sources a visible supervisor can consult.
 *
 * Slopweaver ships only generic rows. A private installation may add or replace rows by passing a
 * validated profile at the CLI boundary, which keeps organisation names, repository paths and provider
 * identifiers out of this public repository. Commands are argv arrays because the host executes them;
 * no caller should have to recover argument boundaries from a shell string.
 */
import { z } from "zod";

import { isRecord } from "../lib/parsers.js";

import { err, ok, type Result } from "../lib/result.js";

import { RESERVED_LIVE_NEED_IDS } from "./liveCapabilityPolicy.js";

/** The capability-profile version. A different version is refused rather than guessed at. */
export const CAPABILITY_PROFILE_SCHEMA_VERSION = 1;

/** The only dynamic argv token a private profile may declare. */
export const QUESTION_COMMAND_TOKEN = "{question}";

/**
 * The coverage an UNREACHABLE row declares — vocabulary of {@link SourceCoverage} rather than of any one
 * table, which is why it lives here and not beside the rows that use it.
 */
export const UNKNOWN_COVERAGE = { detail: "no connector can measure this source", kind: "unknown" } as const;

/** The freshness an UNREACHABLE row declares — {@link UNKNOWN_COVERAGE}'s other half. */
export const UNKNOWN_FRESHNESS = {
  detail: "no connector can observe when this source last changed",
  kind: "unknown",
} as const;

/** Whether a source can be consulted from this installation. */
type SourceAvailability = { readonly kind: "available" } | { readonly kind: "unavailable"; readonly reason: string };

/** What a source can prove about the completeness of its result. */
export interface SourceCoverage {
  readonly kind: "complete" | "bounded" | "best-effort" | "unknown";
  readonly detail: string;
}

/**
 * How current the source is when its command is run.
 *
 * `cached` is the atlas shape and it is none of the other three. An atlas read answers from a generation
 * that was PUBLISHED locally by an earlier sync: it is not `live` (the command performs no network call),
 * not a `snapshot` of the running build (the generation outlives the process that wrote it), and not
 * `periodic` (nothing schedules the next sync — a person or a run decides). Leaving the word out did not
 * make those sources unrepresentable, it made them silently unrepresentED: an overlay that reached for
 * `cached` was rejected as a whole document, so every capability in it was dropped together.
 */
interface SourceFreshness {
  readonly kind: "live" | "snapshot" | "periodic" | "cached" | "unknown";
  readonly detail: string;
}

/** One source the visible host may consult. */
export interface SourceCapability {
  /** Stable join key. A private profile replaces a generic row by using the same id. */
  readonly id: string;
  /** The layer responsible for the capability, such as `slopweaver` or a private console. */
  readonly owner: string;
  /** The architectural source class, kept generic so private provider names stay off-repo. */
  readonly sourceClass: "provider" | "atlas" | "corpus" | "repository" | "artifact" | "orchestration";
  /** Current truth cannot be replaced by a history source. */
  readonly truthMode: "current" | "history";
  /** The effect the command would perform. Planning itself performs neither. */
  readonly effect: "read" | "write";
  /**
   * Full command argv, including the executable; empty only while unavailable. A leading `slopweaver`
   * token is replaced with the current plugin bundle's absolute launcher by `route plan`.
   */
  readonly command: readonly string[];
  /** Whole words or phrases that select this capability. */
  readonly terms: readonly string[];
  /** One clause describing what this source can answer. */
  readonly what: string;
  readonly availability: SourceAvailability;
  readonly coverage: SourceCoverage;
  readonly freshness: SourceFreshness;
}

/** A private, off-repo overlay of source capabilities. */
export interface CapabilityProfile {
  readonly schemaVersion: number;
  readonly capabilities: readonly SourceCapability[];
}

const sourceAvailabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("available") }).strict(),
  z.object({ kind: z.literal("unavailable"), reason: z.string().min(1) }).strict(),
]) satisfies z.ZodType<SourceAvailability>;

const sourceCoverageSchema = z
  .object({
    detail: z.string().min(1),
    kind: z.enum(["complete", "bounded", "best-effort", "unknown"]),
  })
  .strict() satisfies z.ZodType<SourceCoverage>;

const sourceFreshnessSchema = z
  .object({
    detail: z.string().min(1),
    kind: z.enum(["live", "snapshot", "periodic", "cached", "unknown"]),
  })
  .strict() satisfies z.ZodType<SourceFreshness>;

/**
 * The spelling `corpus` carried before it was renamed, normalised on READ and never written.
 *
 * A brief is persisted state the turn path re-reads on resume, and `../live/turn/brief.ts` decodes its
 * `routingInput.availableCapabilities` through the schema below. Refusing the old spelling would turn every
 * brief written before the rename into one `BRIEF_INVALID_ROUTING_INPUT` — the version refusal that file's
 * `historicalCapabilities` comment already rejects for exactly this reason. Nothing in this tree emits it:
 * `./genericCapabilities.ts` writes `corpus`, so the substitution only ever runs over an older file.
 */
const RETIRED_CORPUS_SOURCE_CLASS = "world-model";

/**
 * The built-in history row's id, which a private overlay may declare but never REPLACE.
 *
 * Enforced at the PROFILE edge rather than in the row schema, and that placement is the whole point:
 * `../live/turn/brief.ts` decodes a persisted brief's capability rows through the row schema, and every
 * brief written since the rename carries this exact id, so a row-level refusal would refuse the brief.
 * `./liveCapabilityPolicy.ts`'s set is the other, unrelated rule — a live decision's vocabulary.
 */
const OVERLAY_RESERVED_HISTORY_ID = "corpus";

const sourceClassSchema = z.preprocess(
  (value) => (value === RETIRED_CORPUS_SOURCE_CLASS ? "corpus" : value),
  z.enum(["provider", "atlas", "corpus", "repository", "artifact", "orchestration"]),
);

/** The reusable parse-edge schema for a source capability. */
export const sourceCapabilitySchema = z
  .object({
    availability: sourceAvailabilitySchema,
    command: z.array(z.string().min(1)),
    coverage: sourceCoverageSchema,
    effect: z.enum(["read", "write"]),
    freshness: sourceFreshnessSchema,
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "capability id must be lower kebab-case"),
    owner: z.string().min(1),
    sourceClass: sourceClassSchema,
    terms: z.array(z.string().min(1)).min(1),
    truthMode: z.enum(["current", "history"]),
    what: z.string().min(1),
  })
  .strict()
  .superRefine((capability, context) => {
    // Refused HERE, per row, rather than filtered later: `../route/routingCapabilities.ts` removes a reserved
    // id before partitioning, so a row that was allowed to declare one would parse cleanly and then vanish
    // from every roster with nothing reporting it — the silent-drop class that module exists to close. At
    // the row edge `parseCapabilityProfileRows` skips it BY NAME instead, and the rest of the overlay survives.
    if (RESERVED_LIVE_NEED_IDS.has(capability.id)) {
      context.addIssue({
        code: "custom",
        message: `capability id ${capability.id} is reserved — it names no capability, and live routing never offers or accepts it`,
        path: ["id"],
      });
    }
    if (capability.availability.kind === "available" && capability.command.length === 0) {
      context.addIssue({
        code: "custom",
        message: "an available capability must declare the full command argv",
        path: ["command"],
      });
    } else if (capability.availability.kind === "unavailable" && capability.command.length > 0) {
      context.addIssue({
        code: "custom",
        message: "an unavailable capability cannot declare a runnable command",
        path: ["command"],
      });
    }
  }) satisfies z.ZodType<SourceCapability>;

/** The strict parse-edge schema for a private capability overlay. */
export const capabilityProfileSchema = z
  .object({
    capabilities: z.array(sourceCapabilitySchema),
    schemaVersion: z.literal(CAPABILITY_PROFILE_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((profile, context) => {
    const seen = new Set<string>();
    for (const [index, capability] of profile.capabilities.entries()) {
      for (const [argumentIndex, argument] of capability.command.entries()) {
        if (argument.includes(QUESTION_COMMAND_TOKEN) && argument !== QUESTION_COMMAND_TOKEN) {
          context.addIssue({
            code: "custom",
            message: `${QUESTION_COMMAND_TOKEN} must be a complete argv element`,
            path: ["capabilities", index, "command", argumentIndex],
          });
        }
      }
      if (capability.id === OVERLAY_RESERVED_HISTORY_ID) {
        context.addIssue({
          code: "custom",
          message: `${OVERLAY_RESERVED_HISTORY_ID} is reserved for Slopweaver's history source`,
          path: ["capabilities", index, "id"],
        });
      } else if (seen.has(capability.id)) {
        context.addIssue({
          code: "custom",
          message: `capability id ${capability.id} is declared more than once`,
          path: ["capabilities", index, "id"],
        });
      }
      seen.add(capability.id);
    }
  }) satisfies z.ZodType<CapabilityProfile>;

/**
 * Locate one schema violation for a reader: which capability carried it, and which field.
 *
 * A bare Zod message is not enough here, and that is a measured claim rather than a style preference. One
 * overlay on this install declared an unsupported `freshness.kind` in twenty of its thirty-five rows, and
 * the refusal printed the SAME sentence twenty times, naming neither a capability nor a field. Nothing in
 * it could lead a reader to the offending rows, so the whole overlay stayed dropped and the router went on
 * answering from the generic table.
 *
 * @param issue one issue from the profile schema
 * @param value the decoded document, read only to recover the offending capability's own id
 * @returns the message, prefixed with the capability id and field path when the issue sits inside one
 */
function locatedIssue({ issue, value }: { issue: z.core.$ZodIssue; value: unknown }): string {
  const [head, index, ...rest] = issue.path;
  if (head !== "capabilities" || typeof index !== "number") {
    return issue.message;
  }
  const rows = isRecord(value) ? value["capabilities"] : undefined;
  const row = Array.isArray(rows) ? rows[index] : undefined;
  const declared = isRecord(row) ? row["id"] : undefined;
  const who = typeof declared === "string" && declared.length > 0 ? declared : `capabilities[${index}]`;
  const field = rest.length > 0 ? rest.join(".") : "the capability";
  return `${who}: ${field} — ${issue.message}`;
}

/**
 * Parse an already-decoded private capability profile.
 *
 * @param value the decoded JSON value
 * @returns the validated profile, or every schema violation, each naming the capability and field it is in
 */
export function parseCapabilityProfile({ value }: { value: unknown }): Result<CapabilityProfile> {
  const parsed = capabilityProfileSchema.safeParse(value);
  return parsed.success ? ok(parsed.data) : err(parsed.error.issues.map((issue) => locatedIssue({ issue, value })));
}

/** One capability row the overlay declared that could not be used, and precisely why. */
export interface SkippedCapability {
  readonly id: string;
  readonly reason: string;
}

/** An overlay parsed ROW BY ROW: what survived, and every row that did not. */
export interface CapabilityProfileParse {
  readonly profile: CapabilityProfile;
  readonly skipped: readonly SkippedCapability[];
}

/**
 * Classify ONE overlay row: the capability to keep, or the named reason it was skipped.
 *
 * The reserved-id check runs BY NAME, before the schema, because the strict parse its caller finishes with
 * is whole-document: left to reach that, one redeclared history row would refuse the overlay entire and
 * drop every good row beside it, which is the exact failure a row-by-row reader exists to end.
 *
 * @param index the row's position, which names a row declaring no readable id of its own
 * @returns the parsed capability, or the skip to report beside the survivors
 */
function classifyOverlayRow({
  index,
  row,
}: {
  index: number;
  row: unknown;
}): Result<SourceCapability, SkippedCapability> {
  if (isRecord(row) && row["id"] === OVERLAY_RESERVED_HISTORY_ID) {
    return err({
      id: OVERLAY_RESERVED_HISTORY_ID,
      reason: `the capability — ${OVERLAY_RESERVED_HISTORY_ID} is reserved for Slopweaver's history source`,
    });
  }
  const parsed = sourceCapabilitySchema.safeParse(row);
  if (parsed.success) {
    return ok(parsed.data);
  }
  const declared = isRecord(row) ? row["id"] : undefined;
  const id = typeof declared === "string" && declared.length > 0 ? declared : `capabilities[${index}]`;
  return err({
    id,
    reason: parsed.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "the capability"} — ${issue.message}`)
      .join("; "),
  });
}

/**
 * Parse an overlay row by row, so one bad capability cannot drop every good one beside it.
 *
 * {@link parseCapabilityProfile} refuses the whole document, which is right where a caller is VALIDATING an
 * overlay before writing it. It is wrong where a caller is LOADING one to answer a question: measured on
 * this install, twenty of thirty-five rows declared a `freshness.kind` the enum did not carry, and all
 * thirty-five were dropped together — including the fifteen that parse perfectly. The router then answered
 * from the generic table as though the overlay did not exist.
 *
 * The envelope is still fatal, because a document whose version or shape is wrong is not partially usable.
 * A single malformed ROW is not: it is skipped, named, and the caller is expected to say so.
 *
 * @param value the decoded JSON value
 * @returns the surviving profile and the named rows that were skipped, or an envelope-level refusal
 */
export function parseCapabilityProfileRows({ value }: { value: unknown }): Result<CapabilityProfileParse> {
  if (!isRecord(value)) {
    return err(["capability-profile.json must be a JSON object"]);
  }
  const rows = value["capabilities"];
  if (!Array.isArray(rows)) {
    return err(["capability-profile.json must declare a `capabilities` array"]);
  }
  const kept: SourceCapability[] = [];
  const skipped: SkippedCapability[] = [];
  for (const [index, row] of rows.entries()) {
    const classified = classifyOverlayRow({ index, row });
    if (classified.isErr()) {
      skipped.push(classified.error);
      continue;
    }
    kept.push(classified.value);
  }
  const survivors = parseCapabilityProfile({ value: { ...value, capabilities: kept } });
  if (survivors.isErr()) {
    return err(survivors.error);
  }
  return ok({ profile: survivors.value, skipped });
}

/** The outcome of merging one capability profile into another: the result, and which ids moved which way. */
export interface CapabilityProfileMergeResult {
  readonly merged: CapabilityProfile;
  /** Incoming ids that were not already present, and so were added. */
  readonly added: readonly string[];
  /** Incoming ids that already existed and were therefore left untouched. */
  readonly skipped: readonly string[];
}

/**
 * Merge an incoming capability profile into an existing one, additively.
 *
 * An installation's own rows are never overwritten: a private installation may have hand-tuned a row (a
 * different command, a locally-scoped severity filter) that a canonical upstream source no longer matches,
 * and silently replacing it would lose that tuning with no record of what changed. Only ids the existing
 * profile does not already declare are added, so re-running this with the same incoming file is idempotent
 * — a second call adds nothing it already added once.
 *
 * @param existing the profile already installed, kept as the base
 * @param incoming the profile to merge in, already validated
 * @returns the merged profile, and which incoming ids were added versus already present
 */
export function mergeCapabilityProfiles({
  existing,
  incoming,
}: {
  existing: CapabilityProfile;
  incoming: CapabilityProfile;
}): CapabilityProfileMergeResult {
  const existingIds = new Set(existing.capabilities.map((capability) => capability.id));
  const added: string[] = [];
  const skipped: string[] = [];
  const newRows: SourceCapability[] = [];
  for (const capability of incoming.capabilities) {
    if (existingIds.has(capability.id)) {
      skipped.push(capability.id);
    } else {
      added.push(capability.id);
      newRows.push(capability);
    }
  }
  return {
    added,
    merged: { capabilities: [...existing.capabilities, ...newRows], schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION },
    skipped,
  };
}
