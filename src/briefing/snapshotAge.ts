/**
 * HOW OLD THE PAGE'S SNAPSHOT HALVES ARE — the check that stops one stale half rendering as a fresh page.
 *
 * ## The incident
 *
 * The fleet-briefing page looked very stale. The publish tail regenerated `run.json` — the
 * `slopweaver session-start --json` document `briefing render --your-list` renders the owner's react-now
 * list from — and then stopped regenerating it. Every page after that rendered the list out of a frozen
 * file: fifteen hours old by pass 295, while the block below it was minutes old.
 *
 * What was missing was a REFUSAL. A reader meets a page that looks current, and one honest instant in small
 * caps does not undo a day-old section sitting at the top of it. So the fix is a door, and the age of each
 * snapshot is stated against the half it feeds: the list's section summary, and past the ceiling the
 * eyebrow's red clause. The page's own `last refreshed` instant is never a snapshot's
 * (`refreshedStamp`, `../cli/commands/briefing/briefingRenderTypes.ts`): when session-start fails
 * on GitHub for a day, the eyebrow would inherit that day, and every card read after it would be refused as
 * dated in the future.
 *
 * ## The ceiling, MEASURED
 *
 * 133 consecutive publish passes, from the per-pass capture files the chair leaves behind:
 *
 * ```sh
 * stat -f '%m %N' "$SLOPWEAVER_HOME"/supervisor-scratch/handoff-<n>/autonomy-raw-*.jsonl | sort -n \
 *   | awk '{if(p){print $1-p} p=$1}' | sort -n \
 *   | awk '{a[NR]=$1} END{print "n="NR,"p50="a[int(NR*0.5)],"p90="a[int(NR*0.9)],"max="a[NR]}'
 * # n=133 p50=1286 p90=2302 max=10187   (seconds)
 * ```
 *
 * p50 21 minutes, p90 38 minutes, worst 170 minutes. A snapshot the pass regenerates before rendering is
 * SECONDS old rather than one interval old, so the interval only bounds how late a correct regeneration can
 * be. {@link SNAPSHOT_MAX_AGE_MS} is 90 minutes: 4.3x the median, 2.4x p90, and it would have fired on
 * exactly one of those 133 gaps. Ratchet this number against a fresh run of the command above, never
 * against a hunch about how often the chair publishes.
 *
 * ## Why an unreadable instant is NOT stale
 *
 * An input the check never SAW is a fact, not a policy refusal (`.claude/rules/error-handling.md`'s
 * `gateOutcome`). `refreshedStamp` already filters an unparseable instant out of its own candidates rather
 * than refusing on it, and a page that renders today must not start refusing because this file cannot read
 * a clock. So {@link judgeSnapshotAge} answers "not stale" and the run proceeds exactly as it does now.
 *
 * Pure — no clock, no I/O. Every instant is supplied.
 */

/**
 * How old a snapshot may be before `briefing render` refuses to publish a page built on it.
 *
 * MEASURED — see this file's header for the command that produced the distribution and what 90 minutes is
 * a multiple of. A bump with no fresh run of it is the weaken-the-gate move.
 */
export const SNAPSHOT_MAX_AGE_MS = 90 * 60 * 1000;

/** Milliseconds in a minute, and in an hour — named so the age arithmetic below reads as time. */
const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_HOUR = 60;

/**
 * What the page calls each half a snapshot feeds, in the OWNER's words rather than the flag's.
 *
 * They are the section headings the owner already reads — `../outbound/briefing/render.ts` renders `your list` and
 * `every open page, best first` — so the eyebrow's clause points at something the owner can find by scrolling. They
 * carry no registered fleet word, which the renderer's own voice test holds every fixed line on the page to.
 */
export const YOUR_LIST_LABEL = "your list";
export const OPEN_PAGES_LABEL = "open pages";

/**
 * One snapshot the page is built on that is older than the ceiling, with everything a refusal and an
 * eyebrow clause both need.
 *
 * `label` is the words the OWNER reads on the page (`your list`, `open pages`) and `source` is the path an
 * operator has to go and fix. They are separate because the page must never carry a path — a path under a
 * home directory is exactly what the hygiene gate keeps off an outbound surface.
 */
export interface StaleSnapshot {
  /** What this half is called on the page, in the owner's words. Never a flag name and never a path. */
  readonly label: string;
  /** The flag that supplied it, for the refusal the operator reads in a terminal. */
  readonly flag: string;
  /** Where it came from, for the refusal only. */
  readonly source: string;
  /** The instant the snapshot was taken, as the document or the filesystem reported it. */
  readonly takenIso: string;
  /** How far past `takenIso` the render's own clock is. */
  readonly ageMs: number;
}

/**
 * Whether one snapshot is too old to publish a page from.
 *
 * @param label what this half is called on the page
 * @param flag the invocation flag that supplied it
 * @param source the path or stream it was read from
 * @param takenIso when the snapshot was taken, absent when nothing datable came with it
 * @param nowIso the render's own instant
 * @returns the verdict when it is past the ceiling, `undefined` when it is fresh or cannot be dated
 */
export function judgeSnapshotAge({
  label,
  flag,
  source,
  takenIso,
  nowIso,
}: {
  label: string;
  flag: string;
  source: string;
  takenIso: string | undefined;
  nowIso: string;
}): StaleSnapshot | undefined {
  if (takenIso === undefined) {
    return undefined;
  }
  const taken = Date.parse(takenIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(taken) || Number.isNaN(now)) {
    return undefined;
  }
  const ageMs = now - taken;
  if (ageMs <= SNAPSHOT_MAX_AGE_MS) {
    return undefined;
  }
  return { ageMs, flag, label, source, takenIso };
}

/**
 * A snapshot's age as the eyebrow states it: `15h 3m`, or `38m` under an hour.
 *
 * Whole minutes, because the clause answers "is this section from today" rather than "how many seconds".
 * Deliberately total on a NEGATIVE age too — a snapshot dated in the future is a clock somebody got wrong,
 * and `0m` beside a refusal naming the instant is more honest than `-4h -12m`.
 *
 * @param ageMs how far past the snapshot the render's clock is
 * @returns the age, in hours and minutes
 */
export function snapshotAgeWords({ ageMs }: { ageMs: number }): string {
  const minutes = Math.max(0, Math.floor(ageMs / MS_PER_MINUTE));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours === 0) {
    return `${String(minutes)}m`;
  }
  return `${String(hours)}h ${String(minutes % MINUTES_PER_HOUR)}m`;
}

/**
 * The eyebrow's clause for one stale half: `your list 15h 3m old`.
 *
 * The page's own words, so it carries the LABEL and never the flag or the path. It also carries no
 * registered fleet word, which `src/__tests__/unit/outbound/briefing/rendererVoice.test.ts` holds the
 * renderer's fixed lines to exactly as a composer is held.
 *
 * It takes the two fields the PAGE carries rather than a whole {@link StaleSnapshot}, because the renderer
 * only ever holds those two — the flag and the path stay on the terminal side of the door by design.
 *
 * @param label what this half is called on the page
 * @param ageMs how far past the snapshot this render's clock is
 * @returns the clause, unescaped
 */
export function staleSnapshotClause({ label, ageMs }: { label: string; ageMs: number }): string {
  return `${label} ${snapshotAgeWords({ ageMs })} old`;
}
