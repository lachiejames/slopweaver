/**
 * An automation's recent runs as a timeline the owner can scan: one bullet per run, said in the owner's own
 * clock with no zone and no ISO, whether it failed and in what words, how long it took, and something tangible it
 * pulled in — a Linear team by name ("most in the MX team", never `linear/MX`), with what each run pulled kind by kind
 * and team by team behind a hover. Pure: runs, a clock and a zone in, bullets out.
 *
 * A sync row's bullets come from its sync runs, which carry what each run stored; every other row's come from its
 * firings, which carry only an outcome, so what they "pulled in" is what they posted or filed.
 */
import type { FiringOutput } from "../components/live/readAutomationDetail";
import type { Firing } from "../components/live/readAutomationsFiring";
import type { CardSyncRun, SyncRun } from "../components/live/readAutomationsSyncRun";
import { dateTimeFormatOf } from "./dateTimeFormat";
import { foldWithState, plainLineOf, UNKNOWN_STATE_HEADLINE } from "./runLine";
import { dayKey } from "./slackSteers";

/** How a bullet is coloured: a failure stands out, a run in flight is marked, a deferral is muted. */
export type RunTone = "failed" | "running" | "ok" | "waited";

/** One run on the timeline. */
export interface RunBullet {
  readonly key: string;
  readonly atIso: string;
  /** `today h:mm am`, `yesterday h:mm pm`, `Sat D Mon h:mm am` — the owner's zone, never named. */
  readonly when: string;
  readonly tone: RunTone;
  readonly headline: string;
  /** `took 10 minutes`, or `running 3 minutes so far`. */
  readonly took: string | undefined;
  /** What it brought in or left behind, in words: `194 new · most in the MX team`. */
  readonly pulled: string | undefined;
  /** What it pulled, kind by kind and container by container with counts, shown on hover; a firing has none. */
  readonly pulledDetail: string | undefined;
  /** Its error: what went wrong in one plain sentence when the record says, else as the run said it. */
  readonly error: string | undefined;
  /** What the run itself said, when a plain sentence leads in its place — drawn folded, never above it. */
  readonly errorDetail: string | undefined;
}

/** The day before a `YYYY-MM-DD` key, by calendar arithmetic, so a 23- or 25-hour day cannot skip or repeat one. */
function dayBefore({ key }: { key: string }): string {
  const midnight = Date.parse(`${key}T00:00:00.000Z`);
  return new Date(midnight - 86_400_000).toISOString().slice(0, 10);
}

/** Whitespace normalised, because `Intl` puts a narrow no-break space before the day period on some engines. */
function plain({ text }: { text: string }): string {
  return text.replace(/\s/g, " ");
}

/**
 * An instant as the owner reads it: today, yesterday, or the weekday and date, then the time in the console's en-AU clock.
 *
 * @param iso the instant
 * @param nowIso the page's reading instant, which decides today
 * @param timeZone the owner's IANA zone
 * @returns e.g. `today h:mm am`
 */
export function clockWords({ iso, nowIso, timeZone }: { iso: string; nowIso: string; timeZone: string }): string {
  const instant = new Date(Date.parse(iso));
  const time = plain({
    text: dateTimeFormatOf({ locale: "en-AU", options: { hour: "numeric", minute: "2-digit", timeZone } }).format(
      instant,
    ),
  });
  const day = dayKey({ iso, timeZone });
  const today = dayKey({ iso: nowIso, timeZone });
  if (day === today) {
    return `today ${time}`;
  }
  if (day === dayBefore({ key: today })) {
    return `yesterday ${time}`;
  }
  const date = dateTimeFormatOf({
    locale: "en-AU",
    options: { day: "numeric", month: "short", timeZone, weekday: "short" },
  }).format(instant);
  return `${plain({ text: date }).replace(",", "")} ${time}`;
}

