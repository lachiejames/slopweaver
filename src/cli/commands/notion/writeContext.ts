/**
 * What every `notion page` lane shares: the injectable edges, the resolved context one write runs against,
 * the canonical read-back, and the door router.
 *
 * It exists because the lanes themselves are genuinely different — create reserves an intent, update gates
 * on authorship, move re-parents and reads the parent back, archive trashes — while all four resolve the
 * same addresses, take the same digest, and are admitted through the same door. Keeping that half here is
 * what lets `./moveRun.ts` be its own file rather than a fifth section of an already long one.
 *
 * One shape here is load-bearing: {@link routeThroughDoor} takes the effect as an ARGUMENT rather than
 * dispatching on the verb itself. A router that knew the verb set would have to import every lane, and every
 * lane already imports the router — the cycle is what made the verb dispatch live in the caller instead.
 */
import { readFileSync } from "node:fs";

import { DEFAULT_GATES } from "../../../admit/door.js";
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import { notionToken } from "../../../config.js";
import { makeNotionMediaApi, type NotionMediaApi } from "../../../corpus/notion/mediaApi.js";
import { makeNotionWriteApi, makeNotionWriteSeam, type NotionWriteApi } from "../../../corpus/notion/writeApi.js";
import { logger } from "../../../lib/logger.js";
import { err, type Result } from "../../../lib/result.js";
import { parseNotionReadAddress } from "../../../live/notion/read.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { notionAboveFoldCells, notionBelowFoldCells } from "../../../outbound/notion/aboveFold.js";
import { linkifyPageBody } from "../../../outbound/notion/bareRefLinks.js";
import { canonicalCarriesTable, canonicalHash, incompleteReadReason } from "../../../outbound/notion/markdownBody.js";
import { aboveFoldGateRefused } from "../../aboveFoldDoor.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { bareRefGateRefused } from "../../bareRefDoor.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type NotionCommandError, NotionCommandErrors } from "./errors.js";
import type { MediaFileReader } from "./mediaAttach.js";
import {
  checkedPageId,
  type NotionPageArgs,
  type NotionPageOutcome,
  notionPageDoorRequest,
  notionPageOutcomeLines,
} from "./pageCore.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface NotionPageDeps {
  readonly readBody: (args: { source: string }) => string;
  /**
   * One environment variable, injected rather than read at the point of use — the above-the-fold override is
   * a DECISION, and a decision reached through ambient state is one no test can make.
   */
  readonly env: (args: { name: string }) => string | undefined;
  /** What this page's bare `#N`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  /** Both seams over ONE client, its every write judged under the policy of the home the verb resolved. */
  readonly makeApis: (args: { token: string; home: string }) => NotionApis;
  readonly readMedia: MediaFileReader;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The door ledger every page write's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The page seam and the media seam one write runs against. */
export interface NotionApis {
  readonly api: NotionWriteApi;
  readonly mediaApi: NotionMediaApi;
}

/**
 * Both Notion seams over ONE write-lane client, so a page write and its image pass share one scheduler, one 429
 * scope and one privacy capability — built from the home the verb resolved, never an ambient one.
 *
 * @param token the configured Notion integration token
 * @param home the state home whose private-terms file every write is judged under
 * @returns the page seam and the media seam
 */
export function makeNotionApis({ token, home }: { token: string; home: string }): NotionApis {
  const seam = makeNotionWriteSeam({ home, token });
  return { api: makeNotionWriteApi({ seam }), mediaApi: makeNotionMediaApi({ seam }) };
}

/**
 * Read one image file for the attach pass, reporting a missing or unreadable file as a REASON.
 *
 * @param path the resolved absolute path
 * @returns the bytes, or the reason they could not be read
 */
