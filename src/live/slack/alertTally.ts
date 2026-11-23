/**
 * The PURE tally: raw Slack messages in, a deterministic `name → times fired` count out.
 *
 * ## This is the anti-hallucination control, and that is why it is code rather than a prompt
 *
 * Every number that reaches the card comes from here. No model sees a raw message, and the one that writes the
 * card's single sentence is handed the ALREADY-COUNTED rows — so there is no step at which a count can be
 * recalled instead of counted. `../../outbound/artifact/alertSummary.ts` closes the other half by having no field
 * with which to supply a total: it sums the rows.
 *
 * ## What "recognised" means, and why the unrecognised are COUNTED rather than ignored
 *
 * An alerts channel carries three kinds of message: notifications, Slack's own bookkeeping (joins, edits, pins —
 * all of which arrive with a `subtype`), and people talking. Only the first is tallied. The other two are counted
 * into `skipped`, which the form REQUIRES, because that count is the only thing that distinguishes a quiet window
 * from an unparsed one: nine rows and eight hundred skipped is not a calm week, it is a parser that stopped
 * matching. Reporting zero rows without saying how many messages were read would have hidden exactly that.
 */
import { isRecord } from "../../lib/parsers.js";
import { ALERT_SUMMARY_ROW_LABEL_MAX } from "../../outbound/artifact/alertSummary.js";
import { type Severity } from "../../outbound/artifact/severity.js";
import { ENTITY_JOIN, LIFECYCLE_SEVERITY, matchLifecycleWord, normaliseAlertName } from "./alertName.js";

/**
 * The occurrence-specific facts a tallied row carries about its MOST RECENT message — tied together so a
 * citation or a severity dot never mixes evidence from two different occurrences.
 */
interface Occurrence {
  readonly ts: string | undefined;
  readonly embeddedLink: string | undefined;
  readonly severity: Severity | undefined;
}

/**
 * Whether `candidate` should replace `current` as a row's "most recent occurrence".
 *
 * An absent `current` is always replaced — including by a candidate with no ts, which is how the FIRST message
 * tallied into a row seeds it. A candidate with no ts never replaces a real one. Two real values compare
 * numerically, never lexicographically (a lexicographic compare would call `"9.0"` later than `"10.0"`).
 */
function newerOccurrence({
  candidate,
  current,
}: {
  candidate: Occurrence;
  current: Occurrence | undefined;
}): Occurrence {
  if (current?.ts === undefined) {
    return candidate;
  }
  if (candidate.ts === undefined) {
    return current;
  }
  return Number(candidate.ts) > Number(current.ts) ? candidate : current;
}

/** Spread an occurrence's DEFINED fields onto a row-shaped base, omitting any that are absent. */
function withOccurrence<T>({ base, occurrence }: { base: T; occurrence: Occurrence }): T & Partial<AlertTallyRow> {
  return {
    ...base,
    ...(occurrence.ts !== undefined ? { ts: occurrence.ts } : {}),
    ...(occurrence.embeddedLink !== undefined ? { embeddedLink: occurrence.embeddedLink } : {}),
    ...(occurrence.severity !== undefined ? { severity: occurrence.severity } : {}),
  };
}

/** One tallied row. Structurally an `AlertSummaryRow` minus its optional citation, so it feeds the form directly. */
export interface AlertTallyRow {
  readonly label: string;
  readonly count: number;
  /**
   * The ts of the MOST RECENT occurrence tallied into this row, when at least one counted message carried one.
   * Raw material for the Slack-permalink FALLBACK citation — building the permalink itself needs the workspace
   * URL and channel id, neither of which this pure module has, so that step is the effectful shell's job.
   */
  readonly ts?: string;
  /**
   * The link the alerting tool embedded in its OWN most-recent notification — a Datadog monitor or query URL,
   * typically — when one was found. This is the PRIMARY citation target: real telemetry the tool itself pointed
   * at, over which the Slack permalink is secondary corroboration at most. Tied to the same occurrence as `ts`,
   * never resolved independently of it, so a citation always describes one specific message.
   */
  readonly embeddedLink?: string;
  /**
   * The severity of this row's MOST RECENT occurrence — red while still firing, orange for a warning or an
   * unconfirmed (`no data`) state, green once recovered or resolved. Tied to the same occurrence as `ts` and
   * `embeddedLink`, for the same reason: a monitor that fired ten times and is CURRENTLY resolved should not
   * read as still-firing because an earlier trigger happened to be counted too.
   */
  readonly severity?: Severity;
}

