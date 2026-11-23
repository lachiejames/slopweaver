/**
 * Counting a question's keywords against the ATLAS tables — the pure half: the statements, and the folds
 * over what they return.
 *
 * ## Why this exists at all, and the ruling it does not break
 *
 * The atlases are among the best data sources the installation has, so the detectives (the Haiku
 * fan-out) must be able to read them. The gap this closes is exact: `../probe/sql.ts` names
 * `content` in all four of its statements and nothing under `src/` read `atlas_entity` back at all —
 * `./store.ts` only ever wrote it.
 *
 * **The owner's ruling that an atlas is DISTINCT from the corpus is about STORAGE, not RETRIEVAL**, and this
 * module is what makes the difference load-bearing rather than a form of words. Nothing here writes an
 * atlas row into `content`, joins the two, or ranks them against each other; the atlas is counted in its
 * own tables, in its own vocabulary — `(platform, kind)` rather than `(keyword, source)` — and a detective
 * is sent to the atlas's own verbs. A proposed atlas-to-retrieval bridge was rejected because it
 * proposed folding atlas rows into the corpus's retrieval, and that is still rejected.
 *
 * ## Two rungs, not seven, and the reason is what the columns ARE
 *
 * `../probe/sql.ts` fans a keyword across seven shapes because `content.body` is free prose, where a word
 * boundary discriminates — `barten` inside an email address is a different population from `barten` as a
 * stemmed word. An atlas holds neither prose nor a tsvector. `provider_id` is the platform's own handle
 * (`v2-monitors-update-monitor-config-policy`, a device serial, a Vanta slug) and `detail` is the
 * provider's own JSON, and in neither of them does a word boundary mean anything. So the ladder here is
 * the two rungs that DO discriminate:
 *
 * - **name** — `provider_id` or `kind` contains the keyword. The platform's own word for the thing.
 * - **detail** — `atlas_entity_channel.detail` contains it. What a channel LEARNED about the thing.
 *
 * MEASURED against a live store (hundreds of thousands of entity rows and channel views, a few dozen
 * platforms), one statement per keyword, grouped by `(platform, kind)`:
 *
 * | keyword    | whole statement |
 * | ---------- | --------------- |
 * | `airtable` | under 2 s       |
 * | `password` | under 2 s       |
 * | `sync`     | under 2 s       |
 * | `user`     | under 2.5 s     |
 *
 * Against the corpus ladder's own measured worst case — over ten seconds for `datadog` — that is cheap, which is
 * the whole reason this can be a COUNT rather than the nominal weight `../../detective/datadogLead.ts` and
 * `../../detective/hexLead.ts` have to settle for. Reproduce with `slopweaver atlas probe <keyword>`.
 *
 * ## The trap that cost the first version its top cell
 *
 * The first statement matched the PLATFORM name beside `provider_id` and `kind`. MEASURED: `password`
 * then matched the platform `onepassword`, and `onepassword/event` came back as the widest cell in the
 * whole probe at around twenty thousand entities — every event row in that platform, selected by a
 * substring of the platform's own name, saying nothing whatever about the question. It also cost a couple of
 * hundred ms.
 *
 * A keyword that names a platform is a real and strong signal, but it is ONE FACT rather than a per-entity
 * count — the same lesson `datadogLead.ts` records as "one lead per SERVICE, never one per hit". So
 * {@link atlasPlatformNamesStatement} asks it separately and it never becomes rows.
 *
 * ## What this module deliberately does NOT decide
 *
 * Whether a count means anything about the ORGANISATION. `src/atlas/kit/estateEvidence.ts` owns that
 * question and its criterion is not expressible as a count: _"A RECORD is this organisation's own when an
 * `authoritative` surface observed it and no `discovery` surface ever did."_ Datadog's `monitor` kind
 * holds dozens of SDK operations and zero monitors; both it and a kind full of real devices are rows in
 * `atlas_entity`. So the division of labour is stated everywhere this probe's output is read:
 *
 * > the probe SIZES; `slopweaver atlas <platform> read` ANSWERS, and it is what carries the claim boundary.
 *
 * A SQL restatement of `estateEvidence` was considered and rejected: it is computable in principle —
 * `atlas_entity_channel` carries `channel` and `surface`, and the descriptors declare each surface's role
 * — but a second copy of a criterion that already has its own measured history is a copy that drifts.
 */
