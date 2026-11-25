/**
 * The sidebar's one update line: whether what the owner is running is up to date, and every change getting onto
 * the latest would bring, in one list. Pure.
 *
 * Two build lines take up vertical space; the owner wants confidence at a glance how stale what they are using is, and
 * what would be different on the latest version, via progressive disclosure.
 *
 * A line reading "Console 7 behind, refresh · App update available" with a fold of seven commits under Console and one
 * change under App makes the owner ask which commits were not the app. They should not have to think about two kinds
 * of updates: all the changes go in one place. So the page's and the app's standings (`./buildStanding.ts`,
 * `./shellStanding.ts`) stay the evidence, and what the owner reads is one
 * standing over both: up to date, an update with every change it brings, something under way, or not known — never
 * a console half and an app half, and never a refresh to take by hand under the desktop app's Update button.
 */
import type { BuildStanding } from "./buildStanding";
import type { ConsoleCommit } from "./buildStandingReport";
import { releaseChangeSummary } from "./releaseNotes";
import type { ShellStanding } from "./shellStandingWords";
import type { StalenessFact } from "./stalenessLabel";
import type { UpdateIntent } from "./updateAction";

/** What the sidebar draws for the update. */
export interface UpdateStanding {
  /** Which of the four things the line says. */
  readonly kind: "current" | "available" | "busy" | "unknown";
  /** The dot's colour. */
  readonly tone: BuildStanding["tone"];
  /**
   * The one line: `Up to date`, `Update available · 7 changes, 3 in the app`, `Building update…`, `Update status not
   * known` — or,
   * over an upstream fetch that is not current, the answer it last gave, empty when that was not "up to date".
   */
  readonly line: string;
  /** Reads behind the line that failed or are out of date, for one staleness mark beside it; empty when none. */
  readonly unread: readonly StalenessFact[];
  /** The hover text: each build the line stands on and why, so a truncated line loses nothing. */
  readonly title: string;
  /**
   * The words in the fold, when there is no button to carry the step — a browser, or an app from before the button —
   * or why the standing is not known; empty when the button is the step.
   */
  readonly notes: readonly string[];
  /** Every change getting onto the latest would bring, once each, newest first. */
  readonly changes: readonly ConsoleCommit[];
}

/**
 * Every commit the running console and app are missing between them, once each, in origin/main's own newest-first
 * order wherever the reading places it — so the list never depends on which build happened to be missing a commit.
 *
 * @param page the page's standing; its `missing` are the commits this page does not carry
 * @param app the app's standing; its `changing` are the commits that change an app this one does not carry
 * @param mainline origin/main's first-parent commits as the reading carries them, newest first
 * @returns the union, in mainline order, then any the mainline reading does not carry in the order they were given —
 *   kept rather than dropped, since a change missing from the list is one the owner would get without being told
 */
export function experienceChanges({
  page,
  app,
  mainline,
}: {
  page: BuildStanding;
  app: ShellStanding | undefined;
  mainline: readonly ConsoleCommit[];
}): readonly ConsoleCommit[] {
  const given = [...page.missing, ...(app === undefined ? [] : app.changing)];
  const wanted = new Set(given.map((commit) => commit.sha));
  const listed = mainline.filter((commit) => wanted.has(commit.sha));
  const placed = new Set(listed.map((commit) => commit.sha));
  const rest: ConsoleCommit[] = [];
  for (const commit of given) {
    if (!placed.has(commit.sha)) {
      placed.add(commit.sha);
      rest.push(commit);
    }
  }
  return [...listed, ...rest];
}

/**
 * One standing's hover sentence.
 *
 * @returns the label, headline, build and step joined, the absent ones skipped
 */
function sentence({ label, standing }: { label: string; standing: BuildStanding | ShellStanding }): string {
  const parts = [standing.headline, standing.build, standing.step].filter((part) => part !== undefined);
  return `${label}: ${parts.join(" · ")}`;
}

/**
 * Whether a standing has nothing to get: the page on the latest build, the app with no update and nothing unknown.
 *
 * @returns whether it is up to date
 */
function upToDate({ page, app }: { page: BuildStanding; app: ShellStanding | undefined }): boolean {
  const appCurrent = app === undefined || (app.fix === "none" && app.tone === "ok");
  return page.kind === "current" && appCurrent;
}

/**
 * The steps in words when no button carries them: the app's first, since its update rebuilds the page too.
 *
 * @returns the step sentences
 */
function wordedSteps({ page, app }: { page: BuildStanding; app: ShellStanding | undefined }): readonly string[] {
  if (app !== undefined && app.fix !== "none" && app.step !== undefined) {
    return [app.step];
  }
  return page.step === undefined ? [] : [page.step];
}

/**
 * Whether the app's standing is unknown only because a read failed: the upstream's fetch, or the app's own answer
 * with no earlier one kept.
 *
 * @returns whether a failed read is the app's whole unknown
 */
function appUnknownOverRead({ app }: { app: ShellStanding }): boolean {
  if (app.upstreamUnread !== undefined) {
    return true;
  }
  return app.shellUnread !== undefined && !app.shellUnread.kept;
}

/**
 * Why the standing cannot be stated, from whichever build is not established — never a failed read, which is the
 * staleness mark's to say ({@link failedReadsOf}).
 *
 * @returns the reasons; empty when only failed reads keep it unknown
 */
