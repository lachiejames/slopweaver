/**
 * Projecting one atlas generation's bytes into the five atlas tables — pure, so the whole shape question
 * is testable without a database or a filesystem.
 *
 * ## One projection, no per-platform adapters, and that is a MEASUREMENT
 *
 * The board row this implements said the estate was "one generic loader plus three adapters", because
 * three platforms' kind files predate `kit/channelEntity.ts` and carry no `channels` map. Re-measured
 * by streaming every kind file (several hundred) under `$SLOPWEAVER_HOME/atlas`, that is not what the
 * divergence is:
 *
 * - **Every** one of the hundreds of thousands of entity rows carries `id` and `providerId` as strings —
 *   zero exceptions, including every pre-`channels` row. **Every** envelope carries `kind` — zero exceptions.
 * - A pre-`channels` entity is a SINGLE-channel entity whose view is the row's own
 *   `{state, firstSeenAt, lastSeenAt?, source, detail?}` — exactly the fields a `ChannelView` carries.
 * - The only thing genuinely missing is the channel's NAME, and every such row carries it, in
 *   `source.channel` (cloudflare) or `source.surface` (crowdstrike, aether, github). **Zero rows name neither.**
 *
 * So the divergence is ONE fallback rule — {@link channelNameOf} — and there is no adapter here at all.
 * Reproduce the split by testing line 2 of every kind file for
 * `has id && has kind && has providerId && has channels`.
 *
 * ## What this refuses, and what it counts
 *
 * A malformed envelope refuses the whole kind; a malformed entity refuses one LINE
 * (`./errors.ts` carries why the two are different variants). What it does NOT refuse is a duplicate: the
 * estate already holds a duplicate entity and tens of thousands of duplicate gap records, every colliding group
 * byte-identical, so {@link collapseGaps} and the entity collapse in `./store.ts` fold them and REPORT the
 * count. A silent dedupe would hide a defect in whatever writes `gaps[]` that nothing has ever counted.
 */
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { NewAtlasEntityChannelRow, NewAtlasEntityRow } from "../schema.js";

import { type AtlasImportError, AtlasImportErrors } from "./errors.js";
import { instant, optionalInstant, stringField } from "./fields.js";

/**
 * The one character Postgres `jsonb` cannot hold, stripped from every string on its way into a jsonb column.
 *
 * MEASURED against a real load: `vanta/policy-documents.jsonl`, `vanta/vulnerabilities.jsonl` and
 * `cloudflare/worker-script.jsonl` carry `\u0000` inside extracted document text, and the insert fails with
 * `unsupported Unicode escape sequence` — not a driver quirk but a documented Postgres limitation: a `jsonb`
 * string may not contain U+0000, because `jsonb` stores text and Postgres text is NUL-terminated.
 *
 * Stripped rather than refused, because refusing would drop real Vanta policy documents over a control
 * character that is not content, and every text pipeline in the estate already treats it that way. It is a
 * change to the stored bytes, so it is COUNTED (`nulsStripped`) rather than silent — the only honest
 * middle between losing the row and lying about what was stored.
 *
 * Reproduce by grepping every kind file under `~/.slopweaver/atlas` for the literal escape.
 */
const NUL = "\u0000";

/**
 * Deep-strip U+0000 from every string in a value bound for a `jsonb` column.
 *
 * Returns the SAME reference when nothing changed, so the common case costs one walk and no allocation —
 * and callers gate even that walk on a substring scan of the raw line, which is why nearly all kind files
 * never reach this at all.
 *
 * @param value the parsed payload
 * @returns the value with every NUL removed, and how many were removed
 */
export function stripNuls({ value }: { value: unknown }): { value: unknown; stripped: number } {
  if (typeof value === "string") {
    if (!value.includes(NUL)) {
      return { stripped: 0, value };
    }
    const cleaned = value.replaceAll(NUL, "");
    return { stripped: value.length - cleaned.length, value: cleaned };
  }
  if (Array.isArray(value)) {
    let stripped = 0;
    const next = value.map((entry) => {
      const done = stripNuls({ value: entry });
      stripped += done.stripped;
      return done.value;
    });
    return stripped === 0 ? { stripped: 0, value } : { stripped, value: next };
  }
  if (!isRecord(value)) {
    return { stripped: 0, value };
  }
  let stripped = 0;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const done = stripNuls({ value: entry });
    stripped += done.stripped;
    next[key.replaceAll(NUL, "")] = done.value;
  }
  return stripped === 0 ? { stripped: 0, value } : { stripped, value: next };
}

