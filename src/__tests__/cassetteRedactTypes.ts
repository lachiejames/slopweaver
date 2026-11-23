/**
 * Types for the integration-lane cassette redactor (see `cassetteRedact.ts`). The redactor is an ALLOWLIST:
 * every response-body string is blanked to a placeholder unless its key sits in one of the per-provider
 * key-sets below — safe-by-default, so a field nobody anticipated (a Slack-canvas CSV, a `customer_id`) is
 * redacted, never leaked. See `~/…/orchestration/slopweaver/outbound-cassette-redaction.md`.
 */

/** The providers whose real API responses we record + redact. `claude` is exempt (synthetic demo data, SSE). */
export type CassetteProvider =
  "slack" | "linear" | "github" | "gmail" | "calendar" | "datadog" | "vanta" | "notion" | "cloudflare";

/**
 * One provider's flat allowlist. A string value is kept/transformed by which set its (lower-cased) KEY is in;
 * a key in none ⇒ the value is `[REDACTED]`. Flat (not path-scoped) on purpose — ambiguous keys are simply
 * left out (⇒ redacted), and the tripwire is the backstop, so path precision is unnecessary.
 */
export interface CassetteRedactConfig {
  readonly provider: CassetteProvider;
  /** Keys whose value is a structural enum/timestamp/flag → kept verbatim (still known-value scrubbed). */
  readonly keepKeys: ReadonlySet<string>;
  /** Keys whose value is an opaque id → replaced with a stable synthetic `id_N` (referential, irreversible). */
  readonly idKeys: ReadonlySet<string>;
  /**
   * RESPONSE keys whose value is a paging cursor → replaced with a stable synthetic `cursor_N`, or kept as
   * `""` when the provider signals "no next page" with an empty string.
   *
   * A cursor is an opaque page bookmark, and before this class existed it was in no allowlist at all, so the
   * safe default blanked it to `[REDACTED]` — the same placeholder for every page, so a replayed follow-up
   * carried a placeholder and the lenient matcher could not tell page 2 from page 3, or from a follow-up that
   * never propagated the cursor at all. A cursor that keeps its identity (distinct per page, stable across
   * re-records through the same map an id uses) is what lets `cassetteRequestRedact.ts`'s cursor matcher
   * demand that a follow-up carry the exact bookmark the previous page handed out.
   */
  readonly cursorKeys: ReadonlySet<string>;
  /**
   * REQUEST parameter names under which this provider's client SENDS a cursor back — in a query string, a
   * form-encoded body or a JSON body. The matcher keys a request carrying one of these on the cursor's
   * synthetic identity; a request carrying none keeps its lenient default key, so no existing recording moves.
   */
  readonly cursorParams: ReadonlySet<string>;
  /** Keys whose value is a URL → keep an allowlisted public origin (else `redacted.invalid`), blank the path. */
  readonly urlKeys: ReadonlySet<string>;
  /**
   * Keys whose value is kept ONLY when the value itself is allowlisted, mapped to that set of values.
   *
   * A key-level allowlist cannot express "keep this field, but only these values", and Gmail needs exactly
   * that: the header `name` must survive or a replayed message parses to nothing, while the full header set
   * on real mail names third-party mail-security and delivery tooling. Keeping the five headers a parser
   * reads and redacting the rest is the difference between a usable cassette and an infrastructure
   * fingerprint committed to the repository. Internal is not the same as safe: a recording lives in git
   * forever, is read by every agent session, and a mail-security vendor's header names are an inventory of
   * defences rather than anything a parser needs.
   */
  readonly keepValuesByKey?: Readonly<Record<string, ReadonlySet<string>>>;
}

/**
 * The persistent real-id → synthetic-id map. Keyed by `${provider}\t${realId}` so the SAME real id under
 * different keys (`id`, `user`, `channel`) collapses to the SAME `id_N` (referential integrity), while the
 * same raw string across two providers stays independent. A cursor lives in the same map under its own
 * namespace, `${provider}\tcursor\t${realCursor}` → `cursor_N` (see `cursorMapKey` in `cassetteRedact.ts`),
 * so one file keeps both stable across re-records. `next` is the shared counter for the next synthetic of
 * either kind. Value type only — threaded functionally through `cassetteRedact` (never mutated in place).
 */
export interface CassetteIdMap {
  readonly entries: Readonly<Record<string, string>>;
  readonly next: number;
}

/** The empty id-map (a fresh record run with no prior mappings). */
export const EMPTY_ID_MAP: CassetteIdMap = { entries: {}, next: 1 };