import { type SQL, sql } from "drizzle-orm";

import { escapeLike } from "../probe/shapes.js";

/** How many `(platform, kind)` cells one keyword's probe keeps. */
export const ATLAS_CELL_LIMIT = 40;

/** What one `(platform, kind)` cell of the atlas holds for one keyword. */
export interface AtlasProbeCell {
  readonly platform: string;
  readonly kind: string;
  /** Entities matched by either rung, counted once — the union, never the sum. */
  readonly entities: number;
  /** How many matched on the platform's own handle or on the kind name. */
  readonly byName: number;
  /** How many matched inside a channel's `detail` payload. */
  readonly byDetail: number;
  /**
   * When this kind last synced successfully, as an ISO instant, or nothing when it never has.
   *
   * Carried because a cell is a lead and a lead's AGE changes what a detective should believe about it —
   * `skills/atlas/SKILL.md`'s "stale is a reason to resync, not a reason to hedge" needs the number to be
   * in front of the reader before it can be acted on.
   */
  readonly lastSuccessAtIso: string | null;
  /** What the kind's latest sync attempt came to, or nothing when nothing is recorded. */
  readonly lastAttemptOutcome: string | null;
}

/** One keyword's whole answer from the atlas tables. */
export interface AtlasProbeRow {
  readonly subject: string;
  /** The `(platform, kind)` cells, widest first, capped at {@link ATLAS_CELL_LIMIT}. */
  readonly cells: readonly AtlasProbeCell[];
  /**
   * Platforms whose own NAME contains the keyword, or whose name the keyword contains.
   *
   * Separate from the cells on purpose — see this module's header on the phantom cell of every event row.
   */
  readonly platformNames: readonly string[];
  readonly elapsedMs: number;
}

/**
 * What one platform holds in the store, with no keyword involved — the SCOPE read.
 *
 * Asked only when the caller names no keyword, because the pattern `src/route/genericCapabilities.ts`
 * establishes is that a capability row runs a cheap SCOPE command and leaves turning a question into
 * keywords to the session: a natural-language sentence substituted into a keyword filter matches nothing
 * and reads as ABSENCE. This is that command for the atlas estate.
 */
export interface AtlasProbeHolding {
  readonly platform: string;
  /** Every entity row the store holds for this platform. */
  readonly entities: number;
  /** How many distinct kinds those rows span. */
  readonly kinds: number;
  /** The most recent successful sync across all of this platform's kinds, or nothing when none ever did. */
  readonly lastSuccessAtIso: string | null;
}

/** Everything one atlas probe found. */
export interface AtlasProbeReport {
  readonly rows: readonly AtlasProbeRow[];
  /**
   * What each platform holds, populated ONLY on the keyword-less scope read.
   *
   * Empty on a keyword probe rather than always filled, because the grouped count over every entity row is
   * real work the keyword path — which `src/cli/commands/store/detectLegs.ts` runs on every `store detect`
   * — has no use for. Repro: time `slopweaver atlas probe` against `slopweaver atlas probe sync`.
   */
  readonly holdings: readonly AtlasProbeHolding[];
  /** Restricted to one platform, or nothing when the probe ran over the whole estate. */
  readonly platform: string | null;
  /** Every entity row the atlas tables hold, so a zero everywhere is legible rather than ambiguous. */
  readonly atlasEntities: number;
  readonly elapsedMs: number;
}

/**
 * The predicate restricting a probe to one platform, when the caller named one.
 *
 * Returns `sql.empty()` rather than `null` for the unrestricted case, for the reason `../probe/sql.ts`
 * measured: drizzle interpolates a `null` into a template as a BOUND PARAMETER, so the unrestricted
 * statement renders a stray `$n` and fails at parse time.
 *
 * The unrestricted case is `null` rather than `undefined` all the way down this module and its shell,
 * because `{@link AtlasProbeReport}.platform` was always `string | null` and the two spellings met in one
 * `plan.platform === undefined ? null : plan.platform` that both `prefer-nullish-coalescing` and
 * `no-silent-fallback` had an opinion about. One spelling means there is nothing to convert.
 *
 * @param platform the platform slug, or nothing for the whole estate
 * @param column which relation's `platform` column the predicate names
 * @returns the predicate, or an empty fragment
 */
