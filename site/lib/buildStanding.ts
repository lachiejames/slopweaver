/**
 * Which build this page is, and whether it is the latest — the pure half of the sidebar's build status.
 *
 * The status says how old the build in view is, whether it is one version behind (so a hard refresh moves onto the
 * latest), how stale it is, how many commits behind and which commits those were.
 *
 * Three builds are in play, and the whole decision is how they line up:
 *
 * - **loaded** — the build this page's bundle was baked from (`next.config.mjs`, from `scripts/docs-site.sh`). Only
 *   the page knows it, which is why the decision is made here rather than in the verb.
 * - **served** — what the console serves now, from its run record (`slopweaver checkout console --json`). A page
 *   loaded before a swap keeps running the old bundle; a hard refresh loads the new one.
 * - **latest** — the checkout's upstream (`origin/main`), fetched by the reading at most once a minute.
 *
 * Commits are ORDERED only by their place in the upstream's first-parent history the reading carries, never by
 * unequal shas alone: a build outside a cut window is "not in origin/main's last N" — older, or off the line, the
 * reading cannot tell — and a build not on a whole history (a worktree branch) is said to be, never counted.
 *
 * During a live voice call the page's polls are quiet (`site/lib/liveQuiet.ts`), so a build a refresh round is
 * holding for the call comes from the call's own lease answer (`useCallHold`), which is authoritative then.
 */
import {
  behindOf,
  type ConsoleBuildReport,
  type ConsoleCommit,
  newerOnLine,
  type ServedConsole,
} from "./buildStandingReport";
import type { WaitingBuild } from "./consoleHold";

/** The build this page's bundle was baked from; both `undefined` when the build carried no identity. */
export interface LoadedBuild {
  readonly sha: string | undefined;
  readonly committedIso: string | undefined;
}

/** What the sidebar says. */
export interface BuildStanding {
  readonly kind: "current" | "reload" | "waiting" | "rebuilding" | "unsynced" | "stuck" | "dev" | "unknown";
  /** The dot's colour: nothing to do, a step for the owner, something under way, or not established. */
  readonly tone: "ok" | "attention" | "busy" | "unknown";
  /** The fold's headline. */
  readonly headline: string;
  /** The same standing in the fewest words, for the sidebar's one staleness line (`./updateStanding.ts`). */
  readonly glance: string;
  /** This page's build as an age, never a sha: how long since it was rebuilt, else how old its commit is. */
  readonly build: string | undefined;
  /** The one step to take, or why nothing can be said. `undefined` when the owner is on the latest build. */
  readonly step: string | undefined;
  /** The commits this page is missing, newest first, up to the reading's limit. */
  readonly missing: readonly ConsoleCommit[];
  /** When the upstream was last fetched, so "latest" says how recent its evidence is. */
  readonly checked: string | undefined;
  /**
   * Set only when the standing is unknown because the upstream's fetch is not current — a failed or old fetch is a
   * failed read, drawn as a staleness mark, never a sentence. `why` names the ref and how it was last seen — a fetch
   * failure is the reading's own `problems`, marked beside it; `lastMatched` is whether, as last fetched, the served build WAS the upstream's tip — the earlier reading the
   * line keeps beside the mark.
   */
  readonly upstreamUnread?: { readonly ref: string; readonly why: string; readonly lastMatched: boolean };
}

/**
 * How old the upstream's last fetch may be for the sidebar to say "latest". The verb fetches at most once a minute
 * (`FETCH_EVERY_MS`, `src/checkouts/consoleBuild.ts`) and the page polls once a minute, so a healthy reading is
 * under two minutes old; five leaves room for one slow fetch and one missed poll, never for a fetch that failed.
 */
export const UPSTREAM_FRESH_MS = 5 * 60_000;

/** How far the page's clock can trail a reading: `BuildStatus` re-reads the time once a minute. */
const CLOCK_TICK_MS = 60_000;

/**
 * A short sha as the console prints one everywhere else.
 *
 * @returns the first nine hex digits
 */
export function shortSha({ sha }: { sha: string }): string {
  return sha.slice(0, 9);
}

/**
 * How long ago an instant was, against the caller's clock.
 *
 * @param iso the instant
 * @param nowMs the render's clock
 * @returns `just now`, `12m ago`, `3.5h ago`, `2.0d ago`, or a stated refusal for an instant that does not parse
 */
