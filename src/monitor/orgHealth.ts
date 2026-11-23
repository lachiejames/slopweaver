/**
 * `org-health` — the organisation's own incidents, floated as one note when one starts or its severity changes.
 *
 * The rule: a heads-up floating note when a new incident starts, almost like a page, and another when the severity of
 * an incident materially changes; for an incident's resolution a quiet update is enough. The quiet channel is
 * `slopweaver org-health status`, read on demand, which replaces any message or digest (`../orgHealth/standing.ts`).
 * So this note is the LOUD channel and nothing else: a phase move
 * changes nothing here, and a resolution takes the note down without posting one. Healthy teams are never mentioned.
 *
 * ## One subject for the whole organisation
 *
 * A notice is on no list, so the note is the whole of what the owner sees of it. There is exactly one subject: its sentence
 * names the incident with the newest loud moment and counts the rest open, one note for the organisation in front of
 * whatever else is up when it is raised, rather than a note per incident.
 *
 * ## Keyed on the loud moment, so only a page is a new note
 *
 * The key is the headline's loud moment — `inc34-critical-<instant>`, the instant being the start of the first
 * complete read that saw it (`../orgHealth/sightings.ts`). A phase move or an update keeps the key, so the pass leaves
 * the card standing (`./pass.ts`); a severity gone A→B→A is three keys and three pages.
 *
 * The headline is the newest loud moment among EVERY kept incident, the week's resolutions included, and when that
 * incident is resolved the reading is `clear` — never an older open incident promoted in its place. Promoted, it
 * would post a note at the moment of a resolution, or, held as already shown, keep the resolved card standing, since
 * a held arrival departs nothing. For the same reason a loud moment no later than one already
 * posted is not news: once a resolution ages out of the snapshot, the open incident it outranked would otherwise page
 * the owner a week late. The keys posted — settled, and the one whose card is up now — carry those instants, so that
 * watermark is read off them, never stored twice. The card still up counts too: a read with no sightings file re-dates
 * its incident's page to the declaration, and a watermark of settled keys alone would let that older key replace the
 * card with the same page. It reads clear instead, taking the card down: never a repeat.
 *
 * ## What the card says is as of the moment it floated
 *
 * A card is posted once and never rewritten in place, so its `+N more open` and its details are the moment it paged;
 * `org-health status` is the live count. Nor does its sentence name a phase, which would go stale under a key a phase move
 * keeps.
 *
 * ## A key is shown once
 *
 * A key already posted and taken down is HELD (`delivery: hold`) rather than re-posted, whether the owner's Done closed it or
 * a newer page replaced it: a page is never news twice. The register remembers every settled
 * key, so this holds however long ago it was shown. No `lapsesAt`: a key that lapsed while still the headline would
 * settle and re-post on every pass.
 *
 * Pure: the snapshot read is `./orgHealthSource.ts`.
 */
import { renderAge } from "#lib/duration.js";
import type { Result } from "#lib/result.js";

import { DETAIL_LINE_CAP, DETAILS_MAX } from "../hand/details.js";
import { fitLine } from "../hand/push/notice.js";
import { UNBLOCKS_CAP, WHAT_CAP } from "../hand/step.js";
import type { OrgHealthError } from "../orgHealth/errors.js";
import { orgHealthStanding } from "../orgHealth/standing.js";
import type { IncidentSnapshot, LoudMoment, OrgIncident } from "../orgHealth/types.js";

import type { MonitorDefinition } from "./registry.js";
import type { MonitorReading, MonitorSubject } from "./types.js";

/** The monitor's id, named once. */
const MONITOR_ID = "org-health";

/** An instant as a key carries it, to the millisecond: `20260923035357000`. */
const instantDigits = ({ iso }: { iso: string }): string => iso.slice(0, 23).replaceAll(/[-T:.]/gu, "");

/** A key's trailing instant, as {@link instantDigits} wrote it. */
const KEY_INSTANT = /-(\d{17})$/u;

/**
 * The key a loud moment is posted under: the incident, the severity it paged at, and the read that first saw it.
 *
 * @param incident the incident whose loud moment it is
 * @param loud that moment
 * @returns `inc34-critical-20261004080000000`
 */
export function orgHealthKey({ incident, loud }: { incident: OrgIncident; loud: LoudMoment }): string {
  const ref = incident.ref.toLowerCase().replace("-", "");
  const severity = incident.severity.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "");
  return `${ref}-${severity}-${instantDigits({ iso: loud.iso })}`;
}