/** The whole tally: what fired, how much of it there was, and how much of the window was not understood. */
export interface AlertTally {
  /** Noisiest first, ties broken on the name — a TOTAL order, so the same window tallies identically. */
  readonly rows: readonly AlertTallyRow[];
  /** Summed from the rows. Carried so a caller can report it without re-summing and getting it wrong. */
  readonly total: number;
  /** Messages read but not recognised as notifications. Never conflated with "no alerts fired". */
  readonly skipped: number;
  /** Every message the tally looked at, recognised or not — the denominator `skipped` is a numerator of. */
  readonly read: number;
  /**
   * Every alert that fired, by its STABLE name — before `rows` condensed, bounded or merged it — noisiest
   * first, ties on the name. The key a recipe row's recommendation names, because a row label changes with
   * whatever else fired that day and a stable name does not.
   */
  readonly fired: readonly FiredAlert[];
}

/** One alert that fired, by the name counting used.
 *
 * @internal — reached through {@link AlertTally}'s `fired`.
 */
export interface FiredAlert {
  readonly name: string;
  readonly count: number;
  /** The severity of its most recent occurrence, when one carried a state. */
  readonly severity?: Severity;
}

/** The slice of a Slack message this module reads. A real SDK message structurally satisfies it. */
export interface RawAlertMessage {
  readonly text?: string;
  readonly subtype?: string;
  readonly attachments?: unknown;
  readonly ts?: string;
}

/**
 * Bound a name to what the form will accept as a row label, with the elision VISIBLE.
 *
 * Applied at the END of the tally rather than per title, because {@link condenseAlertNames} runs first and usually
 * makes the trim unnecessary — trimming before condensing would cut the discriminating key off the end of a name
 * whose repeated middle was about to be dropped anyway, which is the worst of both.
 *
 * Real names reach this. Measured on one channel: a monitor title plus a folded key ran to 86 characters.
 */
function fitAlertName({ name }: { name: string }): string {
  if (name.length <= ALERT_SUMMARY_ROW_LABEL_MAX) {
    return name;
  }
  return `${name.slice(0, ALERT_SUMMARY_ROW_LABEL_MAX - 1).trimEnd()}…`;
}

/**
 * Drop the descriptive clause between a monitor's head and its key, when doing so keeps every row DISTINCT.
 *
 * ## The rendering this fixes, seen on a real card
 *
 * Three of five rows read `Integrity — Owed-End-State Invariant Violation · <key>`, so 46 characters of every one
 * of them said the same thing, and two rows were long enough that the key — the only part that differed — was
 * truncated off the end. The middle clause is the monitor restating what the channel is for; the head names the
 * monitor family and the key names the specific thing. So `head — description · key` becomes `head · key`.
 *
 * ## All-or-nothing, and only when uniqueness survives
 *
 * The description CAN be the discriminator — `X — check A · host` and `X — check B · host` differ only there — so
 * a condensed set that collides is discarded whole and the original names stand. Whole rather than per-row,
 * because a half-condensed table is a table whose rows are not comparable: a reader cannot tell whether a longer
 * label is a different monitor or the same one spelled out.
 *
 * @param rows the tallied rows
 * @returns the rows with condensed labels, or the rows unchanged when condensing would merge two of them
 */
function condenseAlertNames({ rows }: { rows: readonly AlertTallyRow[] }): readonly AlertTallyRow[] {
  const condensed = rows.map((row) => {
    const key = row.label.lastIndexOf(ENTITY_JOIN);
    const dash = row.label.indexOf(" — ");
    // Both parts must be present, and in that order: no key means nothing discriminates the row but its own
    // words, and a dash after the key is part of the key rather than a description separator.
    if (key < 0 || dash < 0 || dash > key) {
      return row;
    }
    return withOccurrence({
      base: { count: row.count, label: `${row.label.slice(0, dash)}${row.label.slice(key)}` },
      occurrence: { embeddedLink: row.embeddedLink, severity: row.severity, ts: row.ts },
    });
  });
  const distinct = new Set(condensed.map((row) => row.label));
  return distinct.size === rows.length ? condensed : rows;
}

/**
 * Bound every label and merge any two that the bound made identical.
 *
 * The merge is the honest ending rather than a nicety: two labels that agree for eighty characters are the same
 * row as far as this card can express, and leaving both would put two rows with identical text in one table, which
 * reads as a rendering bug. Their counts are summed, and their occurrence (`ts`, `embeddedLink`, `severity`) comes
 * from whichever side is more recent — carried together, never mixed, so a citation or a severity dot always
 * describes one specific occurrence.
 */