/**
 * Whether a raw JSONL line could carry a NUL at all.
 *
 * The cheap gate in front of {@link stripNuls}: one substring scan over a string the reader already holds,
 * against a deep walk of a parsed object graph once per entity row, hundreds of thousands of times. Both spellings are checked because a NUL can
 * reach a line as the JSON escape or as the literal byte.
 *
 * @param line the raw JSONL line
 * @returns whether the line is worth walking
 */
export function mayHoldNul({ line }: { line: string }): boolean {
  return line.includes("\\u0000") || line.includes(NUL);
}

/** The four fields the canonical entity layout carries; anything else on an entity is an extra. */
const CANONICAL_ENTITY_FIELDS: ReadonlySet<string> = new Set(["channels", "id", "kind", "providerId"]);

/** One entity line, projected into its own row and one row per filled channel. */
export interface ProjectedEntity {
  readonly entity: NewAtlasEntityRow;
  readonly channels: readonly NewAtlasEntityChannelRow[];
  /** U+0000 characters removed on the way into a jsonb column. See {@link stripNuls}. */
  readonly nulsStripped: number;
}

/**
 * The channel name for one view.
 *
 * The canonical layout keys the `channels` map by name, so the key IS the name. A pre-`channels` row has no
 * map, and names its channel in its `source` instead — `source.channel` on cloudflare, `source.surface` on
 * crowdstrike, aether and github. Measured over every such row on this install, one of the two is always
 * present; see this module's header.
 *
 * @param source the view's `source` object, when it has one
 * @returns the channel name, or `null` when the row names none
 */
export function channelNameOf({ source }: { source: unknown }): string | null {
  if (!isRecord(source)) {
    return null;
  }
  const named = stringField({ from: source, key: "channel" });
  if (named !== null) {
    return named;
  }
  // The pre-`channels` spelling: crowdstrike, aether and github name the SURFACE that looked, and for
  // those rows the surface and the channel are the same string.
  return stringField({ from: source, key: "surface" });
}

/**
 * Project one channel view onto its row.
 *
 * @param view the view object — a member of the `channels` map, or a pre-`channels` entity itself
 * @param channel the name {@link channelNameOf} resolved
 * @param key the entity's own key columns
 * @param path the file, for a refusal
 * @param lineNumber the line, for a refusal
 * @returns the channel row, or why the view could not be read
 */
function projectChannel({
  view,
  channel,
  key,
  path,
  lineNumber,
}: {
  view: Record<string, unknown>;
  channel: string;
  key: { platform: string; kind: string; entityId: string };
  path: string;
  lineNumber: number;
}): Result<NewAtlasEntityChannelRow, AtlasImportError> {
  const state = stringField({ from: view, key: "state" });
  if (state !== "observed" && state !== "stale") {
    return err(AtlasImportErrors.missingField({ field: "state", lineNumber, path }));
  }
  const firstSeenAt = instant({ field: "firstSeenAt", lineNumber, path, value: view["firstSeenAt"] });
  if (firstSeenAt.isErr()) {
    return err(firstSeenAt.error);
  }
  // `lastSeenAt` is absent on crowdstrike, aether and github, whose rows carry only `firstSeenAt`. Falling
  // back to it is the honest reading: one look is both the first and the last, and a null would claim the
  // atlas does not know when it last saw a thing it has seen exactly once.
  const lastSeenAt =
    view["lastSeenAt"] == null
      ? firstSeenAt
      : instant({ field: "lastSeenAt", lineNumber, path, value: view["lastSeenAt"] });
  if (lastSeenAt.isErr()) {
    return err(lastSeenAt.error);
  }
  const source = isRecord(view["source"]) ? view["source"] : {};
  const observedAt = optionalInstant({ field: "observedAt", lineNumber, path, value: source["observedAt"] });
  if (observedAt.isErr()) {
    return err(observedAt.error);
  }
  const detail = view["detail"];
  return ok({
    artifacts: Array.isArray(source["artifacts"]) ? source["artifacts"] : [],
    channel,
    deepLink: stringField({ from: source, key: "deepLink" }),
    deepLinkStatus: stringField({ from: source, key: "deepLinkStatus" }),
    // A channel that saw an entity without learning anything about it carries no `detail` at all, which
    // is a different fact from one carrying `{}` — so an absent one is stored as SQL NULL.
    detail: detail === undefined ? null : detail,
    endpoint: endpointOf({ source }),
    entityId: key.entityId,
    firstSeenAt: firstSeenAt.value,
    kind: key.kind,
    lastSeenAt: lastSeenAt.value,
    observedAt: observedAt.value,
    platform: key.platform,
    state,
    surface: stringField({ from: source, key: "surface" }),
  });
}

