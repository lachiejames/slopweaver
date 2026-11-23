/**
 * The `refresh --source chatgpt` ingest job: every export `chatgpt import-export` took in, and the live copy the web
 * session's whole-conversation reads hold (`liveSnapshotStore.ts`), each read whole, projected one message to a
 * record, and committed to bronze through the one writer. A home holding either refreshes; one holding neither is
 * refused, naming the export step.
 *
 * **The live copy is one more held copy, not a second source.** Its snapshots are conversations in the export's own
 * shape, read through the same parser and projection, so a chat held both ways is one conversation with two versions
 * and the merge below writes it once (`conversationInput.ts`).
 *
 * **Each conversation is written from its latest version.** Before anything is written, every held export's
 * version of every conversation is weighed by that conversation's own newest instant (`conversationMerge.ts`), so
 * an old title or branch never lands in bronze after a newer one, whichever export the chronology calls newest; a
 * chat only one export holds — one the owner deleted in between — is written from it. Every export is read on every
 * refresh, a receipted one included: weighing only some of them is how an older copy would win.
 *
 * ## A whole snapshot, every run
 *
 * `chatgpt` is a {@link ../types.CURSORLESS_SOURCES} member: every run reads every conversation of the exports it
 * reads, and bronze's `(sourceId, fingerprint)` dedup makes a repeat run append only what changed. The window the
 * job carries names the bronze file and filters nothing.
 *
 * **Not closed: a clock stepped backwards.** A timestamp tie between two copies of a record is settled by bronze
 * file order (`../latestRecords.ts`, `READ_WHOLE_SOURCES`), and the file is named by the run's wall clock. A sync
 * run after the machine's clock moved back a day writes a newer version (a retitled chat, at the same message
 * instant) into a file that sorts BEFORE the older one, so the older copy reads as latest. That is the corpus-wide
 * filename-order contract every read-whole source rides; it takes a clock moving backwards between two syncs.
 *
 * **What a snapshot does NOT do is forget.** A conversation the owner deleted in ChatGPT is absent from the next export,
 * but bronze is append-only and the store upserts what is present, so the records an earlier export wrote stay.
 * That is the same contract every corpus source here has — a local history, not a mirror — and it is stated
 * rather than discovered: removing one is `store` content removal, by hand.
 *
 * ## Streamed, and committed in batches
 *
 * A conversations file is read one top-level element at a time (`#lib/jsonArrayFile.js`) and its records are
 * committed every {@link COMMIT_BATCH_RECORDS}, so neither the file nor the account's records are ever held
 * whole. The bulk write `ingestSources` runs afterwards is handed nothing — every record already went through the
 * committer, and {@link SourceIngestJob}'s per-container counts carry the arithmetic.
 *
 * ## Nothing read is lost quietly
 *
 * Each of these is a coverage GAP, failing the run and withholding `chatgpt sync`'s receipt, never a warning:
 * a conversation that will not parse (named by id, else by file and position) or spells one key twice in an
 * object, a file that cannot be read as a whole array, a message whose content kind the parser has never seen, a message with no instant to sit on, the same
 * conversation id twice with different content, and a bronze write that failed. A real export carrying something
 * new therefore fails loudly on the first run and names what it is.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";

import { readJsonArrayElements } from "#lib/jsonArrayFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";
import { projectChatConversation } from "../chatHistory/project.js";
import type { ChatHistoryConversation } from "../chatHistory/types.js";
import { type BronzeCommitter, createBronzeCommitter } from "../corpusWriter.js";
import { type CoverageGap, coverageGap, type SourceIngestJob } from "../ingestJob.js";
import type { CorpusRecord, ExportWindow } from "../types.js";
import { exportConversationInput, liveConversationInput, type StoredConversationInput } from "./conversationInput.js";
import { indexVersions, type MergePlan, planMerge, SINGLE_EXPORT_PLAN } from "./conversationMerge.js";
import { ChatgptExportErrors } from "./errors.js";
import { parseExportConversation } from "./exportConversation.js";
import { elementIds, readExportElement } from "./exportElement.js";
import { EXPORT_ID_CHARS } from "./exportMessage.js";
import { type StoredExport, verifiedHeldExports } from "./exportStore.js";
import { heldLiveSnapshots } from "./liveSnapshotStore.js";
import {
  closeTally,
  emptyTally,
  exportNote,
  liveNote,
  noteGap,
  noteUnknownKinds,
  type PassTally,
  syncGapLines,
} from "./passTally.js";

/** Records held before a commit — a few megabytes of message text, whatever the account's size. */
const COMMIT_BATCH_RECORDS = 2_000;

