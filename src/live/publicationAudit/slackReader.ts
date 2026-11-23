/**
 * The publication audit's Slack door: every message the fleet posted through a guarded Slack write, read back as it
 * stands now.
 *
 * ## The inventory is the placement journal
 *
 * Every guarded post settles one `placement-settled` row (`../slack/placementJournal.ts`) naming where its message
 * finally is (`final.channel`, `final.ts`) and the thread it lives in. The as-me sends ride the same guarded
 * transport, so the journal is the door's whole inventory from its first row on; a message posted before the journal
 * existed is outside this door's declared scope, as are canvases, statuses and channel metadata. A `held` placement
 * may have posted a repair cross-link the row does not record, so any held row is a fixed gap rather than a clear.
 *
 * ## Only the fleet's own message
 *
 * The read is the exact message at `final.ts` — never the replies around it, which are other people's words already
 * inside the audience they were written for. Its `text` is judged raw, so a link or an id in markup is judged as
 * posted; its block and attachment prose is the visible prose `../../corpus/slack/visibleProse.ts` recovers. Uploaded
 * files are counted and never fetched.
 *
 * ## A partial read is never clean
 *
 * A message the read cannot find may be deleted or merely invisible to the token, so it is a gap, never a clear. A
 * bot token sees less than the user token, so reading with it is a gap too. Every gap is a fixed label: no channel, no
 * ts, no provider message.
 */
import { flattenSlackVisibleProse } from "../../corpus/slack/visibleProse.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { PlacementJournalRow, PlacementSettled } from "../slack/placementJournal.js";

import { doorCoverage, type PublicationRead, type PublishedText } from "./types.js";

/** The fixed gap labels this door reports. Nothing found, and nothing from a provider, is ever one of them. */
export const SLACK_PUBLICATION_GAPS = {
  botCredentialOnly: "user read credential missing; read with the bot token",
  credentialMissing: "credential missing",
  heldCrossLinks: "placement repair cross-links not inventoried",
  inventoryRowUnreadable: "inventory row unreadable",
  inventoryUnreadable: "inventory unreadable",
  messageNotFound: "message not found or not visible",
  messageReadFailed: "message read failed",
  objectCeiling: "object ceiling reached",
  threadPageCeiling: "thread page ceiling reached",
  uploadsNotRead: "uploaded files not read",
  workspaceUnresolved: "workspace address unresolved",
} as const;

/** Messages one run reads before it reports a ceiling. */
const SLACK_PUBLICATION_OBJECT_LIMIT = 500;

/** What one exact-message read found. */
export type SlackMessageRead =
  | { readonly kind: "found"; readonly message: Readonly<Record<string, unknown>> }
  | { readonly kind: "absent" }
  | { readonly kind: "page-ceiling" };

/** A Slack read that threw. Fixed and carrying no provider text, so nothing a call raised reaches a gap or a report. */
export interface SlackMessageReadFailedError {
  readonly code: "SLACK_MESSAGE_READ_FAILED";
  readonly message: string;
}

/** Factories for the exact-message read's one failure. */
export const SlackPublicationReadErrors = {
  /** @returns the fixed read failure, naming no channel, ts or provider message */
  readFailed: (): SlackMessageReadFailedError => ({
    code: "SLACK_MESSAGE_READ_FAILED",
    message: "the slack message read failed",
  }),
} as const;

/** The narrow read seam: one exact message, and the workspace's address. Plain functions, so a test passes its own. */
export interface SlackPublicationSeam {
  readonly readMessage: (args: {
    readonly channel: string;
    readonly ts: string;
    readonly threadRoot: string | undefined;
  }) => Promise<Result<SlackMessageRead, SlackMessageReadFailedError>>;
  readonly workspaceUrl: () => Promise<string | undefined>;
}

/** The placement journal as read: its rows, how many lines would not parse, and a failed open. */
export interface SlackPlacementInventory {
  readonly rows: readonly PlacementJournalRow[];
  readonly unreadable: readonly number[];
  readonly readFailure: string | undefined;
}

/** One published message to re-read, deduplicated by where it finally is. */
interface SlackTarget {
  readonly channel: string;
  readonly ts: string;
  readonly threadRoot: string | undefined;
}

/**
 * The settled rows as targets: one per final coordinate, sorted, with whether any row was held.
 *
 * @returns the targets and whether a held placement may have left an unrecorded cross-link
 */
function slackPublicationTargets({ rows }: { rows: readonly PlacementJournalRow[] }): {
  readonly targets: readonly SlackTarget[];
  readonly anyHeld: boolean;
} {
  const byKey = new Map<string, SlackTarget>();
  let anyHeld = false;
  const settled = rows.filter((row): row is PlacementSettled => row.kind === "placement-settled");
  for (const row of settled) {
    if (row.outcome === "held") {
      anyHeld = true;
    }
    const key = `${row.final.channel} ${row.final.ts}`;
    if (!byKey.has(key)) {
      const threadRoot = row.threadRoot === row.final.ts ? undefined : row.threadRoot;
      byKey.set(key, { channel: row.final.channel, threadRoot, ts: row.final.ts });
    }
  }
  const targets = [...byKey.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, target]) => target);
  return { anyHeld, targets };
}

