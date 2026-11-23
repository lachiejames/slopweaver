/**
 * The rolling window every atlas is judged against — four hours by default, per atlas by declaration.
 *
 * **Owner ruling**: windows are per atlas, defaulting to four hours, the same logic the corpus applies to
 * Slack, Linear, Notion, GitHub and the rest. So this module is deliberately the atlas-shaped reading of
 * `cli/commands/refresh/core.ts#selectStaleSources` rather than a second idea that looks like it: the same
 * `lib/duration.ts` vocabulary, the same "a source with no watermark is BEHIND at any threshold" rule, and
 * the same insistence that every judged subject prints a line whether or not it moved.
 *
 * ## What is judged, and why that clock can be trusted now
 *
 * One published generation's `manifest.updatedAt`. That field is trustworthy because it is
 * DERIVED from the kind files the generation vouches for rather than asserted by each atlas's own sync — a
 * manifest clock could previously stand behind the records beside it, which would have made a
 * four-hour window meaningless in exactly the direction that reads as safe. Reproduce the estate this window
 * was measured over:
 *
 * ```
 * for a in ~/.slopweaver/atlas/*; do echo "$(basename "$a") $(jq -r .updatedAt "$a/manifest.json" 2>/dev/null)"; done
 * ```
 *
 * MEASURED with that command, and it is the finding the ruling answers: every published generation
 * was older than four hours.
 *
 * ## The three verdicts, and why `live-read` sits between the other two
 *
 * The corpus's own ladder is just-in-time refresh, then loud refusal, and never "warn and proceed"
 * (`docs/freshness-contract/rules-and-stamps.md` rule 3). An atlas cannot borrow the first rung directly: a whole-atlas
 * resync is the remote-and-expensive arm, minutes of provider calls, so making a question wait for one is
 * the thing the owner's ruling refuses: a simple question such as the organization id must not hold the tag
 * on a sync.
 *
 * So call 2 of the same page put a rung in between, and it is the one this module exists for: **a bounded
 * live read counts as fresh**. An atlas behind its window is not refused and does not wait for a resync; the
 * slice the question actually needs is read live — `slopweaver atlas vanta control-evidence --control <id>`
 * is the worked example, one control rather than the whole posture — and THAT read is what may be quoted.
 * A live read inside the window makes the answer current no matter how old the generation is, because the
 * claim no longer rests on the generation at all.
 *
 * An atlas that declares no bounded live read falls to `resync`, which is the loud arm: the verdict names
 * `resyncCommand` and nothing is quoted as current. That is a property of the ATLAS rather than a default
 * anybody chose, which is why the field is on the descriptor and why its absence is reported rather than
 * smoothed over.
 */
import { parseDuration, renderAge, renderDuration } from "../../lib/duration.js";
import type { AtlasDescriptor } from "./contract.js";

/**
 * The window an atlas that declares none is judged against, written the way a cadence is spoken.
 *
 * A POLICY rather than a measurement, and the owner's own: four hours, chosen to match the span the corpus
 * query path already calls "behind" (`retrieval/justInTime.ts`'s `BEHIND_AFTER_MINUTES`) so an atlas and a
 * corpus source cannot mean two different things by the same sentence. An atlas synced on a slower cadence,
 * or one whose provider genuinely does not move that fast, declares its own on its descriptor.
 *
 * @internal
 */
export const DEFAULT_ATLAS_FRESHNESS_WINDOW = "4h";

/** {@link DEFAULT_ATLAS_FRESHNESS_WINDOW} in milliseconds, parsed once through the shared vocabulary. */
export const DEFAULT_ATLAS_FRESHNESS_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * The window for an atlas whose provider moves on a DAILY scale — an identity directory, a workspace's
 * settings, a tenant's configuration — which a descriptor declares instead of the four-hour default.
 *
 * The owner's steer: the cadences are starting numbers to tune once the syncs are proven, and the
 * measured leans are adopted. MEASURED over a fortnight on the
 * cadence page (`$SLOPWEAVER_HOME/pages/scheduled-asks-cadence/index.html`, repro there): the most-read of
 * these, JumpCloud, had its reads cluster into fewer sessions than it had declared four-hourly firings, so
 * most firings published a generation nothing read before the next one replaced it. Thirty-six hours rather than
 * twenty-four so the daily firing it derives has headroom: a firing runs when a visible session runs it,
 * not on the minute, and a window equal to its period reads behind for part of every day.
 */
export const DAILY_ATLAS_FRESHNESS_WINDOW = "36h";

/**
 * The window for an atlas whose source barely moves — a surface map compiled from a vendor's published
 * document (pinned, or re-read only where the vendor republished a page), or an estate nothing in the
 * organisation edits week to week.
 *
 * MEASURED over the same fortnight (same page): the captured syncs of a compile-only atlas published the same
 * headline counts as the one before it bar a single braze move, and the surface-map atlases' declared
 * firings far outnumbered the reads they drew between them. Fourteen days rather than seven for the same headroom reason
 * as {@link DAILY_ATLAS_FRESHNESS_WINDOW}; it derives a weekly firing (`live/resync/cadence.ts`).
 */
