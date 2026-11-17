/**
 * From a RETRIEVED record to the sanctioned verb that reads the REAL thing.
 *
 * ## Why this exists
 *
 * The owner's ruling on what the world model is for: it is _"one of the tools in the toolkit … the agent
 * would use it and lean on it, but you don't take that at face value — you check, verify."_ Concretely, and
 * in practice: when a search surfaces a Notion doc that is largely about the question, pull the whole doc
 * with the Slopweaver verb, and crawl what it links to.
 *
 * Nothing in the repository could express that. A retrieved record is pinned as a `PinnedRecordRef` —
 * source, container, sourceId — which is enough to CITE it and not enough to go and READ it. So a plan
 * could say "verify this against the live object" and no code could turn that into a command.
 *
 * ## It delegates; it does not know addresses
 *
 * Every provider already owns a parser for its own addresses, and those parsers are what the read verbs
 * themselves use. This module calls them rather than re-deriving what a valid GitHub or Notion address
 * looks like — so "can this record be read live?" is answered by the exact code that would do the reading.
 * A second notion of a valid address would drift, and the drift would show up as a plan promising a
 * verification step that then refuses.
 *
 * ## What is deliberately NOT here
 *
 * No execution, no token, no network: this returns the argv a visible session runs. That keeps it pure and
 * testable, and it keeps the choice to spend a provider call where it belongs — with the session, not with
 * a retrieval helper.
 *
 * It also does not decide whether a record is WORTH verifying. That is the routing decision's job. This
 * only answers whether it CAN be.
 */

import { CHATGPT_CONVERSATION_ID } from "../corpus/chatgpt/exportSchema.js";
import type { CorpusRecord } from "../corpus/types.js";
import type { Result } from "../lib/result.js";
import { parseGithubReadAddress } from "./github/read.js";
import { parseLinearReadAddress } from "./linear/read.js";
import { parseNotionReadAddress } from "./notion/read.js";

/**
 * Whether a retrieved record can be verified against its live source, and how.
 *
 * `unsupported` carries a reason rather than being a bare absence, because the reasons are genuinely
 * different — a gold digest has no live object at all, while a malformed URL is a defect worth seeing — and
 * a plan that reports "cannot verify" without saying why teaches a reader nothing.
 */
export type RecordReadPlan =
  | { readonly kind: "supported"; readonly command: readonly string[] }
  | { readonly kind: "unsupported"; readonly reason: string };

/** The Slack thread read: its own verb, and the only one whose address IS the record's permalink. */
function slackPlan({ record }: { record: CorpusRecord }): RecordReadPlan {
  return record.url.includes("/archives/")
    ? { command: ["slopweaver", "slack", "read-thread", record.url], kind: "supported" }
    : {
        kind: "unsupported",
        reason: `slack record ${record.sourceId} has no channel permalink to re-read (${record.url})`,
      };
}

/**
 * The ChatGPT conversation read.
 *
 * The record came out of an export, which is a snapshot; the live chat may have moved on since. The live read of
 * one chat is `chatgpt conversation`, which reads that named chat whole. It is
 * addressed by the `conversationId` the projection stamped, tested by the same id shape the verb refuses an
 * argument by, so a plan never promises a read the verb would turn away. It needs the owner's pasted web session, and
 * refuses by name when there is none.
 */
function chatgptPlan({ record }: { record: CorpusRecord }): RecordReadPlan {
  const id = record.attrs?.["conversationId"];
  if (typeof id !== "string" || !CHATGPT_CONVERSATION_ID.test(id)) {
    return {
      kind: "unsupported",
      reason: `chatgpt record ${record.sourceId} carries no conversation id the conversation read accepts`,
    };
  }
  return { command: ["slopweaver", "chatgpt", "conversation", id], kind: "supported" };
}

/**
 * Why a source has no addressable live read at all — the sources whose answer is a sentence rather than a
 * command.
 *
 * A lookup rather than three `case` arms, because none of them inspects the record: the answer is a
 * property of the SOURCE, and holding them together is what makes it obvious at a glance which sources this
 * plan cannot serve and why. A source absent here is one the switch below has to decide per record.
 *
 * @internal
 */
const UNADDRESSABLE: Partial<Record<CorpusRecord["source"], string>> = {
  // A gold digest is derived from other records and has no live object behind it.
  gold: "a gold digest is derived from other records and has no live object behind it — verify the records it cites instead",
  // A self record is a file in this repository, already open to any session.
  self: "a self record is this repository's own file, already readable from the checkout",
  // No live re-read, and not because one is missing: this repository exposes no Fathom verb at all. The
  // whole lane is `refresh --source fathom`, whose reads are a crawl rather than an addressable fetch-one —
  // and the record already carries the provider's own page in `url`, which is where a reader who wants the
  // call itself goes.
  fathom: "no fathom read verb exists — the record's own `url` is Fathom's page for the call",
};

/**
 * The plan for a source whose live read is `slopweaver <verb> read <url>`, gated on the URL parsing.
 *
 * A comment or review URL still resolves to its parent object, which is the right thing to re-read: the
 * owner asked for the WHOLE doc, not the fragment the retriever happened to rank.
 *
 * @param verb the read verb for this source
 * @param url the record's own URL
 * @param parsed what that source's address parser made of it
 * @returns the argv, or the parser's own reason it cannot be addressed
 * @internal
 */