function platformFilter({ platform, column }: { platform: string | null; column: SQL }): SQL {
  return platform === null ? sql.empty() : sql`and ${column} = ${platform}`;
}

/**
 * The one statement counting a keyword's `(platform, kind)` cells across both rungs.
 *
 * Two CTEs rather than a join, because the two rungs select from different tables and neither is a subset
 * of the other — the corpus ladder's narrowing CTE works only because six of its seven shapes ARE subsets
 * of the seventh. The `union all` then folds both into one grouping, and `count(distinct entity_id)` is
 * what makes `entities` the union rather than the sum: an entity matched on its handle AND inside its
 * detail is one entity, and reporting it twice would inflate exactly the cells that matched best.
 *
 * @param term the keyword
 * @param platform restrict to one platform, or the whole estate
 * @param limit how many cells to keep
 * @returns the statement
 */
export function atlasCellsStatement({
  term,
  platform,
  limit,
}: {
  term: string;
  platform: string | null;
  limit: number;
}): SQL {
  const like = `%${escapeLike({ term })}%`;
  return sql`
    with name_hits as (
      select platform, kind, entity_id
      from atlas_entity
      where (provider_id ilike ${like} or kind ilike ${like})
      ${platformFilter({ column: sql`platform`, platform })}
    ), detail_hits as (
      select distinct platform, kind, entity_id
      from atlas_entity_channel
      where detail::text ilike ${like}
      ${platformFilter({ column: sql`platform`, platform })}
    ), merged as (
      select platform, kind, entity_id, 1 as by_name, 0 as by_detail from name_hits
      union all
      select platform, kind, entity_id, 0 as by_name, 1 as by_detail from detail_hits
    )
    select merged.platform::text as platform,
      merged.kind::text as kind,
      count(distinct merged.entity_id)::bigint as entities,
      sum(merged.by_name)::bigint as "byName",
      sum(merged.by_detail)::bigint as "byDetail",
      max(status.last_success_at) as "lastSuccessAt",
      min(status.last_attempt_outcome)::text as "lastAttemptOutcome"
    from merged
    left join atlas_kind_status as status
      on status.platform = merged.platform and status.kind = merged.kind
    group by merged.platform, merged.kind
    order by count(distinct merged.entity_id) desc, merged.platform, merged.kind
    limit ${limit}
  `;
}

/**
 * The statement naming every platform whose own name the keyword touches, in either direction.
 *
 * Containment both ways, matching the rule `src/datadog/detective/gate.ts` already applies to a keyword
 * against a service name: `password` should reach `onepassword` and `onepassword` should reach it.
 *
 * @param term the keyword
 * @returns the statement
 */
export function atlasPlatformNamesStatement({ term }: { term: string }): SQL {
  const like = `%${escapeLike({ term })}%`;
  return sql`
    select distinct platform::text as platform
    from atlas_kind_status
    where platform ilike ${like} or ${term} ilike '%' || platform || '%'
    order by platform
  `;
}

/**
 * The statement behind the keyword-less SCOPE read: what each platform holds, widest first.
 *
 * Two grouped CTEs rather than one join across both tables, because `atlas_kind_status` carries a row per
 * kind whether or not `atlas_entity` holds one for it — joining before grouping would multiply the entity
 * count by the number of status rows, which is the shape of error a `count(*)` never announces.
 *
 * **It takes the same `platform` narrowing the keyword statement does, and the reason is a measured
 * defect rather than symmetry for its own sake.** Review pass (`probe-modes-exclusive`)
 * found this function taking no argument at all while {@link ./probeCore.atlasProbeLines} still built its
 * header from `report.platform`, so `slopweaver atlas probe --platform vanta` printed `over the vanta
 * atlas` above one line for every platform in the estate — a header asserting a narrowing the body did
 * not have. The `where true` is what lets {@link platformFilter} append its `and`.
 *
 * @param platform restrict to one platform, or the whole estate
 * @returns the statement
 */
