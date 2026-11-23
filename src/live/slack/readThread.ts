/**
 * The effectful shell: resolve the link, fetch the whole thread, project it, fetch its attachments, and
 * assemble the document. Every stage that can fail returns `err` and stops — there is no path here that
 * produces a partial thread, because a partial thread the reader cannot distinguish from a whole one is
 * the failure this verb exists to avoid.
 *
 * The parsed link's `workspace` is replaced with the canonical origin off `auth.test` before any other
 * stage runs (see {@link canonicalTarget}) — every permalink this verb hands back is built from that field,
 * so it must be the provider's own, never an echo of whatever host the caller happened to paste.
 *
 * Every dependency is an injected plain function, so the orchestration is unit-testable end to end with
 * fakes and no mocks.
 */
import { ResultAsync } from "neverthrow";

import type { SlackApi } from "../../corpus/slack/fetch.js";
import { err, ok, type Result } from "../../lib/result.js";
import { resolveBlockFileRefs, slackFileLookup } from "./blockFiles.js";
import { deriveFileCompleteness, deriveThreadCompleteness } from "./completeness.js";
import { buildThreadDocument, type SlackThreadReadDocument } from "./document.js";
import type { DownloadFile } from "./download.js";
import type { SlackReadThreadError } from "./errors.js";
import { SlackReadThreadWorkspaceErrors } from "./errors.js";
import { downloadThreadFiles, type FileOutcome } from "./fileDownloads.js";
import { type FileScopePreflight, planThreadFiles, scopePreflight } from "./filePlan.js";
import { projectChannelHistory, type SlackNeighbourhood, selectNeighbourhood } from "./neighbourhood.js";
import { type CompleteThreadFetch, fetchCompleteSlackHistory, fetchCompleteSlackThread } from "./pagination.js";
import { parseSlackThreadPermalink, type SlackThreadTarget } from "./permalink.js";
import { projectSlackThread } from "./projection.js";
import { completenessWarnings, scopeWarnings, unretrievableWarnings } from "./readThreadWarnings.js";
import { type SelectedThread, selectThreadMessages, type ThreadSelection } from "./selection.js";
import { SlackSelectionErrors } from "./selectionErrors.js";
import { redirectedTarget } from "./threadRedirect.js";
import type { VisibleSlackMessage } from "./types.js";

/** Which token is doing the reading — a bot sees strictly less than the owner's user token. */
export type ReadPrincipal = "user" | "bot";

/** The injected edges. */
interface ReadThreadDeps {
  readonly api: Pick<SlackApi, "replies" | "history" | "filesInfo" | "grantedScopes" | "workspaceUrl">;
  readonly downloadFile: DownloadFile;
  readonly nowIso: () => string;
  readonly onProgress?: (progress: { phase: "fetch" | "channel" | "files"; done: number; total?: number }) => void;
}

/** One agent-directed live Slack read invocation. */
export interface ReadSlackThreadOptions {
  readonly permalink: string;
  readonly token: string;
  readonly principal: ReadPrincipal;
  readonly filesRoot: string;
  readonly maxFileBytes?: number;
  readonly sinceTs?: string | undefined;
  readonly around?: number | undefined;
  readonly channelAround?: number | undefined;
  readonly deps: ReadThreadDeps;
}

/**
 * A filesystem-safe key for a thread's attachment directory. Both components are provider-constrained
 * (`C/G/D` + uppercase alphanumerics, and a numeric timestamp), so neither can introduce a path segment.
 *
 * @param channel the conversation id
 * @param threadTs the thread root timestamp
 * @returns the directory name
 */
export function threadDirectoryKey({ channel, threadTs }: { channel: string; threadTs: string }): string {
  return `${channel}-${threadTs.replace(".", "")}`;
}

/**
 * Lift a `Promise<Result>` into a `ResultAsync`, so the pipeline below can be ONE `.andThen()` chain instead
 * of five repeated `if (result.isErr()) return err(result.error)` guards. Nothing about what runs changes —
 * every stage still returns exactly the `Result` it always did — only how the stages are threaded together.
 *
 * @param promise a promise of a Result
 * @returns the same outcome as a ResultAsync
 */