export function ageAt({ iso, nowMs }: { iso: string; nowMs: number }): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return "at an unreadable instant";
  }
  const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${String(minutes)}m ago`;
  }
  const hours = seconds / 3600;
  if (hours < 36) {
    return `${hours.toFixed(1)}h ago`;
  }
  return `${(hours / 24).toFixed(1)}d ago`;
}

/**
 * Whether the upstream as last fetched can stand for the upstream NOW. "Latest" is a claim about the upstream as it
 * is now, so it needs a fetch recent enough to stand behind it: a tracking ref last fetched hours ago, or never, only
 * says a build matches what this machine last saw. A fetch dated past the page's clock by more than its one-minute
 * tick means the clock went back, so its age proves nothing.
 *
 * @param report the reading whose upstream was fetched
 * @param nowMs the render's clock
 * @returns `undefined` when the fetch is recent enough, else how the upstream was last seen
 */
export function staleUpstream({ report, nowMs }: { report: ConsoleBuildReport; nowMs: number }): string | undefined {
  const fetchedIso = report.upstream?.fetchedAtIso;
  if (fetchedIso === undefined) {
    return "never fetched";
  }
  const ageMs = nowMs - Date.parse(fetchedIso);
  if (Number.isNaN(ageMs)) {
    return "last fetched at an unreadable instant";
  }
  if (ageMs < -CLOCK_TICK_MS) {
    return "fetched at an instant after now (the clock went back)";
  }
  if (ageMs > UPSTREAM_FRESH_MS) {
    return `last fetched ${ageAt({ iso: fetchedIso, nowMs })}`;
  }
  return undefined;
}

/**
 * How old this page's build is, in words and without its hex id: the line keeps how far behind
 * it is and how long ago it was rebuilt, and drops the build id, tidier. The id stays in the fold beside each
 * missing commit, where it is the thing being compared.
 *
 * When the console serves exactly this page's build, its start IS this build's rebuild, so that instant is the one
 * named; otherwise only the commit's age is known, and the line says it is the commit's.
 *
 * @returns `rebuilt 2.0h ago` or `commit 2.0h ago`
 */
function buildAge({
  committedIso,
  loadedSha,
  served,
  nowMs,
}: {
  committedIso: string;
  loadedSha: string;
  served: ServedConsole;
  nowMs: number;
}): string {
  if (served.kind === "production" && served.sha === loadedSha) {
    return `rebuilt ${ageAt({ iso: served.startedIso, nowMs })}`;
  }
  return `commit ${ageAt({ iso: committedIso, nowMs })}`;
}

/**
 * The sidebar's reading of this page's build.
 *
 * @param loaded the build this page's bundle was baked from
 * @param report the last `checkout console --json` reading
 * @param callLive whether a voice call is up now — a reload would end it
 * @param callWaiting the build a refresh round is holding for this call, from the call's own lease answer
 * @param nowMs the render's clock, for ages
 * @returns what to say, and the one step to take
 */
export function buildStanding({
  loaded,
  report,
  callLive,
  callWaiting,
  nowMs,
}: {
  loaded: LoadedBuild;
  report: ConsoleBuildReport;
  callLive: boolean;
  callWaiting: WaitingBuild | undefined;
  nowMs: number;
}): BuildStanding {
  let checked: string | undefined;
  if (report.upstream?.fetchedAtIso !== undefined) {
    checked = `${report.upstream.ref} checked ${ageAt({ iso: report.upstream.fetchedAtIso, nowMs })}`;
  }
  const unknown = ({ why, build }: { why: string; build: string | undefined }): BuildStanding => ({
    build,
    checked,
    glance: "not known",
    headline: "Build not established",
    kind: "unknown",
    missing: [],
    step: why,
    tone: "unknown",
  });
  if (loaded.sha === undefined || loaded.committedIso === undefined) {
    return unknown({
      build: undefined,
      why: "this page's build carries no commit id; it was not built by scripts/docs-site.sh",
    });
  }
  const { served, rebuild, upstream, head } = report;
  const build = buildAge({ committedIso: loaded.committedIso, loadedSha: loaded.sha, nowMs, served });
  if (served.kind === "dev") {
    return {
      build,
      checked,
      glance: "dev server",
      headline: "Dev server",
      kind: "dev",
      missing: [],
      step: "a dev server recompiles as files change; the commit shown is the one it started at",
      tone: "unknown",
    };
  }
  if (served.kind === "none") {
    return unknown({ build, why: `no console is recorded for ${report.root}` });
  }
  const behind = behindOf({ report, sha: loaded.sha });
  if (behind === undefined) {
    const ref = upstream === undefined ? "an upstream" : upstream.ref;
    return unknown({ build, why: `this build is not on ${ref}'s history, so how far behind it is cannot be counted` });
  }
  const standing = (
    fields: Pick<BuildStanding, "kind" | "tone" | "headline" | "glance" | "step"> & {
      readonly missing?: readonly ConsoleCommit[];
    },
  ): BuildStanding => {
    let missing = behind.missing;
    if (fields.missing !== undefined) {
      missing = fields.missing;
    }
    return { build, checked, ...fields, missing };
  };
  // During a call its own lease answer is the only word on what is held — including "nothing": a report polled
  // before the call can name a build an earlier call held and has since swapped in.
  const heldSha = callLive ? callWaiting?.sha : rebuild.waiting?.sha;
  if (heldSha !== undefined && newerOnLine({ report, sha: heldSha, than: loaded.sha })) {
    const whose = callLive ? "this call" : "a live voice call";
    return standing({
      glance: `${behind.short}, build waiting`,
      headline: `${behind.lag}: new build waiting`,
      kind: "waiting",
      step: `${shortSha({ sha: heldSha })} is built and swaps in when ${whose} ends; then hard refresh`,
      tone: "busy",
    });
  }
  if (!served.live) {
    return unknown({ build, why: `the console recorded for ${report.root} is not running` });
  }
  if (served.sha !== loaded.sha) {
    // A loaded build outside a cut window is not proven older, but the served one is ON the upstream's line inside
    // it, so loading it is the step either way; the headline says only that the page's build is outside the window.
    if (!newerOnLine({ report, sha: served.sha, than: loaded.sha })) {
      return unknown({
        build,
        why: `the console now serves ${shortSha({ sha: served.sha })}, which is not newer than this page; reload to see it`,
      });
    }
    let step = `hard refresh (⌘⇧R) loads ${shortSha({ sha: served.sha })}`;
    if (callLive) {
      step = `hard refresh after this call; reloading now would end it; it loads ${shortSha({ sha: served.sha })}`;
    }
    return standing({
      glance: `${behind.short}, refresh`,
      headline: `${behind.lag}: hard refresh`,
      kind: "reload",
      step,
      tone: "attention",
    });
  }
  if (head !== undefined && head.sha !== served.sha && rebuild.running) {
    // A round builds the HEAD it read when it started, which a later HEAD read cannot see, so this names no build and
    // no refresh: once the round serves, the reload standing judges the build it actually serves.
    return standing({
      glance: `${behind.short}, rebuilding`,
      headline: `${behind.lag}: rebuilding`,
      kind: "rebuilding",
      step: "the console is rebuilding; once it serves the new build, this names the step",
      tone: "busy",
    });
  }
  if (upstream !== undefined && upstream.behind > 0) {
    return standing({
      glance: `${behind.short}, sync`,
      headline: behind.counted ? `${behind.lag} ${upstream.ref}` : behind.lag,
      kind: "unsynced",
      step: `the checkout has not pulled them yet: \`slopweaver checkout sync\` pulls and rebuilds the console`,
      tone: "attention",
    });
  }
  if (head !== undefined && head.sha !== served.sha) {
    return standing({
      glance: `${behind.short}, not rebuilt`,
      headline: `${behind.lag}: console not rebuilt`,
      kind: "stuck",
      step: `the checkout is at ${shortSha({ sha: head.sha })} and no rebuild is running: \`bash scripts/docs-site.sh --refresh\`; its log is ${rebuild.logPath}`,
      tone: "attention",
    });
  }
  if (behind.missing.length > 0) {
    const ref = upstream === undefined ? "the upstream" : upstream.ref;
    return unknown({ build, why: `this build is ${behind.lag} (${ref}), yet the checkout reads as current` });
  }
  const stale = staleUpstream({ nowMs, report });
  if (upstream === undefined || stale !== undefined) {
    let seen = "never fetched";
    if (stale !== undefined) {
      seen = stale;
    }
    const ref = upstream === undefined ? "the upstream" : upstream.ref;
    const cause = report.problems.length === 0 ? "" : `: ${report.problems.join("; ")}`;
    return {
      ...unknown({
        build,
        why: `this build matches ${ref} as ${seen}, so whether it is the latest is not known${cause}`,
      }),
      upstreamUnread: {
        lastMatched: upstream !== undefined && served.sha === upstream.sha,
        ref,
        why: `${ref} ${seen}`,
      },
    };
  }
  // The claim is the served build IS the upstream's tip, so it is stated only when the reading says exactly that.
  if (served.sha !== upstream.sha) {
    return unknown({
      build,
      why: `the console serves ${shortSha({ sha: served.sha })} but ${upstream.ref} reads ${shortSha({ sha: upstream.sha })}; the next reading settles it`,
    });
  }
  return standing({ glance: "latest", headline: "Latest build", kind: "current", step: undefined, tone: "ok" });
}