function boundAndMerge({ rows }: { rows: readonly AlertTallyRow[] }): readonly AlertTallyRow[] {
  const merged = new Map<string, { count: number; occurrence: Occurrence }>();
  for (const row of rows) {
    const label = fitAlertName({ name: row.label });
    const existing = merged.get(label);
    const occurrence = newerOccurrence({
      candidate: { embeddedLink: row.embeddedLink, severity: row.severity, ts: row.ts },
      current: existing?.occurrence,
    });
    // A label's first sighting starts at this row's own count; a later one adds to what is held.
    merged.set(label, { count: existing === undefined ? row.count : existing.count + row.count, occurrence });
  }
  return [...merged].map(([label, { count, occurrence }]) => withOccurrence({ base: { count, label }, occurrence }));
}

/**
 * The title to read a notification from: the first attachment's fallback or title, else the message text.
 *
 * Attachments first because a Slack app posts the substance there and leaves `text` empty, so reading `text`
 * alone would score a channel full of notifications as entirely unrecognised.
 *
 * Returns `undefined` rather than an empty string when there is no title at all. That is the repo's fail-loud rule
 * applied honestly: an empty-string sentinel would travel one more step into {@link normaliseAlertName} and come
 * back as "no lifecycle word", which is the right ANSWER for the wrong REASON — the message had no title to read,
 * not a title that failed to match.
 */