function toResultAsync<T, E>({ promise }: { promise: Promise<Result<T, E>> }): ResultAsync<T, E> {
  return ResultAsync.fromSafePromise(promise).andThen((result) => result);
}

/**
 * Read one Slack thread completely.
 *
 * @param options the permalink, agent-selected bounds, token, local file root and injected live seams
 * @returns the assembled document, or `err` naming the first thing that made the read incomplete
 */
export async function readSlackThread(
  options: ReadSlackThreadOptions,
): Promise<Result<SlackThreadReadDocument, SlackReadThreadError>> {
  const startedAt = options.deps.nowIso();
  const parsed = parseSlackThreadPermalink({ permalink: options.permalink });
  return toResultAsync({ promise: canonicalTarget({ api: options.deps.api, parsed }) })
    .andThen((target) => toResultAsync({ promise: fetchResolvedThread({ deps: options.deps, requested: target }) }))
    .andThen(({ target, fetched }) =>
      projectSlackThread({ rawMessages: fetched.rawMessages, target }).map((projected) => ({
        fetched,
        projected,
        target,
      })),
    )
    .andThen(({ fetched, projected, target }) =>
      toResultAsync({
        promise: selectReadContext({
          around: options.around,
          channelAround: options.channelAround,
          deps: options.deps,
          messages: projected.messages,
          sinceTs: options.sinceTs,
          target,
        }),
      }).map((context) => ({ context, fetched, projected, target })),
    )
    .andThen(({ context, fetched, projected, target }) =>
      toResultAsync({
        promise: retrieveThreadFiles({
          deps: options.deps,
          filesRoot: options.filesRoot,
          maxFileBytes: options.maxFileBytes,
          messages: context.selected.messages,
          target,
          token: options.token,
        }),
      }).map((files) => ({ context, fetched, files, projected, target })),
    )
    .map(({ context, fetched, files, projected, target }) =>
      assembleDocument({
        completedAt: options.deps.nowIso(),
        fetched,
        files: files.outcome,
        messages: context.selected.messages,
        neighbourhood: context.neighbourhood,
        preflight: files.preflight,
        principal: options.principal,
        selection: context.selected.selection,
        startedAt,
        target,
        threadMessageCount: projected.messages.length,
      }),
    );
}

/** The two independently selected context layers returned to the model. */
interface SelectedReadContext {
  readonly selected: SelectedThread;
  readonly neighbourhood?: SlackNeighbourhood;
}

/** Select the thread window and, only when requested, fetch and select complete channel history. */
async function selectReadContext({
  messages,
  target,
  around,
  channelAround,
  sinceTs,
  deps,
}: {
  messages: readonly VisibleSlackMessage[];
  target: SlackThreadTarget;
  around: number | undefined;
  channelAround: number | undefined;
  sinceTs: string | undefined;
  deps: ReadThreadDeps;
}): Promise<Result<SelectedReadContext, SlackReadThreadError>> {
  if (sinceTs !== undefined && channelAround !== undefined) {
    return err(SlackSelectionErrors.channelConflict());
  }
  const selected = selectThreadMessages({ anchorTs: target.addressedTs, around, messages, sinceTs });
  if (selected.isErr()) {
    return err(selected.error);
  }
  if (channelAround === undefined) {
    return ok({ selected: selected.value });
  }
  const history = await fetchCompleteSlackHistory({
    api: deps.api,
    channel: target.channel,
    latest: "9999999999",
    oldest: "0",
    onPage: ({ messageCount }) => deps.onProgress?.({ done: messageCount, phase: "channel" }),
    paced: true,
  });
  if (history.isErr()) {
    return err(history.error);
  }
  const projected = projectChannelHistory({ rawMessages: history.value.rawMessages, target });
  if (projected.isErr()) {
    return err(projected.error);
  }
  const neighbourhood = selectNeighbourhood({
    anchorTs: target.threadTs,
    around: channelAround,
    messages: projected.value,
    pageCount: history.value.pageCount,
  });
  return neighbourhood.isOk()
    ? ok({ neighbourhood: neighbourhood.value, selected: selected.value })
    : err(neighbourhood.error);
}

