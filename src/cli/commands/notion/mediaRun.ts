/**
 * `slopweaver notion attach` — the effectful shell for a standalone image pass.
 *
 * ## Why this exists when `notion page` already runs the pass
 *
 * A normal publish attaches its own images. This verb is the RECOVERY path, and it is possible at all
 * because the state it needs is durable rather than in a session: the authored markdown on disk says which
 * file belongs at which position, and a marker still sitting on the page says that image never landed. So a
 * publish whose third shot failed is finished by re-running this, and the two shots that did land are left
 * alone — an absent marker means already attached.
 *
 * ## The order is the contract
 *
 *   parse → read the body → [dry-run stops here] → token → resolve address → ownership → authorship →
 *   door → attach → read back → re-record the digest → report
 *
 * The last two steps are not bookkeeping. Attaching an image CHANGES the page, so a run that did not
 * re-record the canonical digest would leave the ledger describing the marker version, and the next
 * `notion page update` would refuse the page as "changed since slopweaver last wrote it".
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { notionToken } from "../../../config.js";
import type { NotionMediaApi } from "../../../corpus/notion/mediaApi.js";
import type { NotionWriteApi } from "../../../corpus/notion/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { parseNotionReadAddress } from "../../../live/notion/read.js";
import { canonicalHash, incompleteReadReason } from "../../../outbound/notion/markdownBody.js";
import { confirmPageUpdate, isValidPageId } from "../../../outbound/notion/pageLedger.js";
import { pageOwnershipOf } from "../../../outbound/notion/pageOwnership.js";
import { verifyReminderLines } from "../../../outbound/notion/verifyCommand.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { botIsLastEditor, resolveExternalEdit } from "./authorship.js";
import { type NotionCommandError, NotionCommandErrors, notionCommandErrorLines } from "./errors.js";
import { type AttachReport, attachMedia, attachReportLines, type MediaFileReader } from "./mediaAttach.js";
import {
  type NotionAttachArgs,
  notionAttachDryRunLines,
  notionImageDoorRequest,
  parseNotionAttachArgs,
} from "./mediaCore.js";
import { makeNotionApis, type NotionApis, readMediaFile } from "./writeContext.js";

/** Where this verb's own arguments start in `process.argv`: after node, the script, the noun and the verb. */
const VERB_ARG_OFFSET = 4;

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface NotionImageDeps {
  readonly readBody: (args: { source: string }) => string;
  readonly readMedia: MediaFileReader;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  /** Both seams over ONE client, its every write judged under the policy of the home the verb resolved. */
  readonly makeApis: (args: { token: string; home: string }) => NotionApis;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The door ledger the image pass's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionNotionImageDeps(): NotionImageDeps {
  return {
    doorLedger: doorLedgerPort(),
    err: (line) => process.stderr.write(`notion attach:${line}\n`),
    makeApis: makeNotionApis,
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    readBody: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8")),
    readMedia: readMediaFile,
    resolveToken: ({ home }) => notionToken({ home }),
  };
}

/** Print each line to stderr and return the code. */
function refuse({ deps, lines, code }: { deps: NotionImageDeps; lines: readonly string[]; code: number }): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs once the cheap checks have passed. */
interface AttachContext {
  readonly api: NotionWriteApi;
  readonly mediaApi: NotionMediaApi;
  readonly deps: NotionImageDeps;
  readonly args: NotionAttachArgs;
  readonly home: string;
  readonly markdown: string;
  readonly baseDir: string;
  readonly pageId: string;
}

/**
 * Whether this page may be written to at all.
 *
 * Two independent checks, exactly as `notion page update` uses: the LEDGER says slopweaver created the page,
 * and the provider's own `last_edited_by` says nobody else has touched it since. Both, rather than either,
 * because the pass DELETES blocks — marker blocks it published itself, but a page whose provenance is
 * unproven is not one to start deleting from on a pattern match.
 *
 * An external edit is resolved exactly as `notion page update` resolves one: byte-identical to what
 * slopweaver last confirmed is no edit at all, and a genuine one needs `--overwrite-external-edit`.
 */