export function readMediaFile({
  path,
}: {
  path: string;
}): { readonly bytes: Uint8Array<ArrayBuffer> } | { readonly error: string } {
  try {
    return { bytes: new Uint8Array(readFileSync(path)) };
  } catch (cause) {
    return { error: `cannot read ${path}: ${cause instanceof Error ? cause.message : "unreadable"}` };
  }
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionNotionPageDeps(): NotionPageDeps {
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`notion page: ${line}\n`),
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

/**
 * Print each line to stderr and return the code.
 *
 * @param deps the injected output sink
 * @param lines the refusal, one operator-facing line at a time
 * @param code the exit code to hand back
 * @returns that same code, so a caller can `return refuse(…)` in one statement
 */
export function refuse({
  deps,
  lines,
  code,
}: {
  deps: NotionPageDeps;
  lines: readonly string[];
  code: number;
}): number {
  for (const line of lines) {
    deps.err(line);
  }
  return code;
}

/** Everything the effect phase needs once the cheap checks have passed. */
export interface WriteContext {
  readonly api: NotionWriteApi;
  readonly mediaApi: NotionMediaApi;
  readonly deps: NotionPageDeps;
  readonly home: string;
  readonly args: NotionPageArgs;
  /** The AUTHORED body, still carrying its `file:` placeholders. The intent digest is taken over this. */
  readonly body: string;
  /** The directory relative placeholder paths resolve against. */
  readonly mediaBase: string;
  readonly destination: string;
  /** `move` only: the resolved parent the page is being re-parented under. */
  readonly moveTo: string | undefined;
  readonly intent: string;
}

/**
 * Resolve a `--parent`/`--page` address into a canonical, filename-safe Notion page id.
 *
 * @param address the id or URL the operator typed
 * @returns the canonical id, or the refusal naming why the address cannot be used
 */
export function resolvePageId({ address }: { address: string }): Result<string, NotionCommandError> {
  const parsed = parseNotionReadAddress({ address, kind: "page" });
  return parsed.isErr()
    ? err(NotionCommandErrors.pageAddressInvalid({ cause: parsed.error }))
    : checkedPageId({ id: parsed.value.id });
}

/**
 * Read a page back as canonical markdown, refusing a read too incomplete to be evidence.
 *
 * `carriesTable` travels with the digest rather than being recomputed by the caller, because it is a fact
 * about the very same read: recomputing it from a second `retrieveMarkdown` would let the two disagree.
 *
 * @param ctx the resolved write context, naming the page to read
 * @returns the digest and whether the page carries a table, or the reason the read is not usable evidence
 */
export async function canonicalOf({
  ctx,
}: {
  ctx: WriteContext;
}): Promise<{ readonly hash: string; readonly carriesTable: boolean } | { readonly reason: string }> {
  const read = await ctx.api.retrieveMarkdown({ pageId: ctx.destination });
  if (read.isErr()) {
    return { reason: read.error.message };
  }
  const incomplete = incompleteReadReason({
    truncated: read.value.truncated,
    unknownBlockIds: read.value.unknownBlockIds,
  });
  return incomplete === undefined
    ? {
        carriesTable: canonicalCarriesTable({ canonical: read.value.markdown }),
        hash: canonicalHash({ canonical: read.value.markdown }),
      }
    : { reason: incomplete };
}

/** What the pre-update checks concluded. */
export type UpdateGate =
  | { readonly go: true; readonly priorCanonical: string; readonly note?: string | undefined }
  | { readonly adopt: true; readonly url: string; readonly canonical: string }
  | { readonly reason: string };

/** The exit code for an outcome. */
function codeFor({ outcome }: { outcome: NotionPageOutcome }): number {
  if (
    outcome.kind === "archived" ||
    outcome.kind === "created" ||
    outcome.kind === "updated" ||
    outcome.kind === "unchanged" ||
    outcome.kind === "moved" ||
    outcome.kind === "unmoved" ||
    outcome.kind === "adopted"
  ) {
    return EXIT_OK;
  }
  return outcome.kind === "failed" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
}

/**
 * Report an outcome and return its exit code.
 *
 * @param deps the injected output sink
 * @param outcome what the effect concluded
 * @returns the exit code for that outcome
 */
export function report({ deps, outcome }: { deps: NotionPageDeps; outcome: NotionPageOutcome }): number {
  for (const line of notionPageOutcomeLines({ outcome })) {
    deps.out(line);
  }
  return codeFor({ outcome });
}

/**
 * Admit the mutation and perform it only on a pass.
 *
 * @param ctx the resolved write context, which names the destination and the verb the door record carries
 * @param perform the effect to run once admitted — supplied by the lane, so this router never learns the
 *   verb set and the lanes never import each other
 * @returns the exit code, whether the door refused or the effect reported
 */
export async function routeThroughDoor({
  ctx,
  perform,
}: {
  ctx: WriteContext;
  perform: () => Promise<NotionPageOutcome>;
}): Promise<number> {
  const routed = await throughDoor({
    gates: DEFAULT_GATES,
    // The home is passed EXPLICITLY: `request.meta.home` describes the action, it does not choose where the
    // door ledger is written, and omitting it splits the audit trail from the page ledger under `--home`.
    home: ctx.home,
    ledger: ctx.deps.doorLedger,
    perform,
    request: notionPageDoorRequest({
      destination: ctx.destination,
      home: ctx.home,
      intent: ctx.intent,
      verb: ctx.args.verb,
    }),
  });
  if (!routed.performed) {
    return refuse({
      code: routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY,
      deps: ctx.deps,
      lines: [...notPerformedLines({ command: `slopweaver notion page ${ctx.args.verb}`, through: routed })],
    });
  }
  return report({ deps: ctx.deps, outcome: routed.result });
}

/**
 * The above-the-fold gate on the body's lead, which is everything before its first heading.
 *
 * @param args the parsed invocation, for the dry-run flag and the state home
 * @param body the markdown that would be published
 * @param deps the injected environment reader and output sink
 * @returns true when the publish must refuse
 */
export async function aboveFoldRefused({
  args,
  body,
  deps,
}: {
  args: NotionPageArgs;
  body: string;
  deps: NotionPageDeps;
}): Promise<boolean> {
  return aboveFoldGateRefused({
    surface: "notion",
    belowFoldCells: notionBelowFoldCells({ markdown: body }),
    cells: notionAboveFoldCells({ markdown: body }),
    dryRun: args.dryRun,
    env: deps.env,
    home: resolveHome({ named: args.home }),
    ledger: deps.doorLedger,
    out: ({ line }) => {
      deps.out(line);
    },
  });
}

/**
 * Resolve every `#N`/`owner/repo#N`/`SUP-123` in the page body into a real markdown link, then refuse
 * whatever still can't resolve — the rule that a bare reference never reaches an
 * outbound surface. See `../../bareRefDoor.ts`.
 *
 * @param body the raw markdown body, as read from `--body`
 * @param home the state home this write's context is resolved against
 * @param deps the injected environment reader and output sink
 * @returns the linkified body, plus true when the write must refuse
 */
export function linkifiedNotionBody({ body, home, deps }: { body: string; home: string; deps: NotionPageDeps }): {
  readonly body: string;
  readonly refused: (args: { dryRun: boolean }) => boolean;
} {
  const linked = linkifyPageBody({ context: deps.bareRefContext({ home }), markdown: body });
  return {
    body: linked.markdown,
    refused: ({ dryRun }) =>
      bareRefGateRefused({
        dryRun,
        env: deps.env,
        home,
        issues: linked.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        out: ({ line }) => {
          deps.out(line);
        },
      }),
  };
}