export function atlasHoldingsStatement({ platform }: { platform: string | null }): SQL {
  return sql`
    with held as (
      select platform, count(*)::bigint as entities, count(distinct kind)::bigint as kinds
      from atlas_entity
      where true ${platformFilter({ column: sql`platform`, platform })}
      group by platform
    ), synced as (
      select platform, max(last_success_at) as last_success_at
      from atlas_kind_status
      where true ${platformFilter({ column: sql`platform`, platform })}
      group by platform
    )
    select held.platform::text as platform,
      held.entities as entities,
      held.kinds as kinds,
      synced.last_success_at as "lastSuccessAt"
    from held
    left join synced on synced.platform = held.platform
    order by held.entities desc, held.platform
  `;
}

/**
 * The statement counting every entity row the atlas tables hold.
 *
 * Asked once per probe rather than per keyword, and asked at all because a probe that found nothing has
 * two completely different causes — nobody ever ran `slopweaver store import-atlas`, or the estate really
 * does not mention the question — and a reader cannot tell them apart from zeroes.
 *
 * @returns the statement
 */
export function atlasTotalStatement(): SQL {
  return sql`select count(*)::bigint as rows from atlas_entity`;
}

/**
 * The widest cell of one keyword's answer — where a detective opens.
 *
 * @param row one keyword's cells
 * @returns that cell, or nothing when the keyword matched no atlas row
 */
export function widestCell({ row }: { row: AtlasProbeRow }): AtlasProbeCell | null {
  const first = row.cells[0];
  if (first === undefined) {
    return null;
  }
  return first;
}

/**
 * Every platform one keyword reached, strongest cell first, each with its own widest kind.
 *
 * One entry per PLATFORM rather than per cell, because the platform is the unit a detective can actually
 * be sent to — `slopweaver atlas <platform> read` — exactly as `datadogLead.ts` folds hits onto a service.
 *
 * @param row one keyword's cells, already widest-first
 * @returns the platforms, each carrying its widest cell and its own total
 */
export function foldPlatforms({ row }: { row: AtlasProbeRow }): readonly {
  readonly platform: string;
  readonly widest: AtlasProbeCell;
  readonly entities: number;
  readonly kinds: number;
}[] {
  const byPlatform = new Map<string, { widest: AtlasProbeCell; entities: number; kinds: number }>();
  for (const cell of row.cells) {
    const held = byPlatform.get(cell.platform);
    if (held === undefined) {
      byPlatform.set(cell.platform, { entities: cell.entities, kinds: 1, widest: cell });
      continue;
    }
    byPlatform.set(cell.platform, {
      entities: held.entities + cell.entities,
      kinds: held.kinds + 1,
      widest: held.widest,
    });
  }
  return [...byPlatform.entries()]
    .map(([platform, held]) => ({ ...held, platform }))
    .toSorted((left, right) =>
      left.entities === right.entities ? left.platform.localeCompare(right.platform) : right.entities - left.entities,
    );
}

/**
 * One line describing a cell, for the human report.
 *
 * @returns the line, without its leading indent
 */
export function atlasCellLine({ cell }: { cell: AtlasProbeCell }): string {
  const where = `${cell.platform}/${cell.kind}`.padEnd(42);
  const split = `name ${String(cell.byName)} · detail ${String(cell.byDetail)}`;
  const synced = cell.lastSuccessAtIso === null ? "never synced" : `synced ${cell.lastSuccessAtIso}`;
  const failed =
    cell.lastAttemptOutcome === null || cell.lastAttemptOutcome === "ok"
      ? ""
      : `  [last attempt ${cell.lastAttemptOutcome}]`;
  return `${where} ${String(cell.entities).padStart(8)}  ${split}  ${synced}${failed}`;
}

/**
 * One line describing what a platform holds, for the keyword-less scope report.
 *
 * @returns the line, without its leading indent
 */
export function atlasHoldingLine({ holding }: { holding: AtlasProbeHolding }): string {
  const synced = holding.lastSuccessAtIso === null ? "never synced" : `synced ${holding.lastSuccessAtIso}`;
  const kinds = String(holding.kinds).padStart(3);
  return `${holding.platform.padEnd(28)} ${String(holding.entities).padStart(8)} row(s) in ${kinds} kind(s)  ${synced}`;
}
