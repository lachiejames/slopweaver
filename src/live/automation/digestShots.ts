/**
 * Which pictures a digest card wants, read from the card itself.
 *
 * The three daily alert digests post with cropped, annotated Datadog images. The card is already computed — one item per probe, each carrying its
 * own frozen console citation — so the shot list is not a second decision anybody makes. It is a pure
 * function of the card that was counted, which is what keeps the picture and the number the same claim.
 *
 * ## The rules, and each is the answer to a way this goes wrong
 *
 * - **Only a FIRING item.** A green row has said everything it has to say in its count; a picture of a quiet
 *   chart is a wall of pixels for a reader to scroll past, which is rule 7 with a camera.
 * - **Deduped by address.** `growth-ops` cites ONE trace search from three different probes — actionable
 *   skips, benign skips and unrecognised skips all land in the same `delivery_status:skipped` view. Three
 *   captures of one page is three uploads of one picture.
 * - **The citation is rewritten to `viz=timeseries`, never photographed as it stands.** A citation opens the
 *   explorer's LIST view, because that is where a human reader wants to land. A list photographs as a wall
 *   of text nobody can read, and no capture adapter covers one
 *   (`visualEvidence/evidenceTarget.ts`). The timeseries view of the SAME query is the picture.
 * - **A LOGS view is also given a group-by, and the Trace Explorer is not.** MEASURED, by both
 *   sibling seats and again here: an ungrouped Log Explorer timeseries prints `31 logs found`, which the
 *   adapter's summary read does not recognise, and the capture times out at `no results summary has
 *   rendered` — the sentence the adapter measures (`N service values found ( based on M logs )`) only
 *   exists under a group-by. So `agg_q` is set to {@link LOGS_GROUP_BY} when the citation carries none.
 *   The Trace Explorer counts its data ungrouped (`3.23k indexed spans`) and needs nothing.
 * - **A LOGS view that is not a count takes no picture.** A `logs-facet-sum` probe's number SUMS an
 *   attribute, while the adapter's summary counts LOG LINES — measured on the integrity-audit card, 2,569
 *   against `based on 30 logs`, and again 2,134 against 28 and 323 against 24. Such a capture
 *   can never reconcile, so a seated session walked the owner's browser twice per digest for images it always
 *   dropped. Its citation names its own measure (`agg_m=@violations&agg_t=sum`,
 *   `datadog/alertProbeCitation.ts`), so the card alone decides it: a non-`count` `agg_t` is `unshootable`.
 *
 * ## What this CANNOT check, and what the seated session therefore must
 *
 * A citation is a search the probe's AUTHOR declared, not the query the number came from, so the picture
 * and the count can still be measurements of different things. **A broader view** is the shape measured
 * that is not decidable from the card: `growth-ops` cites one `delivery_status:skipped` search
 * from three probes, so its picture counts every skip (about 1,322 spans) while the item beside it reads
 * 298. The caption naming every item the view covers is the mitigation here, not a fix.
 *
 * **And a bind proves "we ASKED for this view", never "the picture shows it".** A capture record carries
 * both the requested address and the one the console settled on, and the two diverge hard — measured on a
 * real capture, the console added six params, dropped `live` and re-encoded the query's parentheses. The
 * bind reads the REQUESTED address, which is the same shape on both sides, so a page the console rewrote
 * under us would still bind. What keeps that from mattering is a different rail: a settle onto another host
 * is refused as `off-lease-origin` before any bytes are written.
 *
 * So a seated session READS each capture's own summary against the item's count before attaching it, and
 * drops one it cannot reconcile — the card is better with fewer images than with a misleading one, and
 * `automation run-due`'s own "N image(s) attached for M firing view(s)" line is what says so out loud.
 *
 * Pure: no fs, no clock, no network. `cli/commands/automation/rowRunners.ts` is what runs the captures.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { safeJsonParse } from "../../lib/safeJson.js";
import { digestFormSchema, digestItemsInCardOrder } from "../../outbound/artifact/digest.js";
import type { DigestForm, DigestItem } from "../../outbound/artifact/digestFields.js";

import { type DigestShotViewError, DigestShotViewErrors } from "./digestShotErrors.js";
import { type RecipeError, RecipeErrors } from "./errors.js";

/** One picture a digest wants, and every firing item that wants it.
 * @internal — a field type of {@link DigestShotPlan}.
 */