async function attachGate({ ctx }: { ctx: AttachContext }): Promise<string | undefined> {
  const ownership = pageOwnershipOf({ home: ctx.home, pageId: ctx.pageId });
  if (!ownership.owned) {
    return `${ownership.reason}\nIf slopweaver did publish it, record that with \`notion page update --adopt\` first.`;
  }
  const authorship = await botIsLastEditor({ api: ctx.api, pageId: ctx.pageId });
  if ("reason" in authorship) {
    return authorship.reason;
  }
  if (!("externalEdit" in authorship)) {
    return undefined;
  }
  const canonical = await canonicalOf({ ctx });
  if ("reason" in canonical) {
    return canonical.reason;
  }
  const resolved = resolveExternalEdit({
    authorship,
    canonical: canonical.hash,
    // `carriesTable` is left at its default here rather than computed, and that is a decision: the table
    // column-width blind spot exists because an UPDATE replaces every block, and this pass replaces none —
    // it inserts images at markers it published itself, so a resized column survives it untouched.
    home: ctx.home,
    nowIso: ctx.deps.nowIso(),
    overwriteReason: ctx.args.overwriteExternalEdit,
    pageId: ctx.pageId,
    priorCanonical: ownership.record.lastCanonicalHash,
  });
  return "reason" in resolved ? resolved.reason : undefined;
}

/** Read the page back as canonical markdown, refusing a read too incomplete to be evidence. */
async function canonicalOf({
  ctx,
}: {
  ctx: AttachContext;
}): Promise<{ readonly hash: string } | { readonly reason: string }> {
  const read = await ctx.api.retrieveMarkdown({ pageId: ctx.pageId });
  if (read.isErr()) {
    return { reason: read.error.message };
  }
  const incomplete = incompleteReadReason({
    truncated: read.value.truncated,
    unknownBlockIds: read.value.unknownBlockIds,
  });
  return incomplete === undefined
    ? { hash: canonicalHash({ canonical: read.value.markdown }) }
    : { reason: incomplete };
}

/** What one attach run produced, once the ledger has been brought back into agreement with the page. */
interface AttachOutcome {
  readonly report: AttachReport;
  /**
   * Why the page could not be re-read, so the ledger still describes the pre-attach page; `null` when the
   * attach was recorded, which is the ordinary case.
   */
  readonly unrecorded: string | null;
}

/** Attach, then re-record the digest so the next `page update` still recognises the page as unchanged. */
async function performAttach({ ctx }: { ctx: AttachContext }): Promise<AttachOutcome> {
  const attached = await attachMedia({
    api: ctx.mediaApi,
    baseDir: ctx.baseDir,
    markdown: ctx.markdown,
    pageId: ctx.pageId,
    readMedia: ctx.deps.readMedia,
  });
  if (attached.attached.length === 0) {
    // Nothing changed on the page, so the recorded digest still describes it exactly.
    return { report: attached, unrecorded: null };
  }
  const canonical = await canonicalOf({ ctx });
  if ("reason" in canonical) {
    return { report: attached, unrecorded: canonical.reason };
  }
  confirmPageUpdate({
    canonical: canonical.hash,
    home: ctx.home,
    images: attached.attached.map((image) => ({
      blockId: image.blockId,
      fileUploadId: image.fileUploadId,
      placeholderId: image.placeholderId,
      source: image.source,
    })),
    nowIso: ctx.deps.nowIso(),
    pageId: ctx.pageId,
  });
  return { report: attached, unrecorded: null };
}

/** The machine-readable form of one run, for `--json`. */
function outcomeJson({ outcome, pageId }: { outcome: AttachOutcome; pageId: string }): string {
  return JSON.stringify(
    {
      alreadyAttached: outcome.report.alreadyAttached,
      attached: outcome.report.attached,
      failures: outcome.report.failures,
      pageId,
      placeholders: outcome.report.placeholders,
      unrecorded: outcome.unrecorded,
    },
    null,
    2,
  );
}

/**
 * The human-readable report for one attach pass.
 *
 * Split out of {@link report} to keep that function under this repository's cognitive-complexity ceiling.
 *
 * @param ctx the resolved invocation, for the page the reminder points at
 * @param outcome what the attach pass did
 * @returns the lines to print
 */
function humanReportLines({ ctx, outcome }: { ctx: AttachContext; outcome: AttachOutcome }): readonly string[] {
  const nothingToDo =
    outcome.report.placeholders === 0
      ? ["no `file:` placeholders in that markdown, so there is nothing to attach."]
      : [];
  // An attach CHANGES the page, so the page it leaves behind is as unverified as one a write just created —
  // and an image landing at the wrong position is exactly the kind of thing only a render shows.
  const reminder =
    outcome.report.attached.length > 0
      ? verifyReminderLines({ pageUrl: `https://www.notion.so/${ctx.pageId.replaceAll("-", "")}` })
      : [];
  return [...attachReportLines({ report: outcome.report }), ...nothingToDo, ...reminder];
}