/**
 * The permalink Slack itself serves for a message: the workspace address, the channel, the ts without its dot, and a
 * reply's thread.
 *
 * @param workspaceUrl the workspace's own `https://<host>/` address, from `auth.test`
 * @returns the address
 */
export function slackMessagePermalink({
  workspaceUrl,
  channel,
  ts,
  threadRoot,
}: {
  workspaceUrl: string;
  channel: string;
  ts: string;
  threadRoot: string | undefined;
}): string {
  const base = workspaceUrl.endsWith("/") ? workspaceUrl : `${workspaceUrl}/`;
  const path = `${base}archives/${channel}/p${ts.replace(".", "")}`;
  if (threadRoot === undefined) {
    return path;
  }
  return `${path}?thread_ts=${threadRoot}&cid=${channel}`;
}

/** Every distinct uploaded-file id a message carries. */
function messageFileIds({ message }: { message: Readonly<Record<string, unknown>> }): readonly string[] {
  const files = message["files"];
  if (!Array.isArray(files)) {
    return [];
  }
  const ids = files.flatMap((file: unknown) => {
    if (isRecord(file) && typeof file["id"] === "string") {
      return [file["id"]];
    }
    return [];
  });
  return [...new Set(ids)];
}

/**
 * The texts one message publishes, under fixed field names: its raw `text`, then the block and attachment prose the
 * text does not already carry.
 *
 * @returns the texts, empty for a message with neither
 */
function slackMessageTexts({
  message,
  link,
  objectKey,
}: {
  message: Readonly<Record<string, unknown>>;
  link: string;
  objectKey: string;
}): readonly PublishedText[] {
  const base = { door: "slack" as const, link, linkCarriesNoText: false, objectKey };
  const texts: PublishedText[] = [];
  const raw = message["text"];
  const text = typeof raw === "string" ? raw : "";
  if (text.trim() !== "") {
    texts.push({ ...base, field: "text", text });
  }
  const prose = flattenSlackVisibleProse({
    dedupeAgainst: [text],
    maps: { channelNames: {}, userNames: {} },
    raw: message,
  });
  if (prose.length > 0) {
    texts.push({ ...base, field: "blocks", text: prose.join("\n") });
  }
  return texts;
}

/**
 * Read back every message the fleet posted through a guarded Slack write.
 *
 * @param inventory the placement journal as read
 * @param seam the exact-message read seam, or `undefined` when no Slack credential is configured
 * @param botOnly true when the seam reads with the bot token, which sees less than the user token
 * @param objectLimit messages read before a ceiling is reported
 * @returns the texts to judge and the door's coverage
 */
export async function readSlackPublications({
  inventory,
  seam,
  botOnly,
  objectLimit = SLACK_PUBLICATION_OBJECT_LIMIT,
}: {
  inventory: SlackPlacementInventory;
  seam: SlackPublicationSeam | undefined;
  botOnly: boolean;
  objectLimit?: number;
}): Promise<PublicationRead> {
  const { targets, anyHeld } = slackPublicationTargets({ rows: inventory.rows });
  const gaps = inventoryGaps({ anyHeld, inventory });
  const unread = (): PublicationRead => ({
    coverage: doorCoverage({ attachmentsNotSwept: 0, door: "slack", gaps, objects: 0, texts: 0 }),
    texts: [],
  });
  if (targets.length === 0) {
    return unread();
  }
  if (seam === undefined) {
    gaps.push(SLACK_PUBLICATION_GAPS.credentialMissing);
    return unread();
  }
  if (botOnly) {
    gaps.push(SLACK_PUBLICATION_GAPS.botCredentialOnly);
  }
  const workspaceUrl = await seam.workspaceUrl();
  if (workspaceUrl === undefined) {
    gaps.push(SLACK_PUBLICATION_GAPS.workspaceUnresolved);
    return unread();
  }
  if (targets.length > objectLimit) {
    gaps.push(SLACK_PUBLICATION_GAPS.objectCeiling);
  }
  const read = await readSlackTargets({ gaps, seam, targets: targets.slice(0, objectLimit), workspaceUrl });
  if (read.files > 0) {
    gaps.push(SLACK_PUBLICATION_GAPS.uploadsNotRead);
  }
  return {
    coverage: doorCoverage({
      attachmentsNotSwept: read.files,
      door: "slack",
      gaps,
      objects: read.objects,
      texts: read.texts.length,
    }),
    texts: read.texts,
  };
}