export interface DigestShotTarget {
  /**
   * Every firing item this one view covers, in card order — usually one, and the reason it is a LIST is
   * measured. `growth-ops` cites the same `delivery_status:skipped` search from three probes (actionable,
   * benign and unrecognised skips), so a picture of it captioned "Actionable skips" would tell a reader
   * the chart's 1,322 spans were that probe's 298. The caption names all of them instead.
   */
  readonly titles: readonly string[];
  /** The worst severity among those items — every target is `red` or `orange` by construction. */
  readonly severity: "red" | "orange";
  /** The address to photograph: the item's citation, in its explorer's timeseries view. */
  readonly url: string;
}

/**
 * The caption one picture carries: every firing item the view covers.
 *
 * @param target the picture
 * @returns the caption text, which is also what `--caption` is given
 */
export function shotCaption({ target }: { readonly target: DigestShotTarget }): string {
  return target.titles.join(" · ");
}

/** The severities that earn a picture. A `green` row is counted on the card and never photographed. */
const FIRING_SEVERITIES: ReadonlySet<string> = new Set(["red", "orange"]);

/** The console paths whose timeseries view a capture adapter covers. */
const SHOOTABLE_PATHS: readonly string[] = ["/logs", "/apm/traces"];

/** The Log Explorer path, which needs a group-by before its summary sentence exists. */
const LOGS_PATH = "/logs";

/**
 * The facet an ungrouped logs citation is grouped by for its picture.
 *
 * `service` because every probe on the three digest rows already filters by service, so the grouping is
 * one bar-series per service the query already names rather than a new cut of the data.
 */
export const LOGS_GROUP_BY = "service";

/**
 * The timeseries address for one citation, or why that citation cannot be photographed.
 *
 * A logs citation carrying a non-`count` `agg_t` is refused: its row is a sum (or another aggregate) while
 * the adapter reconciles a log-line count, so a capture of it is always dropped.
 *
 * @param citationUrl the item's frozen console link
 * @returns the address to capture, or the one typed reason there is none
 */
export function timeseriesViewOf({
  citationUrl,
}: {
  readonly citationUrl: string;
}): Result<string, DigestShotViewError> {
  let parsed: URL;
  try {
    parsed = new URL(citationUrl);
  } catch {
    return err(DigestShotViewErrors.notAnAddress({ citationUrl }));
  }
  if (!SHOOTABLE_PATHS.includes(parsed.pathname)) {
    return err(
      DigestShotViewErrors.viewUncovered({ citationUrl, covered: SHOOTABLE_PATHS, pathname: parsed.pathname }),
    );
  }
  const aggregation = parsed.searchParams.get("agg_t");
  if (parsed.pathname === LOGS_PATH && aggregation !== null && aggregation !== "count") {
    return err(DigestShotViewErrors.notACount({ aggregation, citationUrl, measure: parsed.searchParams.get("agg_m") }));
  }
  parsed.searchParams.set("viz", "timeseries");
  if (parsed.pathname === LOGS_PATH && parsed.searchParams.get("agg_q") === null) {
    parsed.searchParams.set("agg_q", LOGS_GROUP_BY);
  }
  return ok(parsed.toString());
}

/** What one read of a digest card found: the pictures to take, and the items that cannot have one. */
export interface DigestShotPlan {
  readonly targets: readonly DigestShotTarget[];
  /** One line per firing item whose citation no adapter covers, or which carried no citation at all. */
  readonly unshootable: readonly string[];
}

/**
 * A firing item's severity, narrowed.
 *
 * The caller filtered by FIRING_SEVERITIES, which the type cannot see, so it is named here rather than
 * asserted: an item is red exactly when it is not orange, and both are in the set.
 *
 * @returns red or orange
 */
function firingSeverity({ item }: { item: DigestItem }): "red" | "orange" {
  return item.severity === "red" ? "red" : "orange";
}

