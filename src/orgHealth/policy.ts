/**
 * The organisation-health lane's numbers, named once, and the two pure choices they drive: which announcements a
 * read opens the thread of, and which incidents the snapshot keeps.
 *
 * Every budget here is a TICK budget, not a runaway ceiling. The supervisor gives each reading 120 seconds
 * (`src/supervisor/scratch/tickCapture.ts`), and a read past its budget refuses BEFORE it starts the walk it cannot
 * afford, so an unaffordable channel is an `unmeasurable` snapshot rather than a killed read.
 *
 * Pure: no I/O, no clock.
 */
import { slackTsToEpochMs } from "#lib/slackTs.js";

import type { IncidentIoRoot } from "./incidentIo.js";
import type { OrgIncident } from "./types.js";

/** One minute, in milliseconds. */
const MINUTE_MS = 60_000;

/**
 * How old a measured snapshot may be before the monitor stops believing it. The supervisor reads every tick, so a
 * snapshot older than this means the reads stopped, and yesterday's phase must not stand in for today's.
 */
export const SNAPSHOT_FRESH_MS = 45 * MINUTE_MS;

/**
 * How long a resolved incident stays in the snapshot, and how long a resolved announcement's thread is still opened:
 * the week's resolutions, the way a status page lists past incidents. A resolution never floats a note
 * (`../monitor/orgHealth.ts`), so this bounds what `org-health read` reports and how long a resolved incident's last
 * page outranks an older open one's.
 */
export const RESOLVED_REMEMBERED_MS = 7 * 24 * 60 * MINUTE_MS;

/**
 * History pages a read may take, at Slack's 999 messages a page. MEASURED: a live `#incidents` held a dozen
 * or so announcements in one page, and the whole read — one page, two threads — took a few seconds of a 120s tick
 * (`/usr/bin/time -p slopweaver org-health read`).
 */
export const HISTORY_PAGE_BUDGET = 3;

/**
 * The wall-clock deadline a read keeps, checked before each thread: the supervisor kills a reading at 120 seconds
 * (`src/supervisor/scratch/tickCapture.ts`), and this leaves one thread's two pages and the final write inside it. A
 * read past it stops and writes `unmeasurable` itself, so the page budgets bound the work and this bounds the time.
 */
export const READ_DEADLINE_MS = 90_000;

/**
 * How old a held read lock may be before another read takes it over. Past the supervisor's 120-second kill, so a live
 * read is never taken over; a killed read's lock goes sooner, once its pid reads dead (`../admit/operationLock.ts`).
 */
export const READ_LOCK_STALE_MS = 5 * MINUTE_MS;

/** Threads a read may open. A team declares a handful of incidents a month, so ten open at once is a broken read. */
export const THREAD_BUDGET = 10;

/** Pages one thread may take, at 200 replies a page. */
export const THREAD_PAGE_BUDGET = 2;

/** The longest title the snapshot keeps; the note fits it further. */
export const TITLE_CAP = 200;

/**
 * The longest severity the snapshot keeps. incident.io's own words are one (`Critical`, `Major`, `Minor`), but the
 * field is whatever the organisation configured, and the note's sentence spends its room on it before the title.
 */
export const SEVERITY_CAP = 24;

/** The longest update the snapshot keeps; the note's details show it. */
export const UPDATE_TEXT_CAP = 400;

/**
 * The announcements whose thread a read opens: every one not resolved, and every resolved one touched within the
 * remembered window — its edit, or its post when it was never edited — since only the thread says WHEN it resolved.
 * A reply within the window opens it too: incident.io posts a reopening update before it edits the root, and read
 * between the two the root still looks long resolved, so only its thread can say otherwise.
 *
 * @param roots every announcement the history read classified
 * @param nowMs the instant judged at
 * @returns the roots to open, newest first
 */
export function rootsToOpen({
  roots,
  nowMs,
}: {
  roots: readonly IncidentIoRoot[];
  nowMs: number;
}): readonly IncidentIoRoot[] {
  return roots
    .filter((root) => {
      if (root.phase !== "resolved") {
        return true;
      }
      const recent = ({ ts }: { ts: string | undefined }): boolean => {
        if (ts === undefined) {
          return false;
        }
        const ms = slackTsToEpochMs({ ts });
        return ms !== undefined && nowMs - ms <= RESOLVED_REMEMBERED_MS;
      };
      return recent({ ts: lastTouchedTs({ root }) }) || recent({ ts: root.latestReplyTs });
    })
    .toSorted((a, b) => b.ts.localeCompare(a.ts));
}

/**
 * The incidents the snapshot keeps: every one not resolved, and every one that resolved within the remembered
 * window. Strings are cut to their caps, so the file stays bounded whatever a person typed.
 *
 * @param incidents every incident whose thread was read
 * @param nowMs the instant judged at
 * @returns the kept incidents, newest transition first
 */
export function keptIncidents({
  incidents,
  nowMs,
}: {
  incidents: readonly OrgIncident[];
  nowMs: number;
}): readonly OrgIncident[] {
  return incidents
    .filter(
      (incident) =>
        incident.phase !== "resolved" || nowMs - Date.parse(incident.phaseChangedIso) <= RESOLVED_REMEMBERED_MS,
    )
    .map((incident) => ({
      ...incident,
      severity: cut({ cap: SEVERITY_CAP, text: incident.severity }),
      title: cut({ cap: TITLE_CAP, text: incident.title }),
      ...(incident.loud?.kind === "severity-changed"
        ? { loud: { ...incident.loud, fromSeverity: cut({ cap: SEVERITY_CAP, text: incident.loud.fromSeverity }) } }
        : {}),
      ...(incident.lastUpdate === undefined
        ? {}
        : {
            lastUpdate: { ...incident.lastUpdate, text: cut({ cap: UPDATE_TEXT_CAP, text: incident.lastUpdate.text }) },
          }),
    }))
    .toSorted((a, b) => b.phaseChangedIso.localeCompare(a.phaseChangedIso));
}

/**
 * When the root was last touched: its edit, else its post.
 *
 * @returns that Slack `ts`, fraction included
 */
export function lastTouchedTs({
  root,
}: {
  root: { readonly ts: string; readonly editedTs?: string | undefined };
}): string {
  if (root.editedTs !== undefined) {
    return root.editedTs;
  }
  return root.ts;
}

/** A string cut to `cap` characters, an ellipsis marking the cut. */
function cut({ cap, text }: { cap: number; text: string }): string {
  return text.length <= cap ? text : `${text.slice(0, cap - 1)}…`;
}