export const PINNED_ATLAS_FRESHNESS_WINDOW = "14d";

/**
 * What a caller should do about one atlas before quoting it.
 *
 * - `current` — the generation is inside its window, or a bounded live read already is.
 * - `live-read` — behind, and this atlas has a bounded live read that answers without a whole resync.
 * - `resync` — behind, with no bounded live read to fall back to. The loud arm.
 *
 * @internal
 */
export const ATLAS_FRESHNESS_ACTIONS = ["current", "live-read", "resync"] as const;

/**
 * What a caller should do about one atlas, as a type.
 *
 * @internal
 */
export type AtlasFreshnessAction = (typeof ATLAS_FRESHNESS_ACTIONS)[number];

/** One atlas's verdict against its own window, and the line a report prints for it. */
export interface AtlasFreshnessVerdict {
  readonly platform: string;
  /** The window this atlas was judged against, in milliseconds. */
  readonly windowMs: number;
  /** The generation clock judged, or `null` when nothing has ever been published. */
  readonly updatedAt: string | null;
  /** How old the generation is, clamped at zero; `null` when there is no clock to age. */
  readonly ageMs: number | null;
  /** True when the generation is outside its window — including when there is no generation at all. */
  readonly behind: boolean;
  readonly action: AtlasFreshnessAction;
  /** The command that resolves {@link AtlasFreshnessVerdict.action}, or `null` when nothing is owed. */
  readonly remedy: string | null;
  /** The line this atlas prints, so a tick that skipped it is never a silent one. */
  readonly line: string;
}

/**
 * The window one atlas is judged against.
 *
 * A descriptor that declares no window takes {@link DEFAULT_ATLAS_FRESHNESS_WINDOW}, which is the ruling
 * rather than a fallback nobody chose. An unparseable declaration takes the default too and says so through
 * {@link atlasFreshnessWindowProblem} — refusing to judge an atlas because its own policy string is
 * malformed would silence the window on precisely the atlas whose configuration is wrong.
 *
 * @param descriptor the atlas whose policy is being read
 * @returns the window in milliseconds
 */
export function atlasFreshnessWindowMs({ descriptor }: { descriptor: AtlasDescriptor }): number {
  const declared = descriptor.freshnessWindow;
  if (declared === undefined) {
    return DEFAULT_ATLAS_FRESHNESS_WINDOW_MS;
  }
  const parsed = parseDuration({ value: declared });
  if ("error" in parsed) {
    return DEFAULT_ATLAS_FRESHNESS_WINDOW_MS;
  }
  return parsed.ms;
}

/**
 * Why one atlas's declared window could not be read, when that is the case.
 *
 * Separate from {@link atlasFreshnessWindowMs} because the two answer different questions and only one of
 * them may fail: a report still has a window to judge against, and a reader still has to be told the
 * declaration beside it is not the one being applied.
 *
 * @param descriptor the atlas whose policy is being read
 * @returns the reason the declaration was rejected, or `null` when there is nothing wrong with it
 */
export function atlasFreshnessWindowProblem({ descriptor }: { descriptor: AtlasDescriptor }): string | null {
  const declared = descriptor.freshnessWindow;
  if (declared === undefined) {
    return null;
  }
  const parsed = parseDuration({ value: declared });
  if ("error" in parsed) {
    return `${descriptor.platform} declares freshnessWindow \`${declared}\`, which ${parsed.error} — judging it against the ${DEFAULT_ATLAS_FRESHNESS_WINDOW} default instead`;
  }
  return null;
}

/** Everything one atlas contributes to a window judgement, gathered by the caller that can read a home. */
export interface AtlasFreshnessSubject {
  readonly platform: string;
  /** The published generation's derived clock, or `null` when nothing has been published. */
  readonly updatedAt: string | null;
  /** The window in milliseconds, already resolved through {@link atlasFreshnessWindowMs}. */
  readonly windowMs: number;
  /** The command that brings the whole atlas current — the descriptor's own `resyncCommand`. */
  readonly resyncCommand: string;
  /** This atlas's bounded live read, or `null` when it has none. */
  readonly liveReadCommand: string | null;
  /**
   * When a bounded live read last observed this atlas's provider directly, or `null` when none has. Inside
   * the window it makes the answer current whatever the generation says — see this module's header.
   */
  readonly liveReadAt: string | null;
}

/** The age of an instant against a reference, clamped at zero, or `null` when either cannot be read. */
function ageMsOf({ iso, nowMs }: { iso: string | null; nowMs: number }): number | null {
  if (iso === null) {
    return null;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed) || Number.isNaN(nowMs)) {
    return null;
  }
  // Clamped for the same reason `selectStaleSources` clamps: a generation stamped microseconds ahead of this
  // machine's clock is as current as anything can be, and `-0.1m old` reads as a defect that is not there.
  return Math.max(0, nowMs - parsed);
}