/**
 * Judge the snapshot.
 *
 * @param snapshot what the last read wrote, `null` when no read has run, or why the file cannot be trusted
 * @param nowMs the instant judged at
 * @param dismissed the keys the owner closed (`./heldKeys.ts`), held rather than re-posted
 * @param shown every key already posted and taken down, the owner's Done or not — held too, and named as already shown
 * @param open the keys whose card is up now, which the watermark counts and nothing holds
 * @returns the reading — no read, a failed or killed read, or a stale one is `unmeasurable`, never `clear`
 */
export function evaluateOrgHealth({
  snapshot,
  nowMs,
  dismissed,
  shown: alreadyShown,
  open,
}: {
  snapshot: Result<IncidentSnapshot | null, OrgHealthError>;
  nowMs: number;
  dismissed: ReadonlySet<string>;
  shown: ReadonlySet<string>;
  open: ReadonlySet<string>;
}): MonitorReading {
  const standing = orgHealthStanding({ nowMs, snapshot });
  if (standing.state === "unmeasurable") {
    return { because: standing.because, monitorId: MONITOR_ID, state: "unmeasurable" };
  }
  const clear: MonitorReading = { monitorId: MONITOR_ID, state: "clear" };
  const [headline] = standing.incidents
    .flatMap((incident) => (incident.loud === undefined ? [] : [{ incident, loud: incident.loud }]))
    .toSorted((a, b) => b.loud.iso.localeCompare(a.loud.iso) || b.incident.ref.localeCompare(a.incident.ref));
  if (headline === undefined || headline.incident.phase === "resolved") {
    return clear;
  }
  const key = orgHealthKey(headline);
  const newestPosted = newestInstant({ keys: [...alreadyShown, ...dismissed, ...open] });
  const known = alreadyShown.has(key) || dismissed.has(key) || open.has(key);
  if (!known && newestPosted !== undefined && instantDigits({ iso: headline.loud.iso }) <= newestPosted) {
    return clear;
  }
  const { incident, loud } = headline;
  const subject: MonitorSubject = {
    address: incident.homepageUrl,
    details: detailLines({ incidents: standing.open, nowMs }),
    id: incident.ref,
    incident: { line: incidentLine({ incident, loud }), others: standing.open.length - 1 },
    key,
    label: `${incident.ref} ${incident.severity}, ${LOUD_WORDS[loud.kind]} at ${loud.iso}`,
    ...holdOf({ alreadyShown, dismissed, key, ref: incident.ref }),
  };
  return { monitorId: MONITOR_ID, state: "firing", subjects: [subject] };
}

/** Each loud moment, as the label names it. */
const LOUD_WORDS: Readonly<Record<LoudMoment["kind"], string>> = {
  new: "new",
  reopened: "reopened",
  "severity-changed": "severity changed",
};

/** The newest instant any of these keys carries, or undefined when none carries one. */
function newestInstant({ keys }: { keys: readonly string[] }): string | undefined {
  let newest: string | undefined;
  for (const key of keys) {
    const instant = KEY_INSTANT.exec(key)?.[1];
    if (instant !== undefined && (newest === undefined || instant > newest)) {
      newest = instant;
    }
  }
  return newest;
}

/** The hold on a key the owner has already seen — the owner's Done named as theirs, a replaced note as already shown — or none. */
function holdOf({
  key,
  ref,
  dismissed,
  alreadyShown,
}: {
  key: string;
  ref: string;
  dismissed: ReadonlySet<string>;
  alreadyShown: ReadonlySet<string>;
}): Pick<MonitorSubject, "delivery"> {
  if (dismissed.has(key)) {
    return { delivery: { kind: "hold", why: `you closed the ${ref} note, and nothing has paged since` } };
  }
  if (alreadyShown.has(key)) {
    return { delivery: { kind: "hold", why: `the ${ref} note was already shown, and nothing has paged since` } };
  }
  return {};
}

/** The incident as the sentence names it, before fitting: `A new incident: <title> (INC-98 Critical)`. */
function incidentLine({ incident, loud }: { incident: OrgIncident; loud: LoudMoment }): {
  ref: string;
  title: string;
  tail: string;
} {
  return {
    ref: `${incident.ref} ${singleSentence({ text: incident.severity })}`,
    tail: loudTail({ loud }),
    title: singleSentence({ text: incident.title }),
  };
}