/**
 * The reproduction handle one channel view came from.
 *
 * Cloudflare's `source` names it `operation`; every other shape names it `endpoint`. Both are the same
 * fact — what was called to see this — so both land in one column, and naming the second spelling here
 * keeps the choice visible rather than hidden in a coalesce.
 *
 * @param source the view's `source` object
 * @returns the handle, or `null` when the view records none
 */
function endpointOf({ source }: { source: Record<string, unknown> }): string | null {
  const endpoint = stringField({ from: source, key: "endpoint" });
  if (endpoint !== null) {
    return endpoint;
  }
  return stringField({ from: source, key: "operation" });
}

/**
 * Project one entity line into its row and its channel rows.
 *
 * @param entity the parsed line
 * @param platform the directory this came from — the platform, never the envelope's own claim
 * @param kind the envelope's kind
 * @param generationAt the envelope's `updatedAt`
 * @param path the file, for a refusal
 * @param lineNumber the line, for a refusal
 * @param scanForNuls whether this line could carry a U+0000 — the caller decides with
 *   {@link mayHoldNul} over the raw text, so the deep walk is skipped on the nearly
 *   all files that cannot possibly need it
 * @returns the entity and its channels, or why the line could not be read
 */
export function projectEntity({
  entity,
  platform,
  kind,
  generationAt,
  path,
  lineNumber,
  scanForNuls,
}: {
  entity: unknown;
  platform: string;
  kind: string;
  generationAt: Date;
  path: string;
  lineNumber: number;
  scanForNuls: boolean;
}): Result<ProjectedEntity, AtlasImportError> {
  if (!isRecord(entity)) {
    return err(AtlasImportErrors.unreadableLine({ lineNumber, path }));
  }
  const entityId = stringField({ from: entity, key: "id" });
  if (entityId === null) {
    return err(AtlasImportErrors.missingField({ field: "id", lineNumber, path }));
  }
  const providerId = stringField({ from: entity, key: "providerId" });
  if (providerId === null) {
    return err(AtlasImportErrors.missingField({ field: "providerId", lineNumber, path }));
  }
  const key = { entityId, kind, platform };
  const taken = isRecord(entity["channels"])
    ? channelledViews({ entity, key, lineNumber, path })
    : flatView({ entity, key, lineNumber, path });
  if (taken.isErr()) {
    return err(taken.error);
  }
  const row = { entityId, extra: taken.value.extra, generationAt, kind, platform, providerId };
  if (!scanForNuls) {
    return ok({ channels: taken.value.channels, entity: row, nulsStripped: 0 });
  }
  return ok(cleanNuls({ channels: taken.value.channels, entity: row }));
}

/**
 * The channel rows and extras of an entity in the canonical `channels`-map layout.
 *
 * @param entity the parsed line, already known to carry a `channels` record
 * @param key the entity's own key columns
 * @param path the file, for a refusal
 * @param lineNumber the line, for a refusal
 * @returns one row per FILLED channel, and every field outside the canonical four
 */
function channelledViews({
  entity,
  key,
  path,
  lineNumber,
}: {
  entity: Record<string, unknown>;
  key: { platform: string; kind: string; entityId: string };
  path: string;
  lineNumber: number;
}): Result<{ channels: NewAtlasEntityChannelRow[]; extra: Record<string, unknown> }, AtlasImportError> {
  const channels: NewAtlasEntityChannelRow[] = [];
  const map = isRecord(entity["channels"]) ? entity["channels"] : {};
  for (const [channel, view] of Object.entries(map)) {
    // A null slot is a channel that has not looked, which is the whole point of the two-slot design
    // (`kit/channelEntity.ts`): projecting it as a row would assert a view nobody took.
    if (!isRecord(view)) {
      continue;
    }
    const row = projectChannel({ channel, key, lineNumber, path, view });
    if (row.isErr()) {
      return err(row.error);
    }
    channels.push(row.value);
  }
  const extra: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(entity)) {
    if (!CANONICAL_ENTITY_FIELDS.has(field)) {
      extra[field] = value;
    }
  }
  return ok({ channels, extra });
}