/** A measured span in the unit a person says: seconds under two minutes, minutes under two hours, else hours. */
function spanSaid({ ms }: { ms: number }): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) {
    return `${String(seconds)} seconds`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return `${String(minutes)} minutes`;
  }
  return `${(minutes / 60).toFixed(1)} hours`;
}

/** A record kind's singular and plural as a person says them. */
const KIND_NOUNS: Readonly<Partial<Record<string, readonly [string, string]>>> = {
  comment: ["reply", "replies"],
  database: ["database", "databases"],
  event: ["event", "events"],
  file: ["file", "files"],
  issue: ["issue", "issues"],
  message: ["message", "messages"],
  milestone: ["milestone", "milestones"],
  page: ["page", "pages"],
  pin: ["pin", "pins"],
  pr: ["pull request", "pull requests"],
  project: ["project", "projects"],
  review: ["review", "reviews"],
};

/** `95 issues`, `1 reply`, or the stored kind itself for one this page has no noun for. */
function kindCount({ kind, count }: { kind: string; count: number }): string {
  const nouns = KIND_NOUNS[kind];
  if (nouns === undefined) {
    return `${count.toLocaleString("en-AU")} ${kind}`;
  }
  return `${count.toLocaleString("en-AU")} ${count === 1 ? nouns[0] : nouns[1]}`;
}

/** An id-shaped label: a UUID or a long hex run, which names nothing a person reads. */
const ID_SHAPED = /^[0-9a-f-]{20,}$/i;

/**
 * A container's label as a person reads it — a Linear team by name (`linear/MX` → `the MX team`), anything else by
 * its last path segment (`acme/acme-admin` → `acme-admin`) — or `undefined` for an id, an address, or the source's
 * own name.
 */
function containerWords({ label, source }: { label: string; source: string }): string | undefined {
  const last = label.slice(label.lastIndexOf("/") + 1);
  if (last.length === 0 || last === source || ID_SHAPED.test(last) || last.includes("@")) {
    return undefined;
  }
  // Exactly `linear/<KEY>`, the one container shape a Linear issue is filed under (`corpus/linear/parse.ts`).
  if (source === "linear" && label === `linear/${last}`) {
    return `the ${last} team`;
  }
  return last;
}

/**
 * What a sync run stored. Inline, how many and where most of it landed (`194 new · most in the MX team`); behind the
 * hover, every kind and every named container with its count. A run that stored nothing has nothing to hover.
 */
function syncPulled({ run }: { run: SyncRun }): { readonly pulled: string; readonly pulledDetail: string | undefined } {
  if (run.committedWritten === 0) {
    return { pulled: "nothing new", pulledDetail: undefined };
  }
  const kinds = Object.entries(run.newByKind)
    .filter(([, count]) => count > 0)
    .toSorted((a, b) => b[1] - a[1])
    .map(([kind, count]) => kindCount({ count, kind }));
  const where = run.containers
    .filter((container) => container.written > 0)
    .toSorted((a, b) => b.written - a.written)
    .flatMap((container) => {
      const words = containerWords({ label: container.label, source: run.source });
      return words === undefined ? [] : [{ count: container.written, words }];
    });
  const head = `${run.committedWritten.toLocaleString("en-AU")} new`;
  const top = where.at(0);
  const pulled = top === undefined ? head : `${head} · most in ${top.words}`;
  const groups = [
    kinds.join(", "),
    where.map((place) => `${place.words} ${place.count.toLocaleString("en-AU")}`).join(", "),
  ].filter((group) => group !== "");
  return { pulled, pulledDetail: groups.length === 0 ? undefined : groups.join(" · ") };
}

/** A sync run's state as a tone and a headline. */
const SYNC_STATES: Readonly<Partial<Record<string, { readonly tone: RunTone; readonly headline: string }>>> = {
  "ended-unfinished": { headline: "Stopped partway", tone: "failed" },
  failed: { headline: "Failed", tone: "failed" },
  finished: { headline: "Finished", tone: "ok" },
  running: { headline: "Running", tone: "running" },
  unreadable: { headline: "Unreadable", tone: "failed" },
};