/** What paged the owner, in the sentence's words — the sentence's opening, so it is capitalised. */
function loudTail({ loud }: { loud: LoudMoment }): string {
  if (loud.kind === "severity-changed") {
    return `Severity changed from ${singleSentence({ text: loud.fromSeverity })}`;
  }
  if (loud.kind === "reopened") {
    return "Reopened";
  }
  return "A new incident";
}

/**
 * A title the register reads as part of ONE sentence: a terminator followed by a space would read as a second
 * (`SECOND_SENTENCE`, `../hand/step.ts`), so each such break becomes a semicolon.
 */
function singleSentence({ text }: { text: string }): string {
  return text
    .replaceAll(/[.?!]+\s+/gu, "; ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

/**
 * The lines behind the note's disclosure row: every open incident, its status, how long it has been there, and the
 * last thing said about it — as of the moment the note floated.
 */
function detailLines({ incidents, nowMs }: { incidents: readonly OrgIncident[]; nowMs: number }): readonly string[] {
  return incidents.slice(0, DETAILS_MAX).map((incident) => {
    const since = renderAge({ ms: nowMs - Date.parse(incident.phaseChangedIso) });
    const last =
      incident.lastUpdate === undefined
        ? "no update since it was declared"
        : `last update ${renderAge({ ms: nowMs - Date.parse(incident.lastUpdate.iso) })} ago, ${incident.lastUpdate.author}: ${incident.lastUpdate.text}`;
    return fitLine({
      cap: DETAIL_LINE_CAP,
      text: `${incident.ref} ${incident.severity} · ${incident.title} — ${incident.status} ${since}: ${last}`,
    });
  });
}

/** What the card says after the incident, when others are open too. */
const othersTail = ({ others }: { others: number }): string => (others === 0 ? "" : ` · +${String(others)} more open`);

/**
 * The card's one sentence: what paged, the incident's title fitted to the room the cap leaves, its reference and
 * severity after the title, and how many others are open.
 *
 * Meaning first, the code after it (`../briefing/untranslatedCode.ts`): the owner's read of a card opening on `INC-33` is a
 * code to translate, so the title leads and the reference sits in parentheses behind it.
 *
 * @param subject the subject the evaluator built, whose `incident` it always sets
 * @returns the sentence, never longer than the cap
 */
function orgHealthWhat({ subject }: { subject: MonitorSubject }): string {
  const { incident } = subject;
  if (incident === undefined) {
    return `An incident paged on the organisation's incident system (${subject.id})`;
  }
  const { ref, title, tail } = incident.line;
  const after = ` (${ref})${othersTail({ others: incident.others })}`;
  const room = WHAT_CAP - tail.length - ": ".length - after.length;
  // The snapshot caps both severities (`SEVERITY_CAP`) so this never runs dry, but a sentence with no room for the
  // title is fitted whole rather than handed a negative cap.
  if (room <= 0) {
    return fitLine({ cap: WHAT_CAP, text: `${tail}${after}` });
  }
  return `${tail}: ${fitLine({ cap: room, text: title })}${after}`;
}

/** `org-health`: the organisation's incidents, one note floated when one starts or its severity changes. */
export const ORG_HEALTH: MonitorDefinition = {
  blurb:
    "An incident the organisation declared floats as one note when it starts or its severity changes, and Open shows its incident page; a phase move or a resolution is read quietly with `org-health status`, and healthy teams are never mentioned.",
  floats: true,
  id: MONITOR_ID,
  notice: {
    unaddressed: "nothing waits on you — this is the organisation's incident status, for you to know",
  },
  // An incident's title is the organisation's words, and one naming a bare code ("Deploy <hash> broke checkout")
  // is refused by the headline rule (`../hand/headlineCode.ts`) — the notice still floats, on this line.
  plainWhat: "A new or changed incident on the organisation's incident system — Open shows its page",
  prefix: "org",
  resolves: "the incident it names resolves, or a newer incident or severity change replaces it",
  source:
    "the store's org_health_incident row, which `slopweaver org-health read` writes from the incident channel each tick",
  unblocks: ({ subject }) =>
    fitLine({
      cap: UNBLOCKS_CAP,
      text: `nothing waits on you — ${subject.label}`.replaceAll(/\s+/gu, " "),
    }),
  what: ({ subject }) => orgHealthWhat({ subject }),
};