/** Report one run and return its exit code. */
function report({ ctx, outcome }: { ctx: AttachContext; outcome: AttachOutcome }): number {
  if (ctx.args.json) {
    ctx.deps.out(outcomeJson({ outcome, pageId: ctx.pageId }));
  } else {
    for (const line of humanReportLines({ ctx, outcome })) {
      ctx.deps.out(line);
    }
  }
  if (outcome.unrecorded !== null) {
    ctx.deps.err(
      `the images attached, but the page could NOT be read back, so the ledger still describes the page ` +
        `before they were added: ${outcome.unrecorded}. The next \`notion page update\` will refuse until ` +
        "this is re-run successfully.",
    );
  }
  return outcome.report.failures.length > 0 || outcome.unrecorded !== null ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** The effect phase: token, address, gate, door, attach. */
async function runLive({
  args,
  deps,
  markdown,
}: {
  args: NotionAttachArgs;
  deps: NotionImageDeps;
  markdown: string;
}): Promise<number> {
  const home = resolveHome({ named: args.home });
  const token = deps.resolveToken({ home });
  if (token === undefined) {
    return refuse({
      code: EXIT_EXPECTED_EMPTY,
      deps,
      lines: ["no Notion token for this home. Set NOTION_TOKEN, or run `slopweaver connect notion`"],
    });
  }
  const address = resolvePageId({ address: args.page });
  if (!address.isOk()) {
    return refuse({ code: EXIT_USAGE, deps, lines: [address.error.message] });
  }
  const { api, mediaApi } = deps.makeApis({ home, token });
  const ctx: AttachContext = {
    api,
    args,
    baseDir: baseDirOf({ args }),
    deps,
    home,
    mediaApi,
    markdown,
    pageId: address.value,
  };
  const refusal = await attachGate({ ctx });
  if (refusal !== undefined) {
    return refuse({ code: EXIT_EXPECTED_EMPTY, deps, lines: [refusal] });
  }
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    home,
    ledger: deps.doorLedger,
    perform: () => performAttach({ ctx }),
    request: notionImageDoorRequest({ home, pageId: ctx.pageId }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps,
      lines: [...notPerformedLines({ command: "slopweaver notion attach", through: routed })],
    });
  }
  return report({ ctx, outcome: routed.result });
}

/** Resolve a `--page` address into a canonical, filename-safe Notion page id. */
function resolvePageId({ address }: { address: string }): Result<string, NotionCommandError> {
  const parsed = parseNotionReadAddress({ address, kind: "page" });
  if (parsed.isErr()) {
    return err(NotionCommandErrors.pageAddressInvalid({ cause: parsed.error }));
  }
  return isValidPageId({ id: parsed.value.id })
    ? ok(parsed.value.id)
    : err(NotionCommandErrors.pageIdNotCanonical({ id: parsed.value.id }));
}

/**
 * Where relative placeholder paths resolve from: `--media-base` when given, else the body file's own
 * directory, or the working directory for a body read from stdin — `mediaBase.ts`'s rule for `notion page`.
 */
function baseDirOf({ args }: { args: NotionAttachArgs }): string {
  if (args.mediaBase !== undefined) {
    return args.mediaBase;
  }
  return args.from === "-" ? process.cwd() : dirname(args.from);
}

/**
 * Run `notion attach`.
 *
 * @param argv the full argv for the invocation
 * @param deps the injectable edges
 * @returns the process exit code
 */
export async function runNotionImage({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: NotionImageDeps;
}): Promise<number> {
  const parsed = parseNotionAttachArgs({ argv: argv.slice(VERB_ARG_OFFSET) });
  if (parsed.isErr()) {
    return refuse({ code: EXIT_USAGE, deps, lines: notionCommandErrorLines({ error: parsed.error }) });
  }
  const args = parsed.value;
  const markdown = deps.readBody({ source: args.from });
  if (args.dryRun) {
    // Stops here, before every effect. No token, no door record, no ledger, no network.
    const preview = resolvePageId({ address: args.page });
    const lines = notionAttachDryRunLines({
      baseDir: baseDirOf({ args }),
      markdown,
      pageId: preview.isOk() ? preview.value : undefined,
    });
    for (const line of lines) {
      deps.out(line);
    }
    return EXIT_OK;
  }
  return runLive({ args, deps, markdown });
}

/** `slopweaver notion attach` — upload each placeholder's file and insert it where it belongs. */
export const notionAttachCommand = defineCommand({
  run: (argv: readonly string[]) => runNotionImage({ argv, deps: productionNotionImageDeps() }),
});