/**
 * The pictures one digest card wants.
 *
 * @param form the digest form the read leg emitted, already parsed
 * @returns the deduped targets in card order, and every firing item that cannot have a picture
 */
export function digestShotTargets({ form }: { readonly form: DigestForm }): DigestShotPlan {
  const targets: DigestShotTarget[] = [];
  const unshootable: string[] = [];
  const byUrl = new Map<string, number>();
  for (const item of digestItemsInCardOrder({ form })) {
    if (!FIRING_SEVERITIES.has(item.severity)) {
      continue;
    }
    const citationUrl = item.citationUrl;
    if (citationUrl === undefined) {
      unshootable.push(`${item.title} · firing with no citation, so there is no view to photograph`);
      continue;
    }
    const view = timeseriesViewOf({ citationUrl });
    if (view.isErr()) {
      unshootable.push(`${item.title} · ${view.error.message}`);
      continue;
    }
    const severity = firingSeverity({ item });
    const already = byUrl.get(view.value);
    if (already !== undefined) {
      // A shared view takes the WORST severity of every item on it, never the first item's: an alerts card
      // ranks by priority, where an orange across a tenth of the traffic (P1) sits above a narrow red (P2).
      const target = targets[already]!;
      const worst = target.severity === "red" ? "red" : severity;
      targets[already] = { ...target, severity: worst, titles: [...target.titles, item.title] };
      continue;
    }
    byUrl.set(view.value, targets.length);
    targets.push({ severity, titles: [item.title], url: view.value });
  }
  return { targets, unshootable };
}

/**
 * The pictures one digest card wants, read from the card document the read leg printed.
 *
 * One card is one record — the `--form` leg emits it in a single write — so this is inside
 * `whole-file-json`'s criterion by construction rather than by exception.
 *
 * @param document the form document, as one JSON string
 * @returns the plan, or why the document is not a digest card
 */
