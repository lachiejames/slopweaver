/**
 * incident.io's Slack announcements, read as status-page incidents.
 *
 * ## What incident.io writes, MEASURED against the live channel
 *
 * Repro: `slopweaver slack read-thread <an #incidents announcement permalink> --json`.
 *
 * - **One announcement per incident**, posted by the integration's bot and EDITED IN PLACE on every status change:
 *   a root read live can say `:pager: *Status*: Closed`, edited at the auto-closure, while a corpus copy taken
 *   before that edit still says an earlier status. So the root's status is the current state, and nothing else is.
 * - Its `text` is `[<Severity>] <title>`; a section block carries `:fire: *Severity*: …`, `:pager: *Status*: …`,
 *   `*Incident Lead*: <…|@name>` and `*Channel*: <#C…>`; an actions block carries the
 *   `https://app.incident.io/<org>/incidents/<n>` homepage button. Slack's message metadata reads
 *   `event_type: "incident_message"` when the history read asks for metadata.
 * - **Each update is a thread reply by the same bot**, read by `./incidentIoThread.ts`.
 * - Statuses seen: Investigating, Fixing, Monitoring, Documenting, Closed. Anything else is REFUSED
 *   ({@link incidentPhaseOf}), so a new word is noticed and mapped rather than guessed into a phase.
 *
 * The same bot also posts a weekly policy report into the channel. It carries the SAME `incident_message` metadata,
 * but its text is prose rather than `[<Severity>] <title>`, and {@link classifyIncidentIoRoot} answers `other` for it.
 *
 * Pure: no I/O, no clock.
 */
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type OrgHealthError, OrgHealthErrors } from "./errors.js";
import type { IncidentPhase } from "./types.js";

/** The incident.io message metadata event type an announcement carries. */
const INCIDENT_EVENT_TYPE = "incident_message";

/**
 * incident.io's status words, each with the status-page phase it is. Documenting is resolved: the fix is out and
 * stable, and what is left is the write-up — an incident moves Monitoring → Documenting once its lead posts that
 * the symptom has stopped recurring, so nothing user-facing is still open by then.
 */
const STATUS_PHASES: Readonly<Record<string, IncidentPhase>> = {
  Closed: "resolved",
  Documenting: "resolved",
  Fixing: "identified",
  Investigating: "investigating",
  Monitoring: "monitoring",
};

/** An incident's homepage, the one place its number is stated by incident.io itself rather than typed by a person. */
const HOMEPAGE = /^https:\/\/app\.incident\.io\/[A-Za-z0-9-]+\/incidents\/(\d+)$/u;

/** The announcement's own `text`: `[<Severity>] <title>`. */
const ROOT_TEXT = /^\[[^\]]+\]\s+(\S[\s\S]*)$/u;

/** One `*Field*: value` line of the announcement's details section. */
const fieldLine = ({ label }: { label: string }): RegExp => new RegExp(`\\*${label}\\*: ([^\\n]+)`, "gu");

/** A Slack mrkdwn link, `<url|label>` — its label is what a reader sees. */
const MRKDWN_LINK = /<[^|>]+\|([^>]+)>/gu;

/** The channel reference `<#C…>` or `<#C…|name>`. */
const CHANNEL_REF = /^<#([A-Z0-9]+)(?:\|[^>]*)?>$/u;

/** An announcement, parsed: everything the root says, before its thread is read. */
export interface IncidentIoRoot {
  readonly ts: string;
  readonly ref: string;
  readonly title: string;
  readonly severity: string;
  readonly status: string;
  readonly phase: IncidentPhase;
  readonly homepageUrl: string;
  readonly channelId?: string | undefined;
  readonly lead?: string | undefined;
  /** The bot that posted it, one of the authors whose replies count as updates. */
  readonly botId: string;
  /** The Slack app that bot belongs to, when the message names it ({@link appIdOf}). */
  readonly appId?: string | undefined;
  /** When it was last edited, or absent for an announcement never edited since it was posted. */
  readonly editedTs?: string | undefined;
  /**
   * Its thread's newest reply as the channel read saw it, or absent for a thread nobody replied in. incident.io posts an
   * update BEFORE it edits the root, so a reopening can show here while the root still reads long resolved.
   */
  readonly latestReplyTs?: string | undefined;
}