/** The injectable edges of one run. */
export interface ChatgptIngestDeps {
  /** The managed export root; production reads `CorpusPaths.chatgptExports`. */
  readonly exportsRoot: string;
  /** The live copy's root; production reads `CorpusPaths.chatgptLive`. */
  readonly liveRoot: string;
  /** The bronze committer; production is {@link createBronzeCommitter} over the run's window. */
  readonly committer: BronzeCommitter;
}

/**
 * Build the job.
 *
 * @param home the Slopweaver home
 * @param window the run's window — it names the bronze file and filters nothing
 * @param deps the edges, injected by a test; production resolves both from `home`
 * @returns the job
 */
export function chatgptIngestJob({
  home,
  window,
  deps,
}: {
  home: string;
  window: ExportWindow;
  deps?: ChatgptIngestDeps;
}): SourceIngestJob {
  return {
    cursorless: true,
    label: "chatgpt (history export)",
    run: () => {
      if (deps !== undefined) {
        return Promise.resolve(runChatgptIngest({ deps }));
      }
      return Promise.resolve(runChatgptIngest({ deps: productionDeps({ home, window }) }));
    },
    source: "chatgpt",
    window,
  };
}

/** The production edges for one home and window. */
function productionDeps({ home, window }: { home: string; window: ExportWindow }): ChatgptIngestDeps {
  return {
    committer: createBronzeCommitter({ home, window }),
    exportsRoot: stateHomePaths({ home }).corpus.chatgptExports,
    liveRoot: stateHomePaths({ home }).corpus.chatgptLive,
  };
}

/** Commit what is held, folding the outcome into the tally. */
function flush({
  pending,
  committer,
  tally,
}: {
  pending: CorpusRecord[];
  committer: Pick<BronzeCommitter, "commit">;
  tally: PassTally;
}): void {
  if (pending.length === 0) {
    return;
  }
  const committed = committer.commit({ records: pending });
  if (committed.isErr()) {
    noteGap({
      line: `chatgpt: a bronze write of ${String(pending.length)} record(s) failed (${committed.error.join("; ")})`,
      tally,
    });
  } else {
    tally.written += committed.value.written;
    tally.excluded += committed.value.excluded;
    tally.offered += pending.length;
  }
  pending.length = 0;
}

/**
 * Where a conversation sits, for a gap: the first id it names, else its file and position. It names an element that
 * was REFUSED, so the id is unchecked and cut to {@link EXPORT_ID_CHARS} — the element chose its length.
 */
function locate({ ids, file, index }: { ids: readonly string[]; file: string; index: number }): string {
  const [first] = ids;
  if (first !== undefined) {
    return `conversation ${first.slice(0, EXPORT_ID_CHARS)}`;
  }
  return `${basename(file)} element ${String(index)}`;
}

/** One conversation element parsed, or `undefined` once the gap saying why it would not is noted. */
function parseElement({
  text,
  index,
  file,
  tally,
}: {
  text: string;
  index: number;
  file: string;
  tally: PassTally;
}): ChatHistoryConversation | undefined {
  const read = readExportElement({ label: `chatgpt ${basename(file)} element ${String(index)}`, text });
  if (read.isErr()) {
    noteGap({ line: `chatgpt: ${locate({ file, ids: read.error.ids, index })} ${read.error.message}`, tally });
    return undefined;
  }
  const parsed = parseExportConversation({ value: read.value });
  if (parsed.isErr()) {
    const where = locate({ file, ids: elementIds({ value: read.value }), index });
    noteGap({ line: `chatgpt: ${where} will not parse — ${parsed.error.message}`, tally });
    return undefined;
  }
  return parsed.value;
}

/**
 * One conversation element: parsed, de-duplicated, checked for every coverage gap, then left to the export holding
 * its latest version or projected and queued. The checks run on EVERY copy, the one left to another export included:
 * a copy is weighed by the records it would write, and a message it cannot write (an unknown kind, no instant) adds
 * none, so two copies can weigh the same while only one of them carries the message nobody would ever be told of.
 */
function takeElement({
  text,
  index,
  file,
  seen,
  self,
  plan,
  pending,
  tally,
}: {
  text: string;
  index: number;
  file: string;
  seen: Map<string, string>;
  self: StoredConversationInput;
  plan: MergePlan;
  pending: CorpusRecord[];
  tally: PassTally;
}): void {
  const conversation = parseElement({ file, index, tally, text });
  if (conversation === undefined) {
    return;
  }
  const digest = createHash("sha256").update(text).digest("hex");
  const earlier = seen.get(conversation.id);
  if (earlier !== undefined) {
    if (earlier === digest) {
      tally.duplicates += 1;
    } else {
      noteGap({
        line: `chatgpt: conversation ${conversation.id} appears twice in ${self.kind === "export" ? "the export" : self.label} with different content`,
        tally,
      });
    }
    return;
  }
  seen.set(conversation.id, digest);
  noteUnknownKinds({ kinds: conversation.unknownKinds, tally });
  const projected = projectChatConversation({ conversation, source: "chatgpt" });
  if (projected.undated > 0) {
    noteGap({
      line: `chatgpt: conversation ${conversation.id} has ${String(projected.undated)} message(s) with no instant on them or the conversation`,
      tally,
    });
  }
  if (plan.unordered.has(conversation.id)) {
    // Named once, as the run's gap; no export's version is written.
    return;
  }
  const takeFrom = plan.takeFrom.get(conversation.id);
  if (takeFrom !== undefined && takeFrom !== self.key) {
    tally.superseded += 1;
    return;
  }
  tally.conversations += 1;
  tally.withheld += conversation.withheld;
  tally.messages += projected.records.length;
  pending.push(...projected.records);
}