export function digestShotTargetsFromDocument({
  document,
}: {
  readonly document: string;
}): Result<DigestShotPlan, RecipeError> {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "digest form", text: document });
  } catch (error: unknown) {
    return err(RecipeErrors.digestCardNotJson({ cause: error }));
  }
  const form = digestFormSchema.safeParse(parsed);
  if (!form.success) {
    return err(
      RecipeErrors.digestCardInvalid({
        reasons: form.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    );
  }
  return ok(digestShotTargets({ form: form.data }));
}

/** One attached capture, resolved to the address it photographed. */
export interface AttachedCapture {
  /** The path the caller passed on `--media`. */
  readonly path: string;
  /** The address its capture record says it photographed, or `null` when nothing records these bytes. */
  readonly capturedUrl: string | null;
}

/**
 * Every attached capture that does not picture one of THIS card's targets.
 *
 * The gap this closes, found by a review pass of its own diff: admission
 * (`visualEvidence/prepareUploads.ts`) proves an image's bytes were recorded and read back, and says
 * nothing about WHAT they show. So a seated session could attach a graded capture of another row's view —
 * a Knock logs panel on the growth-ops card — and every gate on the path would pass it. The card's own
 * targets are the missing predicate, and they are already computed one function up.
 *
 * **It binds the VIEW, and bounds the window — it cannot bind the exact address**, and that was measured
 * before it landed: every read of a row resolves its own `24h` against its own `now`, so two reads 75
 * seconds apart minted citations 106 seconds apart. A seated session reads the card in one invocation and
 * posts in another, so exact-string equality would have refused every honest attachment and posted nothing
 * at all — strictly worse than the text-only card this replaces. So the identity is the address with every
 * freeze param stripped, and the window is checked separately against {@link MAX_WINDOW_DRIFT_MS}.
 *
 * Pure: the caller resolves each path to its capture record and hands the pairs in.
 *
 * @param attached each `--media` path with the address its capture record carries
 * @param targets the pictures this card asked for
 * @returns one line per attachment that may not ride on this card; empty when every one belongs to it
 */
export function unboundCaptures({
  attached,
  targets,
}: {
  readonly attached: readonly AttachedCapture[];
  readonly targets: readonly DigestShotTarget[];
}): readonly string[] {
  const wanted = targets.map((target) => viewIdentityOf({ url: target.url }));
  return attached.flatMap((capture) => {
    if (capture.capturedUrl === null) {
      return [`${capture.path} · no capture record names these bytes, so nothing says which view they show`];
    }
    const taken = viewIdentityOf({ url: capture.capturedUrl });
    const sameView = wanted.filter((target) => target.identity === taken.identity);
    if (sameView.length === 0) {
      return [`${capture.path} · photographed ${capture.capturedUrl}, which is not a view this card cites`];
    }
    const drift = Math.min(...sameView.map((target) => windowDriftMs({ a: target, b: taken })));
    if (drift <= MAX_WINDOW_DRIFT_MS) {
      return [];
    }
    return [
      `${capture.path} · photographed the right view over a window ${String(Math.round(drift / 60_000))} minutes ` +
        `from this card's, past the ${String(MAX_WINDOW_DRIFT_MS / 60_000)}-minute bound — re-capture it`,
    ];
  });
}

/** One address split into the view it names and the window it was frozen over. */
interface ViewIdentity {
  /** The address with every freeze param removed: host, path, query, `viz` and any group-by. */
  readonly identity: string;
  /** The window's own edges in epoch milliseconds, or `null` when the address froze none. */
  readonly fromMs: number | null;
  readonly toMs: number | null;
}

/**
 * Every param that carries a window rather than naming a view — both domains' spellings
 * (`datadog/ddLink.ts` § the per-domain freeze params).
 */
const FREEZE_PARAMS: readonly string[] = ["from_ts", "to_ts", "live", "start", "end", "paused"];

/**
 * How far a capture's window may sit from the card's before the picture stops being evidence for it.
 *
 * MEASURED: two reads of one row 75 seconds apart minted citations 106 seconds apart, because
 * each read resolves `24h` against its own `now`. A seated session reads the card, takes one capture per
 * firing view in the owner's browser and posts — minutes, not hours. An hour is therefore loose enough that no
 * honest run trips it and tight enough that yesterday's picture, or one taken before a re-freeze, does not
 * ride on today's card.
 */
const MAX_WINDOW_DRIFT_MS = 60 * 60 * 1000;

/**
 * Split one console address into the view it names and the window it froze.
 *
 * @param url the address
 * @returns the identity, and the window edges when it carries them
 */
function viewIdentityOf({ url }: { readonly url: string }): ViewIdentity {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { fromMs: null, identity: url, toMs: null };
  }
  const numberAt = ({ keys }: { readonly keys: readonly string[] }): number | null => {
    for (const key of keys) {
      const raw = parsed.searchParams.get(key);
      if (raw !== null && Number.isFinite(Number(raw))) {
        return Number(raw);
      }
    }
    return null;
  };
  const fromMs = numberAt({ keys: ["from_ts", "start"] });
  const toMs = numberAt({ keys: ["to_ts", "end"] });
  FREEZE_PARAMS.forEach((key) => {
    parsed.searchParams.delete(key);
  });
  // Ordered by key rather than by the order the console happened to print them, and built as a NEW string:
  // `URLSearchParams.sort()` is an in-place mutation the house rules refuse, and an identity is a value
  // this function owns rather than an edit to the address it was handed.
  const ordered = [...parsed.searchParams.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return { fromMs, identity: `${parsed.origin}${parsed.pathname}?${ordered}`, toMs };
}

/**
 * How far apart two frozen windows sit, at their furthest edge.
 *
 * An address with no window at all is treated as infinitely far: a link that pins nothing opens at `now`,
 * so it is evidence for no particular window and cannot be bound to a card's.
 *
 * @param a one view
 * @param b the other
 * @returns the drift in milliseconds
 */
function windowDriftMs({ a, b }: { readonly a: ViewIdentity; readonly b: ViewIdentity }): number {
  if (a.fromMs === null || a.toMs === null || b.fromMs === null || b.toMs === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(Math.abs(a.fromMs - b.fromMs), Math.abs(a.toMs - b.toMs));
}