/** A sync run's tone and headline, and the stored state when the page has no words for it. */
function syncState({ state }: { state: string }): { tone: RunTone; headline: string; unknownState?: string } {
  const known = SYNC_STATES[state];
  if (known === undefined) {
    return { headline: UNKNOWN_STATE_HEADLINE, tone: "failed", unknownState: state };
  }
  return known;
}

/** `took 10 minutes`, `running 3 minutes so far`, or nothing when unmeasured. */
function tookWords({ ms, running }: { ms: number | undefined; running: boolean }): string | undefined {
  if (ms === undefined) {
    return undefined;
  }
  return running ? `running ${spanSaid({ ms })} so far` : `took ${spanSaid({ ms })}`;
}

/**
 * A failed sync run's error line and what folds under it: its words said plainly, with its first error exactly as the
 * ledger stored it beneath. Nothing for a run that did not fail. A run in a state the page has no words for guesses no
 * line under its plain headline and folds the verb's sentence and its first error, which a forward producer may fill
 * with the only reason it gave, exactly as the sync run panel does (`syncRunLead.ts`).
 */
function syncError({ run, tone, unknown }: { run: CardSyncRun; tone: RunTone; unknown: boolean }): {
  error: string | undefined;
  errorDetail: string | undefined;
} {
  if (tone !== "failed") {
    return { error: undefined, errorDetail: undefined };
  }
  if (unknown) {
    return { error: undefined, errorDetail: [run.why, ...run.errors.slice(0, 1)].join("\n") };
  }
  return plainLineOf({ failed: true, record: run.errors[0], said: run.said });
}

/** Where a sync run sits on the timeline: its start, else its last activity, else nowhere. */
function placedAt({ run }: { run: SyncRun }): string | undefined {
  if (run.startedAtIso !== undefined) {
    return run.startedAtIso;
  }
  return run.lastActivityIso;
}

/**
 * A sync row's runs as bullets, newest first.
 *
 * @param runs its runs, as the sync-run ledger folded them
 * @param nowIso the page's reading instant
 * @param timeZone the owner's IANA zone
 * @returns the bullets; a run with no start on record is placed at its last activity, else left out
 */
export function syncRunBullets({
  runs,
  nowIso,
  timeZone,
}: {
  runs: readonly CardSyncRun[];
  nowIso: string;
  timeZone: string;
}): readonly RunBullet[] {
  return runs
    .flatMap((run): RunBullet[] => {
      const atIso = placedAt({ run });
      if (atIso === undefined) {
        return [];
      }
      const { tone, headline, unknownState } = syncState({ state: run.state });
      const { pulled, pulledDetail } = syncPulled({ run });
      const { error, errorDetail } = syncError({ run, tone, unknown: unknownState !== undefined });
      return [
        {
          atIso,
          error,
          errorDetail: foldWithState({ errorDetail, unknownState }),
          headline,
          key: run.runId,
          pulled,
          pulledDetail,
          took: tookWords({ ms: run.elapsedMs, running: run.state === "running" }),
          tone,
          when: clockWords({ iso: atIso, nowIso, timeZone }),
        },
      ];
    })
    .toSorted((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso));
}

/** A firing outcome as a tone and a headline. */
const FIRING_STATES: Readonly<Partial<Record<string, { readonly tone: RunTone; readonly headline: string }>>> = {
  dead: { headline: "Died", tone: "failed" },
  deferred: { headline: "Waited", tone: "waited" },
  failed: { headline: "Failed", tone: "failed" },
  open: { headline: "Running", tone: "running" },
  succeeded: { headline: "Finished", tone: "ok" },
};

/**
 * A firing's tone and headline. An open firing behind a later run that finished is not running, whatever its stored
 * outcome says; an outcome this page has no words for is coloured as a failure and folded, never printed.
 */