/**
 * Derive the completeness evidence and assemble the finished stages into the document.
 *
 * The oracle lives HERE rather than in the shell so that the evidence and the warning it produces have one
 * author. They have to agree, and the bug from splitting them is a document whose `completeness` says
 * `short-of-advertised` while its `warnings` are silent about it.
 *
 * It reads the RAW rows, which the attachment stage never touches, so nothing that happens to a download can
 * change what is concluded about the messages.
 *
 * `held` is the WHOLE thread, never the returned subset. Completeness answers "did this read get the whole
 * thread", which `--since` does not change — the fetch is complete either way, and only the RETURN is
 * narrowed. Passing the subset here would manufacture a `short-of-advertised` verdict on every `--since`
 * read and report a deliberate selection as provider loss.
 *
 * @param target the resolved thread
 * @param messages the messages being RETURNED
 * @param threadMessageCount messages in the whole projected thread
 * @param selection what this read returned and against what
 * @param files what the attachment stage retrieved, skipped, could not retrieve, and limited
 * @param preflight the file-lane scope verdict
 * @param fetched the complete fetch, for the raw rows and the page count
 * @param principal which token did the reading
 * @param startedAt when the read began
 * @param completedAt when it finished
 * @returns the result document
 */
function assembleDocument({
  target,
  messages,
  threadMessageCount,
  selection,
  files,
  preflight,
  fetched,
  principal,
  startedAt,
  completedAt,
  neighbourhood,
}: {
  target: SlackThreadTarget;
  messages: readonly VisibleSlackMessage[];
  threadMessageCount: number;
  selection: ThreadSelection;
  files: FileOutcome;
  preflight: FileScopePreflight;
  fetched: CompleteThreadFetch;
  principal: ReadPrincipal;
  startedAt: string;
  completedAt: string;
  neighbourhood: SlackNeighbourhood | undefined;
}): SlackThreadReadDocument {
  const completeness = deriveThreadCompleteness({
    held: threadMessageCount,
    rawMessages: fetched.rawMessages,
    threadTs: target.threadTs,
  });
  return buildThreadDocument({
    completeness,
    fileCompleteness: deriveFileCompleteness({
      retrieved: files.retrieved.length,
      skipped: files.skipped.length,
      unretrievable: files.unretrievable.length,
    }),
    files: files.retrieved,
    limitations: files.limitations,
    messages,
    ...(neighbourhood === undefined ? {} : { neighbourhood }),
    observation: { completedAt, pageCount: fetched.pageCount, startedAt },
    scopePreflight: preflight,
    selection,
    skippedFiles: files.skipped,
    target,
    threadMessageCount,
    unretrievableFiles: files.unretrievable,
    warnings: [
      ...principalWarnings({ principal }),
      ...completenessWarnings({ completeness }),
      ...scopeWarnings({ preflight }),
      ...unretrievableWarnings({ files }),
    ],
  });
}

/**
 * Replace the parsed link's `workspace` — the caller's own input, echoed straight off the URL they pasted —
 * with the provider's canonical origin, resolved fresh off `auth.test`. Every permalink this verb hands back
 * is built from `target.workspace`, so a wrong or stale host in the pasted link must never survive into the
 * output: round-tripping a permalink through this verb has to be a genuine confirmation, not an echo. A
 * workspace that cannot be resolved refuses the read rather than falling back to the caller's host, matching
 * `cli/commands/turn/dispatchFreshSession.ts`'s `resolveAskPermalinkOrRefuse`.
 *
 * @param api the injected Slack seam
 * @param parsed the permalink parse, or the reason it was refused
 * @returns the target with its workspace replaced by the canonical origin, or `err`
 */
async function canonicalTarget({
  api,
  parsed,
}: {
  api: ReadThreadDeps["api"];
  parsed: Result<SlackThreadTarget, SlackReadThreadError>;
}): Promise<Result<SlackThreadTarget, SlackReadThreadError>> {
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const workspaceUrl = await api.workspaceUrl();
  if (workspaceUrl === undefined) {
    return err(SlackReadThreadWorkspaceErrors.workspaceUnresolved());
  }
  const workspace = workspaceUrl.endsWith("/") ? workspaceUrl.slice(0, -1) : workspaceUrl;
  return ok({ ...parsed.value, workspace });
}