/**
 * The status-page phase of one incident.io status.
 *
 * @param status incident.io's status word
 * @param ref the incident, named in the refusal
 * @returns the phase, or `UNKNOWN_STATUS` for a word nothing maps
 */
export function incidentPhaseOf({
  status,
  ref,
}: {
  status: string;
  ref: string;
}): Result<IncidentPhase, OrgHealthError> {
  const phase = STATUS_PHASES[status];
  if (phase === undefined) {
    return err(OrgHealthErrors.unknownStatus({ ref, status }));
  }
  return ok(phase);
}

/**
 * The Slack app a bot's message belongs to: its top-level `app_id`, else its `bot_profile.app_id`. Slack sets both on
 * a bot's message and no poster chooses them; an app keeps its id when its install, and so its bot id, is replaced.
 * That is Slack's message shape, not measured on the incident channel: the live shaped read shows neither field.
 *
 * @param raw one Slack message
 * @returns the app id, or undefined when the message names none
 */
export function appIdOf({ raw }: { raw: unknown }): string | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (typeof raw["app_id"] === "string") {
    return raw["app_id"];
  }
  const profile = raw["bot_profile"];
  return isRecord(profile) && typeof profile["app_id"] === "string" ? profile["app_id"] : undefined;
}

/**
 * The bots a channel shows to be incident.io's: each that posted a top-level message carrying the `incident_message`
 * metadata (the weekly report included), or `[<Severity>] <title>` text with an incident homepage button. Two features
 * only incident.io's app puts on one message, so another bot linking an incident is never mistaken for it.
 *
 * @param messages the channel's whole history, as read with metadata
 * @returns the bot ids
 */
export function incidentBotsOf({ messages }: { messages: readonly unknown[] }): ReadonlySet<string> {
  const bots = new Set<string>();
  for (const raw of messages) {
    if (!isRecord(raw) || typeof raw["bot_id"] !== "string") {
      continue;
    }
    const reply = typeof raw["thread_ts"] === "string" && raw["thread_ts"] !== raw["ts"];
    const metadata = raw["metadata"];
    const tagged = isRecord(metadata) && metadata["event_type"] === INCIDENT_EVENT_TYPE;
    const titled = typeof raw["text"] === "string" && ROOT_TEXT.test(raw["text"]);
    if (!reply && (tagged || (titled && homepageUrls({ blocks: raw["blocks"] }).length > 0))) {
      bots.add(raw["bot_id"]);
    }
  }
  return bots;
}

/**
 * Whether a channel message is an incident.io announcement, and if so, what it says.
 *
 * @param raw one `conversations.history` message, read with metadata
 * @param incidentBots the bots the same channel shows to be incident.io's ({@link incidentBotsOf})
 * @returns `other` for anything that is not an announcement, the parsed root for one, or why an announcement
 *   could not be parsed
 */
export function classifyIncidentIoRoot({
  raw,
  incidentBots,
}: {
  raw: unknown;
  incidentBots: ReadonlySet<string>;
}): Result<{ readonly kind: "other" } | { readonly kind: "incident"; readonly root: IncidentIoRoot }, OrgHealthError> {
  if (!isRecord(raw)) {
    return ok({ kind: "other" });
  }
  const ts = raw["ts"];
  const verdict = candidacy({ incidentBots, raw });
  if (verdict === "other") {
    return ok({ kind: "other" });
  }
  if (verdict === "unattributable") {
    return err(
      OrgHealthErrors.announcementMalformed({
        detail: "no message in the channel shows which bot is incident.io's",
        ts: String(ts),
      }),
    );
  }
  const reply = typeof raw["thread_ts"] === "string" && raw["thread_ts"] !== ts;
  if (typeof ts !== "string") {
    return err(OrgHealthErrors.announcementMalformed({ detail: "it carries no ts", ts: String(ts) }));
  }
  if (reply) {
    return err(OrgHealthErrors.announcementMalformed({ detail: "it reads as a reply in another thread", ts }));
  }
  const parsed = parseRoot({ raw, ts });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ kind: "incident", root: parsed.value });
}