function firingState({ outcome, underWay }: { outcome: string; underWay: boolean }): {
  tone: RunTone;
  headline: string;
  unknownState?: string;
} {
  if (outcome === "open" && !underWay) {
    return { headline: "Never finished", tone: "waited" };
  }
  const known = FIRING_STATES[outcome];
  if (known === undefined) {
    return { headline: UNKNOWN_STATE_HEADLINE, tone: "failed", unknownState: outcome };
  }
  return known;
}

/** What a firing left behind: a post, a fix on the board, or nothing on record. */
function firingPulled({ output }: { output: FiringOutput | undefined }): string | undefined {
  if (output === undefined) {
    return undefined;
  }
  const parts: string[] = [];
  if (output.posting !== undefined) {
    parts.push("posted to Slack");
  }
  if (output.finding !== undefined) {
    parts.push("put a fix on the board");
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/**
 * A firing's error line and what folds under it: a plain sentence leads when the record supports one, with the
 * firing's own raw record folded beneath, whole and never the shortened `said`, so the record the sentence replaced
 * stays reachable on every firing and not only the newest; otherwise its words
 * said plainly lead, with the record folded beneath (`plainLineOf`). A success says nothing.
 */
function firingError({ firing, tone }: { firing: Firing; tone: RunTone }): {
  error: string | undefined;
  errorDetail: string | undefined;
} {
  if (tone === "ok") {
    return { error: undefined, errorDetail: undefined };
  }
  const failed = firing.outcome === "failed" || firing.outcome === "dead";
  if (failed && firing.plainly !== undefined) {
    return { error: firing.plainly, errorDetail: rawRecordOf({ firing }) };
  }
  // `failed` from the outcome, never the tone: an outcome this page does not know is coloured as a failure so it cannot
  // pass for fine, yet nothing shows it failed, so no failure sentence leads it.
  return plainLineOf({ failed, record: rawRecordOf({ firing }), said: firing.said });
}

/**
 * The firing's own record, whole: its detail as the ledger wrote it, else its reason, else what it said.
 *
 * @returns the raw record, or `undefined` when the firing carries none
 */
function rawRecordOf({ firing }: { firing: Firing }): string | undefined {
  if (firing.detail !== undefined) {
    return firing.detail;
  }
  if (firing.reason !== undefined) {
    return firing.reason;
  }
  return firing.said;
}

/**
 * A non-sync row's firings as bullets, newest first.
 *
 * @param firings its recent firings
 * @param outputs what each firing posted or filed, by slot
 * @param nowIso the page's reading instant
 * @param timeZone the owner's IANA zone
 * @returns the bullets
 */
export function firingBullets({
  firings,
  outputs,
  nowIso,
  timeZone,
}: {
  firings: readonly Firing[];
  outputs: readonly FiringOutput[];
  nowIso: string;
  timeZone: string;
}): readonly RunBullet[] {
  const bySlot = new Map(outputs.map((output) => [output.slotIso, output]));
  return firings
    .map((firing): RunBullet => {
      const { tone, headline, unknownState } = firingState({ outcome: firing.outcome, underWay: firing.underWay });
      const { error, errorDetail } = firingError({ firing, tone });
      // The verb's own run time, by the rule its "how long" answer uses — never take → settle here, which on a
      // seated row counts the wait for a session as the run.
      return {
        atIso: firing.startedAtIso,
        error,
        errorDetail: foldWithState({ errorDetail, unknownState }),
        headline,
        key: `${firing.slotIso}-${String(firing.attempt)}`,
        pulled: firingPulled({ output: bySlot.get(firing.slotIso) }),
        pulledDetail: undefined,
        took: tookWords({ ms: firing.runMs, running: firing.underWay }),
        tone,
        when: clockWords({ iso: firing.startedAtIso, nowIso, timeZone }),
      };
    })
    .toSorted((a, b) => Date.parse(b.atIso) - Date.parse(a.atIso));
}