/**
 * Read one held export whole into bronze.
 *
 * @param stored the export to read
 * @param committer the bronze committer
 * @param plan which held copy each conversation is written from — an export read alone writes all it holds
 * @returns the tally of what was read, committed and refused
 */
export function ingestStoredExport({
  stored,
  committer,
  plan = SINGLE_EXPORT_PLAN,
}: {
  stored: StoredExport;
  committer: Pick<BronzeCommitter, "commit">;
  plan?: MergePlan;
}): PassTally {
  return ingestStoredConversationInput({ committer, input: exportConversationInput({ stored }), plan });
}

/**
 * Read one held copy whole into bronze: an export, or the live copy.
 *
 * @param input the held copy to read
 * @param committer the bronze committer
 * @param plan which held copy each conversation is written from — a copy read alone writes all it holds
 * @returns the tally of what was read, committed and refused
 */
export function ingestStoredConversationInput({
  input,
  committer,
  plan = SINGLE_EXPORT_PLAN,
}: {
  input: StoredConversationInput;
  committer: Pick<BronzeCommitter, "commit">;
  plan?: MergePlan;
}): PassTally {
  const tally = emptyTally();
  const seen = new Map<string, string>();
  const pending: CorpusRecord[] = [];
  for (const file of input.files) {
    const read = readJsonArrayElements({
      onElement: ({ text, index }) => {
        takeElement({ file, index, pending, plan, seen, self: input, tally, text });
        if (pending.length >= COMMIT_BATCH_RECORDS) {
          flush({ committer, pending, tally });
        }
        return true;
      },
      path: file,
    });
    if (read.isErr()) {
      noteGap({ line: `chatgpt: ${basename(file)} could not be read whole — ${read.error.message}`, tally });
    }
  }
  flush({ committer, pending, tally });
  closeTally({ tally });
  return tally;
}

/**
 * One run: every held export and the live copy weighed per conversation, then each read whole, exports newest first
 * and the live copy last. A home holding only the live copy reads it alone; one holding neither is refused.
 */
function runChatgptIngest({ deps }: { deps: ChatgptIngestDeps }): Result<{
  records: readonly CorpusRecord[];
  warnings: readonly string[];
  notes: readonly string[];
  gaps: readonly CoverageGap[];
  committedPerContainer: number;
  projectedPerContainer: number;
}> {
  const exports = verifiedHeldExports({ root: deps.exportsRoot });
  if (exports.isErr()) {
    return err([exports.error.message]);
  }
  const live = heldLiveSnapshots({ root: deps.liveRoot });
  if (live.isErr()) {
    return err([live.error.message]);
  }
  if (exports.value.length === 0 && live.value.length === 0) {
    return err([ChatgptExportErrors.noImportedExport().message]);
  }
  const reads: { input: StoredConversationInput; note: (args: { tally: PassTally }) => string }[] = exports.value.map(
    (stored) => ({
      input: exportConversationInput({ stored }),
      note: ({ tally }: { tally: PassTally }) => exportNote({ stored, tally }),
    }),
  );
  if (live.value.length > 0) {
    const input = liveConversationInput({ files: live.value.map((snapshot) => snapshot.file) });
    reads.push({ input, note: ({ tally }) => liveNote({ snapshots: live.value.length, tally }) });
  }
  const plan = planMerge(indexVersions({ inputs: reads.map((read) => read.input) }));
  const notes: string[] = [];
  const lines: string[] = [...plan.gaps];
  let written = 0;
  let offered = 0;
  for (const read of reads) {
    const tally = ingestStoredConversationInput({ committer: deps.committer, input: read.input, plan });
    written += tally.written;
    offered += tally.offered;
    lines.push(...tally.gaps);
    notes.push(read.note({ tally }));
  }
  return ok({
    committedPerContainer: written,
    gaps: syncGapLines({ lines }).map((message) => coverageGap({ message })),
    notes,
    projectedPerContainer: offered,
    records: [],
    warnings: [],
  });
}
