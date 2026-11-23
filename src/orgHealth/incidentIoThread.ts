/**
 * One incident.io announcement's thread, read as WHEN the incident entered its phase and what was last said.
 *
 * Each update is a thread reply by incident.io's bot, its text
 * `<who> updated INC-98 (<title>):  Severity: *Critical* | Status: ~Fixing~ → *Monitoring*  <their words>`, or
 * `Status: *Fixing*` when the status did not move. Auto-closure reads `<http://incident.io|incident.io>
 * (auto-closure) updated …`. MEASURED, as `./incidentIo.ts` records.
 *
 * Pure: no I/O, no clock.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { isSlackTs, slackTsToIso } from "#lib/slackTs.js";

import { compareSlackTimestamps } from "../live/slack/selection.js";
import { type OrgHealthError, OrgHealthErrors } from "./errors.js";
import {
  appIdOf,
  classifyIncidentIoRoot,
  editedTsOf,
  type IncidentIoRoot,
  incidentPhaseOf,
  oneLine,
  readable,
} from "./incidentIo.js";
import { lastTouchedTs } from "./policy.js";
import type { IncidentPhase, IncidentUpdate, PhaseProvenance, ThreadIncident } from "./types.js";

/** The opening every update carries — a reply that has it and then fails {@link UPDATE} is malformed, not chatter. */
const UPDATE_OPENING = / updated INC-\d+ \(/u;

/** One update, in full. */
const UPDATE =
  /^(?<author>.+?) updated (?<ref>INC-\d+) \((?<title>[\s\S]*?)\):\s+Severity: \*(?<severity>[^*]+)\* \| Status: (?:~(?<from>[^~]+)~ → )?\*(?<status>[^*]+)\*(?<body>[\s\S]*)$/u;

/** Where incident.io's own block furniture starts after the update's words. */
const UPDATE_FURNITURE = /\n\s*Incident updated\b/u;

/**
 * One parsed update, with what dating the phase needs. `ts` is Slack's own, kept beside the whole-second `iso`
 * because ordering needs its fraction: two updates, or an update and an edit, can land in the same second.
 */
type ParsedUpdate = IncidentUpdate & {
  readonly moved: boolean;
  readonly phase: IncidentPhase;
  readonly severity: string;
  readonly title: string;
  readonly ts: string;
};

/**
 * The incident one announcement and its thread describe.
 *
 * The root's status is the current state — incident.io edits it on every change — and the thread supplies only
 * WHEN the incident entered that phase and what was last said. A reply counts as an update when its bot is the one
 * that announced, or belongs to the same Slack app (`appIdOf`): a reinstalled integration posts a new bot id into an
 * old incident's thread, under the same app. Trust is by that app identity, which Slack sets,
 * never by which bots the channel's history once showed to be incident.io's — that set only grows, and a bot it once
 * held would be trusted for as long as its message stayed in the channel. A reply by anyone else is conversation and
 * is not read; a reply by incident.io that opens like an update and does not parse as one is refused, because skipping
 * it could hide the very transition the note is keyed on.
 *
 * @param root the parsed announcement
 * @param pages the whole thread as `conversations.replies` returned it, page by page, each repeating the root
 * @returns the incident, or why its thread could not be read as one
 */
export function parseIncidentIoThread({
  root,
  pages,
}: {
  root: IncidentIoRoot;
  pages: readonly (readonly unknown[])[];
}): Result<ThreadIncident, OrgHealthError> {
  const declaredIso = slackTsToIso({ ts: root.ts });
  if (declaredIso === undefined) {
    return err(OrgHealthErrors.announcementMalformed({ detail: "its ts is not a Slack timestamp", ts: root.ts }));
  }
  const moved = rootMovedSince({ pages, root });
  if (moved !== undefined) {
    return err(moved);
  }
  const messages = pages.flat();
  const parsed: ParsedUpdate[] = [];
  for (const message of messages) {
    const update = parseUpdate({ message, root });
    if (update.isErr()) {
      return err(update.error);
    }
    if (update.value !== undefined) {
      parsed.push(update.value);
    }
  }
  const updates = parsed.toSorted((a, b) => compareSlackTimestamps({ left: a.ts, right: b.ts }));
  const cycled = movedAndBack({ messages, root, updates });
  if (cycled !== undefined) {
    return err(cycled);
  }
  const behind = rootBehind({ root, updates });
  if (behind !== undefined) {
    return err(behind);
  }
  const entered = phaseEntered({ declaredIso, edited: root.editedTs !== undefined, phase: root.phase, updates });
  return ok({
    channelId: root.channelId,
    declaredIso,
    homepageUrl: root.homepageUrl,
    lastUpdate: lastOf({ updates }),
    lead: root.lead,
    phase: root.phase,
    phaseChangedIso: entered.iso,
    phaseProvenance: entered.provenance,
    ref: root.ref,
    severity: root.severity,
    status: root.status,
    title: root.title,
  });
}

/** Every root field the incident carries forward, so a copy differing in any of them is a different state. */
const STATE_FIELDS = ["status", "severity", "title", "ref", "homepageUrl", "channelId", "lead"] as const;

/**
 * Why the thread's own copy of the root does not describe the state the channel read parsed, or undefined when it does.
 *
 * `conversations.replies` returns the root again, as it stands at the thread read. Edited in between, the history
 * root is older than the updates beside it, so the read is refused rather than mixing two states. The copy is parsed as an announcement by the root's own bot and every field the incident carries
 * forward is compared, so a moved status, severity or title is caught whether or not the copy carries an edit stamp.
 * The stamp alone decides nothing: an edit that leaves every one of those fields alone is cosmetic, whichever copy is
 * newer. A copy that is missing or does not parse proves nothing, and absence is never read as agreement. Slack
 * repeats the root at the head of EVERY replies page, so every page holding anything must carry one and each copy is
 * checked: an edit
 * between two pages leaves the later replies beside a root only the later page shows.
 */
function rootMovedSince({
  root,
  pages,
}: {
  root: IncidentIoRoot;
  pages: readonly (readonly unknown[])[];
}): OrgHealthError | undefined {
  if (pages.length === 0) {
    return OrgHealthErrors.rootMoved({ detail: "the thread read returned no page", ref: root.ref });
  }
  for (const [index, page] of pages.entries()) {
    const copies = page.filter((message) => isRecord(message) && message["ts"] === root.ts);
    // A zero-item page that still carries a cursor is a real Slack shape (`live/slack/pagination.test.ts`); it holds
    // no reply to mis-pair, so only a page with something on it owes the root.
    if (copies.length === 0 && (page.length > 0 || pages.length === 1)) {
      return OrgHealthErrors.rootMoved({
        detail: `page ${index + 1} of the thread read did not return the announcement`,
        ref: root.ref,
      });
    }
    const moved = copies.map((copy) => copyMoved({ copy, root })).find((detail) => detail !== undefined);
    if (moved !== undefined) {
      return OrgHealthErrors.rootMoved({ detail: moved, ref: root.ref });
    }
  }
  return undefined;
}

/**
 * Why the thread's copy of the root is a later moment than the channel read's even though every field agrees, or
 * undefined when it is not.
 *
 * A move away and back between the two reads leaves the fields where they were, so {@link rootMovedSince} passes it;
 * the thread still records it, as an edit stamp the channel read's copy does not carry and updates posted after that
 * copy's last touch. Those updates are the newer moment's, and would date a phase beside a root read before them
 * An edit stamp with no update after it is cosmetic, and still reads.
 */
function movedAndBack({
  messages,
  root,
  updates,
}: {
  messages: readonly unknown[];
  root: IncidentIoRoot;
  updates: readonly ParsedUpdate[];
}): OrgHealthError | undefined {
  const touched = lastTouchedTs({ root });
  const restamped = messages.some(
    (message) =>
      isRecord(message) &&
      message["ts"] === root.ts &&
      lastTouchedTs({ root: { editedTs: editedTsOf({ raw: message }), ts: root.ts } }) !== touched,
  );
  const since = updates.filter((one) => compareSlackTimestamps({ left: one.ts, right: touched }) > 0);
  if (!restamped || since.length === 0) {
    return undefined;
  }
  return OrgHealthErrors.rootMoved({
    detail: `it was edited again, and ${String(since.length)} update(s) posted, after the copy the channel read saw`,
    ref: root.ref,
  });
}

/** How one copy of the root differs from the channel read's, or undefined when it describes the same state. */
function copyMoved({ copy, root }: { copy: unknown; root: IncidentIoRoot }): string | undefined {
  if (!isRecord(copy)) {
    return "the thread's copy of it no longer parses";
  }
  const current = classifyIncidentIoRoot({ incidentBots: new Set([root.botId]), raw: copy });
  if (current.isErr() || current.value.kind !== "incident") {
    return "the thread's copy of it no longer parses";
  }
  const now = current.value.root;
  const moved = STATE_FIELDS.filter((field) => now[field] !== root[field]);
  if (moved.length > 0) {
    return `its ${moved.join(", ")} moved`;
  }
  return undefined;
}

/**
 * Why the root has not caught up with its own thread, or undefined when it has.
 *
 * incident.io posts an update and THEN edits the announcement, so a read between the two sees an update naming
 * another status, severity or title than the root's. Read whole, that would
 * publish the root's fields beside an update that already left them. The status is compared rather than the phase,
 * since two statuses share one (`Documenting` and `Closed` are both resolved). Only an update NEWER than the root's
 * last edit is evidence of that window: a root edited after its newest update has moved with nothing said, which is a
 * real state, and stays readable. Both are compared as Slack's own `ts`, fraction included, so an update and an edit
 * in the same second still order. EVERY update past that edit is compared, not only the
 * newest: two updates going away and back before the edit leave the newest agreeing with a root that never saw the
 * move between them.
 */
function rootBehind({
  root,
  updates,
}: {
  root: IncidentIoRoot;
  updates: readonly ParsedUpdate[];
}): OrgHealthError | undefined {
  const differingFrom = ({ one }: { one: ParsedUpdate }): readonly (typeof UPDATE_STATE_FIELDS)[number][] =>
    UPDATE_STATE_FIELDS.filter((field) => one[field] !== root[field]);
  if (updates.every((one) => differingFrom({ one }).length === 0)) {
    return undefined;
  }
  const touchedTs = lastTouchedTs({ root });
  if (!isSlackTs({ ts: touchedTs })) {
    return OrgHealthErrors.announcementMalformed({ detail: "its edit stamp is not a Slack timestamp", ts: root.ts });
  }
  const behind = updates.find(
    (one) => compareSlackTimestamps({ left: one.ts, right: touchedTs }) > 0 && differingFrom({ one }).length > 0,
  );
  if (behind === undefined) {
    return undefined;
  }
  const detail = differingFrom({ one: behind })
    .map((field) => `${field} ${root[field]} against ${behind[field]}`)
    .join(", ");
  return OrgHealthErrors.rootBehind({ detail, iso: behind.iso, ref: root.ref });
}

/** The root fields an update restates, so a newer one differing in any of them is a state the root has not reached. */
const UPDATE_STATE_FIELDS = ["status", "severity", "title"] as const;

/** The newest update without its parse bookkeeping, or absent when there is none. */
function lastOf({ updates }: { updates: readonly ParsedUpdate[] }): IncidentUpdate | undefined {
  const last = updates.at(-1);
  if (last === undefined) {
    return undefined;
  }
  return { author: last.author, iso: last.iso, status: last.status, text: last.text };
}

/**
 * When the incident entered its current phase, and on what evidence.
 *
 * - `update`: the first update of the trailing run whose status maps to the current phase MOVED the status
 *   (`~Fixing~ → *Monitoring*`) — incident.io's own record of the transition.
 * - `declared`: every update, if any, is in the current phase and none moved it, and the root was never edited — so it
 *   has been there since declaration. An EDITED root may have moved before any update with nothing in the thread to
 *   say so, and is `inferred` at its declaration, for a read to date by sighting. A
 *   declared phase a later edit turns inferred keeps its instant, since `./sightings.ts` holds a phase's last date.
 * - `inferred`: the root says a phase no moving update reached. The instant is the last update BEFORE the run — the
 *   newest one still in the old phase — and never the root's `edited.ts`: a cosmetic edit rewrites that without a
 *   status change, and keyed on it the same phase would be told twice. Never the run's own
 *   opening either: a first same-phase update arriving later would move the instant, re-keying a phase that held.
 *
 * A note is keyed on this instant, so it must not move while the phase holds: a further update in the same phase
 * only lengthens the run, and leaves every branch above where it was.
 *
 * @returns the instant, ISO-8601, and which rule gave it
 */
function phaseEntered({
  declaredIso,
  edited,
  phase,
  updates,
}: {
  declaredIso: string;
  edited: boolean;
  phase: IncidentPhase;
  updates: readonly { readonly iso: string; readonly moved: boolean; readonly phase: IncidentPhase }[];
}): { readonly iso: string; readonly provenance: PhaseProvenance } {
  let start = updates.length;
  while (start > 0 && updates[start - 1]!.phase === phase) {
    start -= 1;
  }
  const opening = updates[start];
  if (opening?.moved === true) {
    return { iso: opening.iso, provenance: "update" };
  }
  if (start === 0) {
    return { iso: declaredIso, provenance: edited ? "inferred" : "declared" };
  }
  return { iso: updates[start - 1]!.iso, provenance: "inferred" };
}

/** One thread message as an update, `undefined` when it is not one, or why one could not be parsed. */
function parseUpdate({
  message,
  root,
}: {
  message: unknown;
  root: IncidentIoRoot;
}): Result<ParsedUpdate | undefined, OrgHealthError> {
  if (!isRecord(message) || typeof message["ts"] !== "string" || message["ts"] === root.ts) {
    return ok(undefined);
  }
  const ts = message["ts"];
  const text = message["text"];
  const sameApp = root.appId !== undefined && appIdOf({ raw: message }) === root.appId;
  const incidentIo = typeof message["bot_id"] === "string" && (message["bot_id"] === root.botId || sameApp);
  if (!incidentIo || typeof text !== "string" || !UPDATE_OPENING.test(text)) {
    return ok(undefined);
  }
  const match = UPDATE.exec(text);
  const iso = slackTsToIso({ ts });
  if (match?.groups === undefined || iso === undefined) {
    return err(OrgHealthErrors.announcementMalformed({ detail: "an update did not parse", ts }));
  }
  const { author, ref, status, from, body, severity, title } = match.groups;
  if (ref !== root.ref) {
    return err(OrgHealthErrors.refMismatch({ expected: root.ref, found: ref!, ts }));
  }
  const phase = incidentPhaseOf({ ref: root.ref, status: status! });
  if (phase.isErr()) {
    return err(phase.error);
  }
  return ok({
    author: readable({ text: author! }),
    iso,
    moved: from !== undefined,
    phase: phase.value,
    severity: severity!,
    status: status!,
    text: oneLine({ text: body!.split(UPDATE_FURNITURE)[0]! }),
    title: oneLine({ text: title! }),
    ts,
  });
}