/**
 * Whether one channel message is a candidate announcement, passed over, or a signed one no bot can be told for.
 *
 * An announcement has three features of its own: `[<Severity>] <title>` text, the details' `*Severity*:` and
 * `*Status*:` lines (an update writes `Severity: *…*` instead), and an incident homepage button. The weekly policy
 * report carries the same `incident_message` metadata but none of the three (MEASURED live,
 * `1790611210.160899`). A candidate is parsed STRICTLY, so drift is refused rather than read as no incident:
 * - from the bot the channel shows to be incident.io's ({@link incidentBotsOf}), any ONE feature makes a candidate;
 * - from another bot, nothing does, so a bot linking an incident is never refused; and when the channel shows no
 *   incident.io bot at all, a SIGNED message (the title with the metadata or the details) refuses the read, since
 *   which bot it is cannot be told — a bare button does not, being what another bot's link looks like;
 * - with no bot id, the title with the metadata or the details, or a button, makes one — a person's bracketed
 *   message is none of those.
 *
 * A reply broadcast to the channel shows in history too, and an update may carry the homepage button — so a reply
 * Slack marks a broadcast is passed over, and so is any other unless it carries the announcement's own text
 * signature, which no update does: then its `thread_ts` drifted, and the caller refuses it.
 *
 * The residue, stated: an announcement whose three features all drift at once reads like the weekly report, and in a
 * channel showing no incident.io bot, one left with only its button reads like another bot's link.
 */
function candidacy({
  raw,
  incidentBots,
}: {
  raw: Record<string, unknown>;
  incidentBots: ReadonlySet<string>;
}): "candidate" | "other" | "unattributable" {
  const { titled, fielded, button, signed } = featuresOf({ raw });
  const reply = typeof raw["thread_ts"] === "string" && raw["thread_ts"] !== raw["ts"];
  if (reply && (!signed || raw["subtype"] === "thread_broadcast")) {
    return "other";
  }
  const botId = raw["bot_id"];
  if (typeof botId === "string" && incidentBots.has(botId)) {
    return titled || fielded || button ? "candidate" : "other";
  }
  if (!signed && !button) {
    return "other";
  }
  if (typeof botId !== "string") {
    return "candidate";
  }
  return incidentBots.size > 0 || !signed ? "other" : "unattributable";
}

/** Which of an announcement's own features one message carries, and whether its text is SIGNED as one. */
function featuresOf({ raw }: { raw: Record<string, unknown> }): {
  readonly titled: boolean;
  readonly fielded: boolean;
  readonly button: boolean;
  readonly signed: boolean;
} {
  const metadata = raw["metadata"];
  const tagged = isRecord(metadata) && metadata["event_type"] === INCIDENT_EVENT_TYPE;
  const titled = typeof raw["text"] === "string" && ROOT_TEXT.test(raw["text"]);
  const details = sectionTexts({ blocks: raw["blocks"] }).join("\n");
  const fielded = fieldLine({ label: "Severity" }).test(details) && fieldLine({ label: "Status" }).test(details);
  const button = homepageUrls({ blocks: raw["blocks"] }).length > 0;
  return { button, fielded, signed: titled && (tagged || fielded), titled };
}