function unknownReasons({ page, app }: { page: BuildStanding; app: ShellStanding | undefined }): readonly string[] {
  const pageOwn = page.kind !== "current" && page.upstreamUnread === undefined;
  const appOwn = app !== undefined && app.tone !== "ok" && !appUnknownOverRead({ app });
  const reasons: string[] = [];
  if (pageOwn && page.step !== undefined) {
    reasons.push(page.step);
  }
  if (appOwn && app.step !== undefined) {
    reasons.push(app.step);
  }
  if (reasons.length > 0) {
    return reasons;
  }
  if (appOwn) {
    return [app.headline];
  }
  return pageOwn ? [page.headline] : [];
}

/** The upstream fetch that failed: the page's own when it did, else the app's — one mark, never both. */
function upstreamUnreadOf({
  page,
  app,
}: {
  page: BuildStanding;
  app: ShellStanding | undefined;
}): BuildStanding["upstreamUnread"] {
  if (page.upstreamUnread !== undefined) {
    return page.upstreamUnread;
  }
  return app?.upstreamUnread;
}

/**
 * Every read behind the line that failed or is out of date — the upstream's fetch once, and the app's own answer —
 * for one staleness mark beside whatever the line says.
 *
 * @returns the facts; empty when every read is current
 */
function failedReadsOf({
  page,
  app,
}: {
  page: BuildStanding;
  app: ShellStanding | undefined;
}): readonly StalenessFact[] {
  const facts: StalenessFact[] = [];
  const fetch = upstreamUnreadOf({ app, page });
  if (fetch !== undefined) {
    facts.push({
      shortWords: "upstream not read",
      subject: `whether ${fetch.ref} has moved past what you run`,
      why: fetch.why,
    });
  }
  if (app?.shellUnread !== undefined) {
    facts.push({ shortWords: "app build not read", subject: "the app's own build", why: app.shellUnread.why });
  }
  return facts;
}

/**
 * Whether failed reads are the ONLY thing keeping the standing unknown: each build either current or unknown solely
 * over a failed read, at least one of them the latter.
 *
 * @returns whether, as those reads last answered, every build matched — `undefined` when anything else keeps the
 *   standing unknown
 */
function onlyFailedReadsOf({
  page,
  app,
}: {
  page: BuildStanding;
  app: ShellStanding | undefined;
}): { readonly lastMatched: boolean } | undefined {
  const pageOverRead = page.upstreamUnread !== undefined;
  if (!pageOverRead && page.kind !== "current") {
    return undefined;
  }
  const appCurrent = app === undefined || (app.fix === "none" && app.tone === "ok");
  const appOverRead = app !== undefined && appUnknownOverRead({ app });
  if (!appOverRead && !appCurrent) {
    return undefined;
  }
  if (!pageOverRead && !appOverRead) {
    return undefined;
  }
  // An app answer that would not read, with none kept, matched nothing as far as the line can say.
  const appUnplaced = app?.shellUnread !== undefined && !app.shellUnread.kept;
  const lastMatched =
    page.upstreamUnread?.lastMatched !== false && app?.upstreamUnread?.lastMatched !== false && !appUnplaced;
  return { lastMatched };
}

/**
 * Join the page's and the app's standings into the sidebar's one update line.
 *
 * @param page the console page's own build standing
 * @param app the desktop app's standing; `undefined` in a browser only — the sidebar draws no line until the app has
 *   answered, since an unanswered app read as absent would say "Up to date" over a build that may be behind
 * @param intent what getting onto the latest takes (`updateIntent`, `./updateAction.ts`)
 * @param changes every change it would bring (`experienceChanges`)
 * @param pressable whether the Update button is drawn to carry the step — false in a browser and under an app from
 *   before the button, where the fold says the step in words
 * @returns the line, its dot, its hover and what the fold holds
 */
export function updateStanding({
  page,
  app,
  intent,
  changes,
  pressable,
}: {
  page: BuildStanding;
  app: ShellStanding | undefined;
  intent: UpdateIntent;
  changes: readonly ConsoleCommit[];
  pressable: boolean;
}): UpdateStanding {
  const lines = [sentence({ label: "Console", standing: page })];
  if (app !== undefined) {
    lines.push(sentence({ label: "App", standing: app }));
  }
  const title = lines.join("\n");
  // A failed read is marked beside whatever the line says, on every path — never a sentence in its place.
  const unread = failedReadsOf({ app, page });
  if (intent.kind === "busy") {
    return { changes, kind: "busy", line: intent.label, notes: [], title, tone: "busy", unread };
  }
  if (intent.kind !== "none") {
    let line = "Update available";
    if (changes.length > 0) {
      // How many of them are in the app is what says whether the update matters.
      line = `Update available · ${releaseChangeSummary({ changing: changes })}`;
    }
    const notes = pressable ? [] : wordedSteps({ app, page });
    return { changes, kind: "available", line, notes, title, tone: "attention", unread };
  }
  // A change still listed is never "up to date", whatever the two standings say.
  if (changes.length === 0 && upToDate({ app, page })) {
    return { changes: [], kind: "current", line: "Up to date", notes: [], title, tone: "ok", unread };
  }
  // Unknown only because reads failed: the answer they last gave when it was "up to date", else no words — the mark
  // beside it says what and why.
  const onlyRead = changes.length === 0 ? onlyFailedReadsOf({ app, page }) : undefined;
  if (onlyRead !== undefined) {
    const line = onlyRead.lastMatched ? "Up to date" : "";
    return { changes, kind: "unknown", line, notes: [], title, tone: "unknown", unread };
  }
  // Nothing to press and not current: an unplaced build, a console that will not rebuild — said, with why, and never
  // folded into "up to date". A failed read among them is the mark's, not a note.
  return {
    changes,
    kind: "unknown",
    line: "Update status not known",
    notes: unknownReasons({ app, page }),
    title,
    tone: "unknown",
    unread,
  };
}