/**
 * The single channel row of a pre-`channels` entity.
 *
 * The whole row IS the view, and its own non-view fields ARE the detail: such an entity has no separate
 * `detail` bag, so reading one would throw away everything the row actually says. It carries no extras
 * either, for the same reason — its fields are its content, not decoration on a canonical shape.
 *
 * @param entity the parsed line, already known to carry no `channels` record
 * @param key the entity's own key columns
 * @param path the file, for a refusal
 * @param lineNumber the line, for a refusal
 * @returns the one channel row, and an empty extras bag
 */
function flatView({
  entity,
  key,
  path,
  lineNumber,
}: {
  entity: Record<string, unknown>;
  key: { platform: string; kind: string; entityId: string };
  path: string;
  lineNumber: number;
}): Result<{ channels: NewAtlasEntityChannelRow[]; extra: Record<string, unknown> }, AtlasImportError> {
  const channel = channelNameOf({ source: entity["source"] });
  if (channel === null) {
    return err(AtlasImportErrors.unnamedChannel({ lineNumber, path }));
  }
  const declared = entity["detail"];
  const detail = declared === undefined ? detailOfFlatEntity({ entity }) : declared;
  const row = projectChannel({ channel, key, lineNumber, path, view: { ...entity, detail } });
  if (row.isErr()) {
    return err(row.error);
  }
  return ok({ channels: [row.value], extra: {} });
}

/**
 * Strip every U+0000 out of one projected entity's jsonb payloads, and count what went.
 *
 * Split from {@link projectEntity} because it runs on only a handful of kind files and holding it inline made the
 * common path harder to read than the rare one.
 *
 * @param entity the entity row, whose `extra` is a jsonb column
 * @param channels its channel rows, whose `detail` and `artifacts` are jsonb columns
 * @returns the same rows with every NUL removed, and how many were removed
 */
function cleanNuls({
  entity,
  channels,
}: {
  entity: NewAtlasEntityRow;
  channels: readonly NewAtlasEntityChannelRow[];
}): ProjectedEntity {
  let nulsStripped = 0;
  const cleanedChannels = channels.map((row) => {
    const detail = stripNuls({ value: row.detail });
    const artifacts = stripNuls({ value: row.artifacts });
    nulsStripped += detail.stripped + artifacts.stripped;
    // Narrowed rather than asserted: {@link stripNuls} answers `unknown`, and a cast would be this file
    // promising a shape the compiler cannot see. An array in is always an array out — the walk rebuilds
    // it with `.map` — so the guard never fires, and if it ever did, keeping the original is correct.
    return {
      ...row,
      artifacts: Array.isArray(artifacts.value) ? artifacts.value : row.artifacts,
      detail: detail.value,
    };
  });
  const cleanedExtra = stripNuls({ value: entity.extra });
  nulsStripped += cleanedExtra.stripped;
  return {
    channels: cleanedChannels,
    entity: { ...entity, extra: isRecord(cleanedExtra.value) ? cleanedExtra.value : entity.extra },
    nulsStripped,
  };
}

/** The fields a pre-`channels` entity carries that belong to the VIEW rather than to the entity's detail. */
const FLAT_VIEW_FIELDS: ReadonlySet<string> = new Set([
  "detail",
  "firstSeenAt",
  "id",
  "kind",
  "lastSeenAt",
  "providerId",
  "source",
  "state",
]);

/**
 * What a pre-`channels` entity knows, as a detail bag.
 *
 * Everything on the row that is not part of the channel-view envelope — a crowdstrike device's
 * `osVersion` and `serialNumber`, an aether page's `route` and `title`. Those fields are the entity's whole
 * content, and a projection that kept only a `detail` key it does not have would store tens of thousands of
 * rows saying nothing.
 *
 * @param entity the flat row
 * @returns the remaining fields, in their own order
 */
function detailOfFlatEntity({ entity }: { entity: Record<string, unknown> }): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(entity)) {
    if (!FLAT_VIEW_FIELDS.has(field)) {
      detail[field] = value;
    }
  }
  return detail;
}