/** The fields of an announcement, once it is known to be one. */
function parseRoot({ raw, ts }: { raw: Record<string, unknown>; ts: string }): Result<IncidentIoRoot, OrgHealthError> {
  const malformed = ({ detail }: { detail: string }): Result<never, OrgHealthError> =>
    err(OrgHealthErrors.announcementMalformed({ detail, ts }));
  const botId = raw["bot_id"];
  if (typeof botId !== "string") {
    return malformed({ detail: "it carries no bot id" });
  }
  const text = typeof raw["text"] === "string" ? ROOT_TEXT.exec(raw["text"]) : null;
  if (text === null) {
    return malformed({ detail: "its text is not `[<Severity>] <title>`" });
  }
  const details = sectionTexts({ blocks: raw["blocks"] }).join("\n");
  const severity = singleField({ label: "Severity", text: details });
  const status = singleField({ label: "Status", text: details });
  if (severity === undefined || status === undefined) {
    return malformed({ detail: "its details carry no single Severity and Status" });
  }
  const homepages = homepageUrls({ blocks: raw["blocks"] });
  const [homepageUrl] = homepages;
  if (homepages.length !== 1 || homepageUrl === undefined) {
    return malformed({ detail: `it carries ${String(homepages.length)} incident homepage buttons, not one` });
  }
  const ref = `INC-${HOMEPAGE.exec(homepageUrl)![1]!}`;
  const phase = incidentPhaseOf({ ref, status });
  if (phase.isErr()) {
    return err(phase.error);
  }
  const channel = singleField({ label: "Channel", text: details });
  const lead = singleField({ label: "Incident Lead", text: details });
  return ok({
    appId: appIdOf({ raw }),
    botId,
    channelId: channel === undefined ? undefined : CHANNEL_REF.exec(channel)?.[1],
    editedTs: editedTsOf({ raw }),
    homepageUrl,
    latestReplyTs: latestReplyTsOf({ raw }),
    lead: lead === undefined ? undefined : readable({ text: lead }).replace(/^@/u, ""),
    phase: phase.value,
    ref,
    severity,
    status,
    title: oneLine({ text: text[1]! }),
    ts,
  });
}

/** Every section block's mrkdwn text — where the announcement's details live. */
function sectionTexts({ blocks }: { blocks: unknown }): readonly string[] {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks.flatMap((block) => {
    if (!isRecord(block) || block["type"] !== "section" || !isRecord(block["text"])) {
      return [];
    }
    const text = block["text"]["text"];
    return typeof text === "string" ? [text] : [];
  });
}

/** Every incident homepage button url in the announcement's actions blocks. */
function homepageUrls({ blocks }: { blocks: unknown }): readonly string[] {
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks.flatMap((block) => {
    if (!isRecord(block) || block["type"] !== "actions" || !Array.isArray(block["elements"])) {
      return [];
    }
    return block["elements"].flatMap((element) => {
      const url = isRecord(element) ? element["url"] : undefined;
      return typeof url === "string" && HOMEPAGE.test(url) ? [url] : [];
    });
  });
}

/** The value of a field named exactly once, or `undefined` when it is absent or named twice. */
function singleField({ label, text }: { label: string; text: string }): string | undefined {
  const values = [...text.matchAll(fieldLine({ label }))].map((match) => match[1]!.trim());
  if (values.length !== 1) {
    return undefined;
  }
  return values[0];
}

/**
 * When the message was last edited.
 *
 * @returns the edit's Slack ts, or `undefined` for one never edited
 */
export function editedTsOf({ raw }: { raw: Record<string, unknown> }): string | undefined {
  const edited = raw["edited"];
  if (!isRecord(edited) || typeof edited["ts"] !== "string") {
    return undefined;
  }
  return edited["ts"];
}

/** The thread's newest reply's Slack ts as `conversations.history` carries it, or `undefined` for none. */
function latestReplyTsOf({ raw }: { raw: Record<string, unknown> }): string | undefined {
  const latest = raw["latest_reply"];
  if (typeof latest !== "string") {
    return undefined;
  }
  return latest;
}

/**
 * Mrkdwn links folded to their labels.
 *
 * @returns the text a reader sees
 */
export function readable({ text }: { text: string }): string {
  return text.replaceAll(MRKDWN_LINK, "$1").trim();
}

/**
 * Mrkdwn links folded to their labels and whitespace folded, so a value reads as one line.
 *
 * @returns the one line
 */
export function oneLine({ text }: { text: string }): string {
  return readable({ text }).replaceAll(/\s+/gu, " ").trim();
}
