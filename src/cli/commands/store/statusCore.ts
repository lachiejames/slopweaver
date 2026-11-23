/**
 * The PURE core of `slopweaver store status` — its flag spec and its parser.
 *
 * Its own file rather than a section of `./core.ts` for the reason `backupCore.ts`, `probeCore.ts` and
 * `datadogCore.ts` are: `status` stopped being a read of the store's own counts the day it started
 * SCANNING the filesystem beside it, so it carries flags no other verb has and a contract no other verb's
 * parser shares. Keeping it here leaves `./core.ts` about the query surface, which is what every other
 * verb in the noun actually is.
 */

import type { Result } from "../../../lib/result.js";
import { err, ok } from "../../../lib/result.js";
import type { BronzeScanScope } from "../../../store/bronzeWindows.js";
import { parseStoreQuery } from "../../../store/query.js";
import type { contentSourceEnum } from "../../../store/schema/enums.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

import { homeOf, isStorableSource, vocabularyLines } from "./core.js";
import { flagNames } from "./identityArgs.js";

/**
 * `store status` takes no CONTENT filter at all — only where the selection is read from, how much of the
 * drift scan to run, and whether drift should fail the process.
 *
 * It answers "what is in here, is it reachable, and is it behind bronze", which is a question about the
 * whole store rather than about a slice of it. A status that quietly accepted every query flag would
 * advertise one contract and honour another, and `store facets` is already the verb for a scoped count.
 * `--home` is not a filter: it names WHICH store, for the reason on `QUERY_FLAGS`.
 *
 * `--source` and `--full` are not filters either — they bound the SCAN, not the counts. The scan runs
 * WITHOUT being asked, because the gap of over ten thousand rows this verb now reports stood for days behind a `status`
 * that reported only what the store held and never what it was missing; MEASURED, it costs
 * 4.88s against 2.36s over all eight sources on the operator's own home (repro:
 * `time slopweaver store status`).
 */
const STATUS_FLAGS: FlagSpec = { boolean: ["json", "check", "full"], string: ["home", "source"] };

/** The flags `store status` advertises: the output mode, what the scan reads, and whether it gates. */
export const STORE_STATUS_FLAG_NAMES: readonly string[] = flagNames({ spec: STATUS_FLAGS });

/** A parsed status invocation: the output mode, how much bronze the drift scan reads, and whether it gates. */
export interface StoreStatusArgs {
  readonly json: boolean;
  /** Whether drift should decide the EXIT CODE, turning the report into a check. */
  readonly check: boolean;
  /** Which bronze files the drift scan reads — `full` includes the canonical `compact.jsonl`. */
  readonly scope: BronzeScanScope;
  /** The one source to scan, when the invocation named one; every storable source otherwise. */
  readonly source?: (typeof contentSourceEnum.enumValues)[number];
  readonly home?: string;
}

/**
 * Parse a status invocation, which takes no content filter.
 *
 * An unknown `--source` is refused BY NAME, in the query layer's OWN words: `store/query.ts` owns the
 * source vocabulary and already refuses `--source slak` with the real list, so this forwards that refusal
 * rather than authoring a second spelling of it that could drift. A scan silently narrowed to a source
 * that does not exist would report zero drift, which is the most dangerous answer this verb can give.
 *
 * @param rest the flag tail
 * @returns the parsed status invocation, or every reason it was refused
 */
export function parseStoreStatusArgs({ rest }: { rest: readonly string[] }): Result<StoreStatusArgs> {
  const parsed = parseFlags({ args: rest, spec: STATUS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const source = values["source"];
  if (typeof source === "string" && !isStorableSource(source)) {
    const refused = parseStoreQuery({ input: { source } });
    return err("errors" in refused ? [...refused.errors, ...vocabularyLines()] : vocabularyLines());
  }
  return ok({
    check: values["check"] === true,
    json: values["json"] === true,
    scope: values["full"] === true ? "full" : "windows",
    ...(typeof source === "string" && isStorableSource(source) ? { source } : {}),
    ...homeOf({ parsed: parsed.value }),
  });
}
