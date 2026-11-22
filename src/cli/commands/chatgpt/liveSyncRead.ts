/**
 * The read leg of `chatgpt live-sync` (`./liveSyncRun.ts`): each planned chat read whole through the run's one pacer,
 * read strictly, and held as a snapshot the moment it is read, so a stopped run loses nothing it already read. The
 * first refusal of any kind stops every later read; nothing is retried.
 */
import { err, type Result } from "#lib/result.js";

import type { OwnerProtectionResolver } from "../../../corpus/bronzeProtection.js";
import type { ChatgptSnapshotError } from "../../../corpus/chatgpt/liveSnapshotStore.errors.js";
import { writeLiveSnapshot } from "../../../corpus/chatgpt/liveSnapshotWrite.js";
import type { ChatgptError } from "./errors.js";
import type { ListedChatgptConversation } from "./listing.js";
import type { ChatgptPacer } from "./pacer.js";
import { parseWholeConversation, wholeConversationPath } from "./wholeConversation.js";

/** How many chats read between two progress lines on stderr. */
const PROGRESS_EVERY = 25;

/** What reading the planned chats did. */
export interface LiveReadOutcome {
  /** Chats read whole and held this run. */
  readonly read: number;
  /** Of those, the chats ChatGPT answered with a body older than the listing said, held to be read again. */
  readonly behind: number;
  /** The refusal that stopped the reads, when one did; every chat after it is left for the next run. */
  readonly stoppedBy: ChatgptError | ChatgptSnapshotError | undefined;
}

/**
 * Whether a body says the chat last moved before the listing said it did: the server answering with an older copy
 * than the one it listed. MEASURED on the first walk, a current body's own update runs 0.9 to 4.2 seconds AFTER its
 * listed one (`find $SLOPWEAVER_HOME/corpus/chatgpt/live/snapshots -name manifest.json -exec cat {} +`, 3 chats), so
 * only a body strictly older than its listing counts.
 *
 * @returns true when the body is older than its listing; false when it is not, or states no update
 */
export function bodyBehindListing({
  bodyUpdatedIso,
  listedUpdatedIso,
}: {
  bodyUpdatedIso: string | null;
  listedUpdatedIso: string;
}): boolean {
  if (bodyUpdatedIso === null) {
    return false;
  }
  return Date.parse(bodyUpdatedIso) < Date.parse(listedUpdatedIso);
}

/**
 * One chat read whole and held: the paced GET, the strict read, then the snapshot. A body older than its listing is
 * held at its OWN update, so the next run's plan sees it short of the listing and reads it again.
 */
async function readAndHold({
  conversation,
  fetchText,
  nowIso,
  pacer,
  root,
  home,
  protection,
}: {
  conversation: ListedChatgptConversation;
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  nowIso: () => string;
  pacer: ChatgptPacer;
  root: string;
  home: string;
  protection: OwnerProtectionResolver | undefined;
}): Promise<Result<{ behind: boolean }, ChatgptError | ChatgptSnapshotError>> {
  const path = wholeConversationPath({ id: conversation.id });
  if (path.isErr()) {
    return err(path.error);
  }
  await pacer.beforeRequest();
  const body = await fetchText({ path: path.value });
  if (body.isErr()) {
    return err(body.error);
  }
  const whole = parseWholeConversation({ expectedId: conversation.id, path: path.value, text: body.value });
  if (whole.isErr()) {
    return err(whole.error);
  }
  // An update the body does not state is held as unstated, never as the listing's: the two are compared later.
  let bodyUpdatedIso: string | null = null;
  if (whole.value.conversation.updatedIso !== undefined) {
    bodyUpdatedIso = whole.value.conversation.updatedIso;
  }
  const behind = bodyBehindListing({ bodyUpdatedIso, listedUpdatedIso: conversation.updatedIso });
  let listedUpdatedIso = conversation.updatedIso;
  if (behind && bodyUpdatedIso !== null) {
    listedUpdatedIso = bodyUpdatedIso;
  }
  const held = writeLiveSnapshot({
    bodyUpdatedIso,
    conversationId: conversation.id,
    elementText: whole.value.elementText,
    fetchedAtIso: nowIso(),
    home,
    listedUpdatedIso,
    protection,
    root,
  });
  return held.map(() => ({ behind }));
}

/**
 * Read each planned chat whole and hold it, in the order given, until every one is held or the first refusal.
 *
 * @param toRead the chats to read, newest first, already cut to the run's bound
 * @param fetchText one GET of a path under chatgpt.com through the session
 * @param pacer the run's one pacer, shared with the listing walk
 * @param root the live copy's root
 * @param nowIso the clock each snapshot's fetch instant is read from
 * @param onProgress told how many are held after every {@link PROGRESS_EVERY} reads
 * @param home the Slopweaver home whose protect registry each snapshot write is judged against
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns how many were held, and the refusal that stopped the rest
 */
export async function readPlannedConversations({
  toRead,
  fetchText,
  pacer,
  root,
  nowIso,
  onProgress,
  home,
  protection,
}: {
  toRead: readonly ListedChatgptConversation[];
  fetchText: (args: { path: string }) => Promise<Result<string, ChatgptError>>;
  pacer: ChatgptPacer;
  root: string;
  nowIso: () => string;
  onProgress: (args: { read: number; of: number }) => void;
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Promise<LiveReadOutcome> {
  let read = 0;
  let behind = 0;
  for (const conversation of toRead) {
    const held = await readAndHold({ conversation, fetchText, home, nowIso, pacer, protection, root });
    if (held.isErr()) {
      return { behind, read, stoppedBy: held.error };
    }
    read += 1;
    if (held.value.behind) {
      behind += 1;
    }
    if (read % PROGRESS_EVERY === 0) {
      onProgress({ of: toRead.length, read });
    }
  }
  return { behind, read, stoppedBy: undefined };
}