/** The gaps the placement journal itself leaves before any message is read, in the order a report lists them. */
function inventoryGaps({ inventory, anyHeld }: { inventory: SlackPlacementInventory; anyHeld: boolean }): string[] {
  const gaps: string[] = [];
  if (inventory.readFailure !== undefined) {
    gaps.push(SLACK_PUBLICATION_GAPS.inventoryUnreadable);
  }
  if (inventory.unreadable.length > 0) {
    gaps.push(SLACK_PUBLICATION_GAPS.inventoryRowUnreadable);
  }
  if (anyHeld) {
    gaps.push(SLACK_PUBLICATION_GAPS.heldCrossLinks);
  }
  return gaps;
}

/** Read each target in turn: the texts of every message found, the messages read, the distinct files they carry. */
async function readSlackTargets({
  targets,
  seam,
  workspaceUrl,
  gaps,
}: {
  targets: readonly SlackTarget[];
  seam: SlackPublicationSeam;
  workspaceUrl: string;
  gaps: string[];
}): Promise<{ readonly texts: readonly PublishedText[]; readonly objects: number; readonly files: number }> {
  const texts: PublishedText[] = [];
  const fileIds = new Set<string>();
  let objects = 0;
  for (const target of targets) {
    const read = await seam.readMessage(target);
    if (read.isErr() || read.value.kind !== "found") {
      gaps.push(slackReadGap({ read }));
      continue;
    }
    const found = read.value.message;
    objects += 1;
    const link = slackMessagePermalink({ workspaceUrl, ...target });
    texts.push(...slackMessageTexts({ link, message: found, objectKey: `message ${target.channel} ${target.ts}` }));
    for (const id of messageFileIds({ message: found })) {
      fileIds.add(`${target.channel} ${id}`);
    }
  }
  return { files: fileIds.size, objects, texts };
}

/** The fixed gap a read that did not find its message leaves. */
function slackReadGap({ read }: { read: Result<SlackMessageRead, SlackMessageReadFailedError> }): string {
  if (read.isErr()) {
    return SLACK_PUBLICATION_GAPS.messageReadFailed;
  }
  if (read.value.kind === "page-ceiling") {
    return SLACK_PUBLICATION_GAPS.threadPageCeiling;
  }
  return SLACK_PUBLICATION_GAPS.messageNotFound;
}

/** The subset of the Slack read seam the production exact-message read calls. */
export interface SlackPublicationApi {
  readonly history: (args: {
    channel: string;
    oldest: string;
    latest: string;
    pageSize?: number | undefined;
    inclusive?: boolean | undefined;
  }) => Promise<{ readonly messages: readonly unknown[] }>;
  readonly replies: (args: {
    channel: string;
    ts: string;
    oldest: string;
    cursor?: string;
  }) => Promise<{ readonly messages: readonly unknown[]; readonly nextCursor?: string | undefined }>;
  readonly workspaceUrl: () => Promise<string | undefined>;
}

/** Thread pages one reply read walks before it reports a ceiling. */
const SLACK_THREAD_PAGE_LIMIT = 20;

/** The message with exactly the asked ts in one page, if it is there. */
function exactMessage({
  messages,
  ts,
}: {
  messages: readonly unknown[];
  ts: string;
}): Readonly<Record<string, unknown>> | undefined {
  const found = messages.find((message) => isRecord(message) && message["ts"] === ts);
  return isRecord(found) ? found : undefined;
}

/**
 * The production exact-message read over the doored Slack API: a top-level message by a one-instant inclusive
 * `conversations.history`, a reply by walking its thread's `conversations.replies` until that ts. A thrown call is
 * the fixed `SLACK_MESSAGE_READ_FAILED`, never a message.
 *
 * @param api the doored Slack read methods (`makeSlackApi` in production)
 * @returns the seam
 */
export function slackPublicationSeam({ api }: { api: SlackPublicationApi }): SlackPublicationSeam {
  const readMessage: SlackPublicationSeam["readMessage"] = async ({ channel, ts, threadRoot }) => {
    try {
      if (threadRoot === undefined) {
        const page = await api.history({ channel, inclusive: true, latest: ts, oldest: ts, pageSize: 1 });
        const message = exactMessage({ messages: page.messages, ts });
        return ok(message === undefined ? { kind: "absent" as const } : { kind: "found" as const, message });
      }
      let cursor: string | undefined;
      for (let page = 0; page < SLACK_THREAD_PAGE_LIMIT; page += 1) {
        const read = await api.replies({
          channel,
          oldest: threadRoot,
          ts: threadRoot,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const message = exactMessage({ messages: read.messages, ts });
        if (message !== undefined) {
          return ok({ kind: "found" as const, message });
        }
        if (read.nextCursor === undefined) {
          return ok({ kind: "absent" as const });
        }
        cursor = read.nextCursor;
      }
      return ok({ kind: "page-ceiling" as const });
    } catch {
      return err(SlackPublicationReadErrors.readFailed());
    }
  };
  return { readMessage, workspaceUrl: () => api.workspaceUrl().catch(() => undefined) };
}
