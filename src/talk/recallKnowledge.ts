/**
 * The knowledge half of `talk recall`: the register's current claims, searched and opened from the LOCAL store
 * inside a deadline, exactly as `talk knowledge` reads it (`../cli/commands/talk/knowledgeRun.ts`). A store that is
 * remote, down or slow is a source NOT SEARCHED, with its reason — never a count of zero — so the disk sources
 * still answer when the store cannot.
 *
 * The mapping from a store page to a recall read is pure ({@link knowledgeRead}, {@link knowledgeOpened}); the
 * connect, the deadline and the local-only refusal are the thin shell around it.
 */
import { type NewestMemories, newestMemoriesMatching } from "../knowledge/memoryNewest.js";
import { latestRecordingOf } from "../knowledge/memoryRecordStore.js";
import { withTimeout } from "../lib/resilience.js";
import { err, ok, type Result } from "../lib/result.js";
import { connectStore, type StoreClient } from "../store/client.js";
import type { MemoryRecordingRow } from "../store/schema/memories.js";
import { type RecallSourceRead } from "./recall.js";
import { type RecallError, RecallErrors } from "./recallErrors.js";
import { type RecallOpened } from "./recallOpen.js";
import { recallPointerOf } from "./recallPointer.js";

/**
 * How long the knowledge read may take, connect included. The voice kills a tool at 20 s with no reason given and
 * the disk sources run first, so the store gets less than `talk knowledge`'s 12 s and says why when it runs out.
 */
const RECALL_KNOWLEDGE_DEADLINE_MS = 8_000;

/** The most claims one search returns; the answer's byte cap is what bounds the hits shown. */
const RECALL_KNOWLEDGE_LIMIT = 30;

/**
 * A store page as the knowledge source's read: the exact total, and the newest claims as candidates.
 *
 * @param page what {@link newestMemoriesMatching} answered
 * @returns the read; its count is the store's total, which may exceed the claims returned
 */
export function knowledgeRead({ page }: { page: NewestMemories }): RecallSourceRead {
  return {
    count: page.total,
    incomplete: undefined,
    matches: page.memories.map((memory) => ({
      about: memory.domain,
      atIso: memory.recordedAtIso,
      pointer: recallPointerOf({ pointer: { kind: "knowledge", memoryId: memory.id } }),
      source: "knowledge" as const,
      text: `[${memory.verdict}] ${memory.claim}`,
      who: "fleet" as const,
    })),
    searched: true,
  };
}

/**
 * A claim's latest recording as an opened record: the claim is the text, the rest its detail.
 *
 * @param row the latest recording
 * @param text the pointer as given, echoed in the answer
 * @returns the record whole
 */
export function knowledgeOpened({ row, text }: { row: MemoryRecordingRow; text: string }): RecallOpened {
  return {
    about: row.domain,
    after: [],
    atIso: row.recordedAt.toISOString(),
    before: [],
    detail: {
      behaviourChange: row.behaviourChange,
      caveat: row.caveat,
      domain: row.domain,
      evidence: row.evidence,
      retrievalCue: row.retrievalCue,
      run: row.run,
      verdict: row.verdict,
    },
    pointer: text,
    source: "knowledge",
    text: row.claim,
    who: "fleet",
  };
}

/**
 * Open the local store, run one task and close it, inside the deadline. The voice's tools read this machine and
 * nothing else: `connectStore` selects through `storeUrl`, which refuses a remote host with no hatch.
 */
async function withLocalStore<T>({
  task,
}: {
  task: (client: StoreClient) => Promise<Result<T, RecallError>>;
}): Promise<Result<T, RecallError>> {
  const run = async (): Promise<Result<T, RecallError>> => {
    const opened = await connectStore();
    if (opened.isErr()) {
      return err(RecallErrors.storeUnavailable({ why: opened.error.message }));
    }
    try {
      return await task(opened.value);
    } finally {
      await opened.value.close();
    }
  };
  try {
    return await withTimeout({ task: run, timeoutMs: RECALL_KNOWLEDGE_DEADLINE_MS });
  } catch {
    return err(
      RecallErrors.storeUnavailable({
        why: `the local store did not answer within ${String(RECALL_KNOWLEDGE_DEADLINE_MS / 1000)} s — check it with slopweaver store`,
      }),
    );
  }
}

/**
 * Search the knowledge register for claims holding every word.
 *
 * @param words the required words
 * @param sinceIso the floor on a claim's latest recording, or `null` for all time
 * @returns the knowledge source's read; not searched, with the reason, when the store cannot answer
 */
export async function searchKnowledge({
  words,
  sinceIso,
}: {
  words: readonly string[];
  sinceIso: string | null;
}): Promise<RecallSourceRead> {
  const page = await withLocalStore({
    task: async (client) => {
      const read = await newestMemoriesMatching({
        client,
        limit: RECALL_KNOWLEDGE_LIMIT,
        query: words.join(" "),
        sinceIso,
      });
      return read.mapErr((error) => RecallErrors.storeUnavailable({ why: error.message }));
    },
  });
  if (page.isErr()) {
    return { searched: false, why: page.error.message };
  }
  return knowledgeRead({ page: page.value });
}

/**
 * Open one claim a search hit pointed at.
 *
 * @param memoryId the claim id the pointer carries
 * @param text the pointer as given, echoed in the answer
 * @returns the claim whole, or why it could not be opened
 */
export async function openKnowledge({
  memoryId,
  text,
}: {
  memoryId: string;
  text: string;
}): Promise<Result<RecallOpened, RecallError>> {
  return withLocalStore({
    task: async (client) => {
      const latest = await latestRecordingOf({ client, memoryId });
      if (latest.isErr()) {
        if (latest.error.code === "MEMORY_UNKNOWN") {
          return err(RecallErrors.notFound({ pointer: text, what: `claim ${memoryId}` }));
        }
        return err(RecallErrors.storeUnavailable({ why: latest.error.message }));
      }
      return ok(knowledgeOpened({ row: latest.value, text }));
    },
  });
}