/**
 * The thread the pasted link REALLY names, fetched in full.
 *
 * A reply link with no `?thread_ts=` comes back as one foreign-threaded message naming its real root, so this
 * may issue a second fetch — at most one, and only on that tell-tale answer (see {@link redirectedTarget}).
 *
 * @param deps the injected Slack seam and progress sink
 * @param requested the target parsed straight out of the link
 * @returns the resolved target and its complete fetch, or `err`
 */
async function fetchResolvedThread({
  deps,
  requested,
}: {
  deps: ReadThreadDeps;
  requested: SlackThreadTarget;
}): Promise<Result<{ target: SlackThreadTarget; fetched: CompleteThreadFetch }, SlackReadThreadError>> {
  const first = await fetchThreadFor({ deps, target: requested });
  if (first.isErr()) {
    return err(first.error);
  }
  const redirect = redirectedTarget({ rawMessages: first.value.rawMessages, target: requested });
  if (redirect === undefined) {
    return ok({ fetched: first.value, target: requested });
  }
  const again = await fetchThreadFor({ deps, target: redirect });
  return again.isOk() ? ok({ fetched: again.value, target: redirect }) : err(again.error);
}

/**
 * One complete fetch for a resolved target.
 *
 * @param deps the injected Slack seam and progress sink
 * @param target the thread to read
 * @returns every message, or `err`
 */
async function fetchThreadFor({ deps, target }: { deps: ReadThreadDeps; target: SlackThreadTarget }) {
  return fetchCompleteSlackThread({
    api: deps.api,
    channel: target.channel,
    onPage: ({ messageCount }) => deps.onProgress?.({ done: messageCount, phase: "fetch" }),
    threadTs: target.threadTs,
  });
}

/**
 * Resolve the Block Kit references, classify every attachment, then fetch the ones worth fetching.
 *
 * The `files.info` step runs FIRST and unconditionally, so a block-referenced image is planned by the same
 * rules as a top-level one rather than being reported as unreachable on principle. It is cheap when there is
 * nothing to do: no references means no calls.
 *
 * @param messages the projected thread
 * @param target the thread being read
 * @param filesRoot the attachment root under the home
 * @param maxFileBytes the per-attachment ceiling
 * @param token the Slack token authorised for the files
 * @param deps the injected Slack seam, downloader, scope source and progress sink
 * @returns the attachment outcome and the scope verdict, or `err` if the destination directory is unusable
 */
async function retrieveThreadFiles({
  messages,
  target,
  filesRoot,
  maxFileBytes,
  token,
  deps,
}: {
  messages: readonly VisibleSlackMessage[];
  target: SlackThreadTarget;
  filesRoot: string;
  maxFileBytes: number | undefined;
  token: string;
  deps: ReadThreadDeps;
}): Promise<Result<{ outcome: FileOutcome; preflight: FileScopePreflight }, SlackReadThreadError>> {
  const blockFiles = await resolveBlockFileRefs({ lookup: slackFileLookup({ api: deps.api }), messages });
  const plan = planThreadFiles({
    blockFiles,
    messages,
    ...(maxFileBytes !== undefined ? { maxBytes: maxFileBytes } : {}),
  });
  const preflight = scopePreflight({ grantedScopes: await deps.api.grantedScopes(), plan });
  deps.onProgress?.({ done: 0, phase: "files", total: plan.downloads.length });
  const outcome = await downloadThreadFiles({
    downloadFile: deps.downloadFile,
    plan,
    preflight,
    rootDir: filesRoot,
    threadKey: threadDirectoryKey({ channel: target.channel, threadTs: target.threadTs }),
    token,
  });
  return outcome.isOk() ? ok({ outcome: outcome.value, preflight }) : err(outcome.error);
}

/**
 * A bot token sees fewer conversations and fewer files than the owner's own token, so a thread read as the
 * bot may legitimately be missing content the owner can see. Say so rather than let it look complete.
 *
 * @param principal which token was used
 * @returns the warnings to carry in the document
 */
function principalWarnings({ principal }: { principal: ReadPrincipal }): readonly string[] {
  return principal === "bot"
    ? ["read with the BOT token: private conversations and files the bot cannot see are not included"]
    : [];
}