function urlAddressedPlan({
  verb,
  url,
  parsed,
}: {
  verb: string;
  url: string;
  parsed: Result<unknown, { readonly message: string }>;
}): RecordReadPlan {
  return parsed.isOk()
    ? { command: ["slopweaver", verb, "read", url], kind: "supported" }
    : { kind: "unsupported", reason: parsed.error.message };
}

/**
 * The live read for an Outlook record. Both are addressed by `sourceId`, never by `url`: the stored `url` is
 * Graph's `webLink`, which Microsoft does not promise survives a move. A message's `sourceId` is its IMMUTABLE
 * id, which survives every move between folders; `outlook-calendar read` takes the event id ALONE, because
 * Graph reads an event by id from `/me/events/{id}` whichever calendar holds it, and prints that calendar back.
 *
 * @param record the retrieved Outlook record
 * @param source which of the two Microsoft sources it came from
 * @returns the argv a visible session would run
 */
function microsoftPlan({
  record,
  source,
}: {
  record: CorpusRecord;
  source: "outlook" | "outlook-calendar";
}): RecordReadPlan {
  if (source === "outlook") {
    return { command: ["slopweaver", "outlook", "read", record.sourceId], kind: "supported" };
  }
  return { command: ["slopweaver", "outlook-calendar", "read", outlookEventIdOf({ record })], kind: "supported" };
}

/**
 * The sanctioned live read for one retrieved record, or why there is none.
 *
 * @param record the retrieved record to verify against its source
 * @returns the argv a visible session would run, or the reason this record cannot be re-read
 */
export function recordReadPlan({ record }: { record: CorpusRecord }): RecordReadPlan {
  const unaddressable = UNADDRESSABLE[record.source];
  if (unaddressable !== undefined) {
    return { kind: "unsupported", reason: unaddressable };
  }
  switch (record.source) {
    case "github":
      return urlAddressedPlan({
        parsed: parseGithubReadAddress({ address: record.url }),
        url: record.url,
        verb: "github",
      });
    case "linear":
      return urlAddressedPlan({
        parsed: parseLinearReadAddress({ address: record.url }),
        url: record.url,
        verb: "linear",
      });
    case "notion":
      return urlAddressedPlan({
        parsed: parseNotionReadAddress({ address: record.url, kind: "page" }),
        url: record.url,
        verb: "notion",
      });
    case "slack":
      return slackPlan({ record });
    case "gold":
    case "self":
    case "fathom":
      // Unreachable: every member of `UNADDRESSABLE` returns above. Named rather than folded into `default`
      // so the day one of them gains a read verb, deleting its row here is a compile error rather than a
      // silent throw.
      throw new Error(`unaddressable source reached the switch: ${record.source}`);
    case "gmail":
      // The one source whose live re-read is addressed by `sourceId` rather than by `url`. A Gmail permalink
      // is a web-UI fragment (`#all/<id>`) that no verb parses, while the id it carries IS what
      // `gmail read` takes — so re-reading is supported, just not through the URL every other source uses.
      return { command: ["slopweaver", "gmail", "read", record.sourceId], kind: "supported" };
    case "calendar":
      // Addressed by `sourceId` for the same reason Gmail is, plus one of its own: an event id is only
      // unique WITHIN a calendar, so the bronze `sourceId` carries both halves and `calendar read` takes
      // the pair. `container` is the calendar id — see `corpus/calendar/project.ts`.
      return {
        command: ["slopweaver", "calendar", "read", eventIdOf({ record }), "--calendar", record.container],
        kind: "supported",
      };
    case "outlook":
    case "outlook-calendar":
      return microsoftPlan({ record, source: record.source });
    case "chatgpt":
      return chatgptPlan({ record });
    default: {
      const unhandled: never = record.source;
      throw new Error(`unhandled corpus source: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The event id out of a calendar record's `sourceId`.
 *
 * A calendar `sourceId` is `<calendarId>/<eventId>`, because an event id is only unique within one
 * calendar. A calendar id is itself an email address and carries no slash, so the FIRST slash separates
 * them; splitting from the right would be wrong the day Google issues an event id containing one.
 *
 * @param record the calendar record
 * @returns the event id half of its source id, or the whole id when it carries no separator
 */
function eventIdOf({ record }: { record: CorpusRecord }): string {
  const separator = record.sourceId.indexOf("/");
  return separator === -1 ? record.sourceId : record.sourceId.slice(separator + 1);
}

/**
 * The event id out of an Outlook calendar record's `sourceId`, which is `<calendarId>/<eventId>`.
 *
 * Stripped by the record's own `container` (the calendar id) rather than split on a slash, because a Graph id
 * is opaque and nothing promises it carries no slash on either side.
 *
 * @param record the Outlook calendar record
 * @returns the event id half of its source id, or the whole id when it does not open with its calendar's
 */
function outlookEventIdOf({ record }: { record: CorpusRecord }): string {
  const prefix = `${record.container}/`;
  if (!record.sourceId.startsWith(prefix)) {
    return record.sourceId;
  }
  return record.sourceId.slice(prefix.length);
}