/** The action a behind atlas owes, and the command that resolves it. */
function behindAction({ subject }: { subject: AtlasFreshnessSubject }): {
  readonly action: AtlasFreshnessAction;
  readonly remedy: string;
} {
  if (subject.liveReadCommand === null) {
    return { action: "resync", remedy: subject.resyncCommand };
  }
  return { action: "live-read", remedy: subject.liveReadCommand };
}

/**
 * One atlas's verdict when nothing is owed.
 *
 * @param ageMs how old the generation is, which a live-read verdict still carries
 * @param line the line already composed by the branch that decided this
 * @param subject the atlas being judged
 * @returns the current verdict
 */
function currentVerdict({
  ageMs,
  line,
  subject,
}: {
  ageMs: number | null;
  line: string;
  subject: AtlasFreshnessSubject;
}): AtlasFreshnessVerdict {
  return {
    action: "current",
    ageMs,
    behind: false,
    line,
    platform: subject.platform,
    remedy: null,
    updatedAt: subject.updatedAt,
    windowMs: subject.windowMs,
  };
}

/**
 * One atlas's verdict when it is behind, with the remedy its own descriptor decides.
 *
 * The three behind branches differ only in the clause that says WHY, so they hand that clause in rather than
 * each composing a whole line — which is what kept a wrong remedy out of one of them when the ladder grew
 * its middle rung.
 *
 * @param ageMs how old the generation is, or `null` when there is nothing readable to age
 * @param subject the atlas being judged
 * @param why the clause naming what is wrong, in English
 * @returns the behind verdict, its action and its remedy
 */
function behindVerdict({
  ageMs,
  subject,
  why,
}: {
  ageMs: number | null;
  subject: AtlasFreshnessSubject;
  why: string;
}): AtlasFreshnessVerdict {
  const { action, remedy } = behindAction({ subject });
  return {
    action,
    ageMs,
    behind: true,
    line: `atlas ${subject.platform} · BEHIND · ${why} — ${remedy}`,
    platform: subject.platform,
    remedy,
    updatedAt: subject.updatedAt,
    windowMs: subject.windowMs,
  };
}

/**
 * Judge one atlas against its own window. Pure — the caller supplies the clock and the stamps.
 *
 * An atlas with NO published generation is behind at any window, exactly as a corpus source with no stored
 * cursor is: the never-synced case and the "everything to fetch" case are the same case, and both are
 * resolved by the same command. An UNREADABLE clock is behind for the same reason `selectStaleSources`
 * treats an unparseable cursor as behind — reading a stamp the program cannot parse as evidence of
 * freshness turns a corrupt manifest into a permanent silent skip.
 *
 * @param subject the atlas's clocks, window and commands
 * @param nowIso the reference instant the age is measured against
 * @returns the verdict, its remedy and the line to print
 */
export function judgeAtlasFreshness({
  subject,
  nowIso,
}: {
  subject: AtlasFreshnessSubject;
  nowIso: string;
}): AtlasFreshnessVerdict {
  const nowMs = Date.parse(nowIso);
  const liveAgeMs = ageMsOf({ iso: subject.liveReadAt, nowMs });
  const generationAgeMs = ageMsOf({ iso: subject.updatedAt, nowMs });

  // The live read is tested FIRST and on its own, because it is the whole point of the rung: a claim resting
  // on a bounded live read does not rest on the generation, so how old the generation is cannot change it.
  if (liveAgeMs !== null && liveAgeMs <= subject.windowMs) {
    const window = renderDuration({ ms: subject.windowMs });
    return currentVerdict({
      ageMs: generationAgeMs,
      line: `atlas ${subject.platform} · current · a bounded live read ${renderAge({ ms: liveAgeMs })} ago is inside ${window}`,
      subject,
    });
  }
  if (subject.updatedAt === null) {
    return behindVerdict({ ageMs: null, subject, why: "no generation has been published" });
  }
  if (generationAgeMs === null) {
    return behindVerdict({
      ageMs: null,
      subject,
      why: `generation clock ${subject.updatedAt} is unreadable`,
    });
  }
  const age = renderAge({ ms: generationAgeMs });
  const window = renderDuration({ ms: subject.windowMs });
  if (generationAgeMs <= subject.windowMs) {
    return currentVerdict({
      ageMs: generationAgeMs,
      line: `atlas ${subject.platform} · current · generation is ${age} old, inside ${window}`,
      subject,
    });
  }
  return behindVerdict({ ageMs: generationAgeMs, subject, why: `generation is ${age} old, past ${window}` });
}

/**
 * Judge every atlas in one sweep, in the order the caller gathered them.
 *
 * Every subject yields a verdict, current ones included. A sweep that printed only what it acted on would be
 * indistinguishable from a sweep that selected nothing, which is the silence `refresh --if-stale` prints
 * through for the same reason.
 *
 * @param subjects each atlas's clocks, window and commands
 * @param nowIso the reference instant every age is measured against
 * @returns one verdict per subject, in the order given
 */
export function judgeAtlasEstate({
  subjects,
  nowIso,
}: {
  subjects: readonly AtlasFreshnessSubject[];
  nowIso: string;
}): readonly AtlasFreshnessVerdict[] {
  return subjects.map((subject) => judgeAtlasFreshness({ nowIso, subject }));
}