function alertTitle({ message }: { message: RawAlertMessage }): string | undefined {
  const first = Array.isArray(message.attachments) ? message.attachments[0] : undefined;
  if (isRecord(first)) {
    for (const field of ["fallback", "title"] as const) {
      const value = first[field];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return typeof message.text === "string" && message.text.length > 0 ? message.text : undefined;
}

/** The stable name a message tallies under, or undefined when it is not a notification at all. */
function messageAlertName({ message }: { message: RawAlertMessage }): string | undefined {
  // Slack bookkeeping — a join, an edit, a pin — carries a subtype and is never an alert. An EDIT matters most:
  // `message_changed` repeats the original alert text, so reading the text without this would count it twice.
  if (typeof message.subtype === "string" && message.subtype.length > 0) {
    return undefined;
  }
  const title = alertTitle({ message });
  return title === undefined ? undefined : normaliseAlertName({ title });
}

/**
 * A message's own severity, from its lifecycle word — or undefined when it is not a notification, or its word
 * is somehow absent from {@link LIFECYCLE_SEVERITY} (unreachable while that map stays exhaustive over
 * {@link ./alertName.LIFECYCLE_WORDS}; `noUncheckedIndexedAccess` is what makes that absence a checked case rather than an
 * assumption).
 */
function messageSeverity({ message }: { message: RawAlertMessage }): Severity | undefined {
  if (typeof message.subtype === "string" && message.subtype.length > 0) {
    return undefined;
  }
  const title = alertTitle({ message });
  if (title === undefined) {
    return undefined;
  }
  const match = matchLifecycleWord({ title: title.trim() });
  return match === undefined ? undefined : LIFECYCLE_SEVERITY[match.word];
}

/**
 * Slack's own generic link syntax inside a legacy attachment's `text`: `<url|label>` or a bare `<url>`.
 *
 * This is a Slack attachment convention, not any one vendor's — any app posting a legacy attachment can put a
 * link here, and Slack renders it as a clickable chip regardless of who posted it.
 */
const ATTACHMENT_TEXT_LINK = /<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/;

/**
 * Decode the handful of HTML entities Slack escapes inside a legacy attachment's `text`, so a URL extracted from
 * it is well-formed. Not a general HTML decoder — just the three entities that would otherwise corrupt a URL
 * (`&amp;` most of all: an unresolved query string reads as one parameter instead of several).
 */
function decodeAttachmentEntities({ text }: { text: string }): string {
  return text.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

/**
 * The link the alerting tool embedded in its OWN notification, when there is one — never a link this repo
 * constructs. Slack's `title_link` attachment field first (a direct, structured field many alerting apps set
 * to the thing that fired), else the first link Slack would render inside the attachment's own `text`.
 *
 * Deliberately vendor-agnostic: both fields are plain Slack legacy-attachment conventions, readable without
 * knowing which tool posted the message. A Datadog alert happens to populate one or the other in practice, but
 * nothing here parses Datadog's query language or constructs a Datadog URL.
 *
 * @param message the raw Slack message
 * @returns the embedded link, or undefined when the attachment carries neither
 */
function messageEmbeddedLink({ message }: { message: RawAlertMessage }): string | undefined {
  const first = Array.isArray(message.attachments) ? message.attachments[0] : undefined;
  if (!isRecord(first)) {
    return undefined;
  }
  const titleLink = first["title_link"];
  if (typeof titleLink === "string" && titleLink.length > 0) {
    return titleLink;
  }
  const text = first["text"];
  if (typeof text !== "string") {
    return undefined;
  }
  return ATTACHMENT_TEXT_LINK.exec(decodeAttachmentEntities({ text }))?.[1];
}

/**
 * Tally the notifications in a window of raw Slack messages. PURE and total.
 *
 * A message is skipped when it carries a Slack `subtype` (a join, an edit, a pin — bookkeeping rather than an
 * alert) or when its title carries no lifecycle word. Rows come back noisiest first, ties broken on the name, so
 * the same window produces a byte-identical card — which the edit path re-renders and therefore depends on.
 *
 * Counting happens on the FULL name, then {@link condenseAlertNames} shortens what repeats and
 * {@link boundAndMerge} bounds it. That order matters: counting on a shortened name would let a condensation
 * decide which alerts are the same thing, and the whole point of the tally is that only identity does.
 *
 * Each row also carries the `ts`, `embeddedLink` and `severity` of its MOST RECENT counted occurrence, when at
 * least one message had one — compared numerically across every message tallied into that name, not just the
 * last one seen, so message order never changes which occurrence survives, and all three always describe the
 * same message.
 *
 * @param messages the raw messages, in any order
 * @returns the rows, the summed total, the skipped count and how many messages were read
 */
export function tallyAlerts({ messages }: { messages: readonly RawAlertMessage[] }): AlertTally {
  const counts = new Map<string, { count: number; occurrence: Occurrence }>();
  let skipped = 0;
  for (const message of messages) {
    const name = messageAlertName({ message });
    if (name === undefined) {
      skipped += 1;
      continue;
    }
    const existing = counts.get(name);
    const occurrence = newerOccurrence({
      candidate: {
        embeddedLink: messageEmbeddedLink({ message }),
        severity: messageSeverity({ message }),
        ts: message.ts,
      },
      current: existing?.occurrence,
    });
    // A name's first sighting counts one; a later one adds one to what is held.
    counts.set(name, { count: existing === undefined ? 1 : existing.count + 1, occurrence });
  }
  const counted = [...counts].map(([label, { count, occurrence }]) =>
    withOccurrence({ base: { count, label }, occurrence }),
  );
  const rows = boundAndMerge({ rows: condenseAlertNames({ rows: counted }) }).toSorted(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label),
  );
  const fired = counted
    .map((row): FiredAlert => {
      if (row.severity === undefined) {
        return { count: row.count, name: row.label };
      }
      return { count: row.count, name: row.label, severity: row.severity };
    })
    .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  return {
    fired,
    read: messages.length,
    rows,
    skipped,
    total: rows.reduce((sum, row) => sum + row.count, 0),
  };
}

/** A tally folded to fit the form's row cap: the rows that survived, and an honest account of the rest. */
export interface FoldedTally {
  readonly rows: readonly AlertTallyRow[];
  /** The quieter monitors the row cap left out, and how many times they fired between them. */
  readonly omitted?: { readonly monitors: number; readonly count: number };
}

/**
 * Fold a tally to at most `limit` rows, and SAY what was left out.
 *
 * A real alerts channel over a week carries more distinct monitors than the card's table can hold, so something
 * has to give. The choice is between dropping the quiet tail silently and dropping it out loud, and this repo has
 * a name for the first one — the `../../outbound/strictForm.ts` case is the same shape: a truncation nobody is
 * told about reads as complete coverage. So the tail becomes a stated count, and the form renders it.
 *
 * The tail is the QUIET end because the rows arrive noisiest first, which is the question an alert summary
 * answers. Nothing is re-ordered here.
 *
 * @param tally the full tally
 * @param limit how many rows the card can carry
 * @returns the kept rows, plus the omitted account when anything was left out
 */
export function foldTally({ tally, limit }: { tally: AlertTally; limit: number }): FoldedTally {
  if (tally.rows.length <= limit) {
    return { rows: tally.rows };
  }
  const kept = tally.rows.slice(0, limit);
  const dropped = tally.rows.slice(limit);
  return {
    omitted: { count: dropped.reduce((sum, row) => sum + row.count, 0), monitors: dropped.length },
    rows: kept,
  };
}
