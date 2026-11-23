/**
 * The edges `linear comment create` reaches through — the one seam `./commentRun.ts` and `./commentTarget.ts`
 * share, and the one bag a test swaps for plain fakes.
 */
import { readFileSync } from "node:fs";

import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { linearToken } from "../../../config.js";
import { type LinearWriteApi, makeLinearWriteApi } from "../../../corpus/linear/write.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { findLinearDocumentComment, type LinearDocumentComment } from "../../../live/linear/documentComments.js";
import { linearReadRequest } from "../../../live/linear/read.js";
import { readLinearDocument } from "../../../live/linear/readDocument.js";
import { linearWritePrivacy } from "../../../outbound/linear/writePrivacy.js";
import type { BareRefContext } from "../../../outbound/linkify/bareRefs.js";
import { identityRosterPort } from "../../../silver/identityRoster.js";
import { bareRefContext as bareRefContextFor } from "../../bareRefContext.js";
import { type LinearMentionResolver, mentionsFromIdentity, mentionsFromIdentityUnrefreshed } from "./wiring.js";

/** The injectable edges. A test supplies plain functions; nothing here is a mock. */
export interface LinearCommentWriteDeps {
  readonly readForm: (args: { source: string }) => string;
  /**
   * One environment variable, injected rather than read at the point of use — the above-the-fold override is
   * a DECISION, and a decision reached through ambient state is one no test can make.
   */
  readonly env: (args: { name: string }) => string | undefined;
  /** What this comment's bare `#N`/`SUP-123` references can resolve against — see `../../bareRefContext.js`. */
  readonly bareRefContext: (args: { home: string }) => BareRefContext;
  /** Resolve the body's `@{key}` mentions against the store's identity roster, refreshing it just-in-time. */
  readonly resolveMentions: LinearMentionResolver;
  /** The dry run's reading: the same resolution against the rosters as they STAND, leaving no trace. */
  readonly previewMentions: LinearMentionResolver;
  readonly resolveToken: (args: { home: string }) => string | undefined;
  /**
   * Read a document's node for a document comment: the content id it attaches to and the content a quote must
   * be found in. Read-only, so the dry run takes it too.
   */
  readonly readDocument: (args: {
    token: string;
    id: string;
  }) => Promise<Result<Readonly<Record<string, unknown>>, { readonly message: string }>>;
  /**
   * Find one comment among a document's comments, for a reply's parent: `undefined` once every page was read
   * without it. Read-only, so the dry run takes it too.
   */
  readonly readDocumentComment: (args: {
    token: string;
    documentId: string;
    commentId: string;
  }) => Promise<Result<LinearDocumentComment | undefined, { readonly message: string }>>;
  readonly makeApi: (args: { home: string; token: string }) => LinearWriteApi;
  readonly nowIso: () => string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** The door ledger the write's admit decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/**
 * The live edges.
 *
 * @returns the production dependency bag, swapped for plain fakes under test
 */
export function productionLinearCommentWriteDeps(): LinearCommentWriteDeps {
  // One bag per verb call, so this is the write's ask instant — what the roster's freshness is judged against.
  const askedAtIso = new Date().toISOString();
  // The composition root for the roster port, as it is for the door ledger below.
  const identityRoster = identityRosterPort();
  return {
    bareRefContext: ({ home }) => bareRefContextFor({ home }),
    doorLedger: doorLedgerPort(),
    env: ({ name }) => process.env[name],
    err: (line) => process.stderr.write(`linear comment: ${line}\n`),
    makeApi: ({ home, token }) => makeLinearWriteApi({ privacy: linearWritePrivacy({ home }), token }),
    nowIso: () => new Date().toISOString(),
    out: (line) => {
      logger.out({ line });
    },
    previewMentions: ({ home, keys, verified }) =>
      mentionsFromIdentityUnrefreshed({ home, identityRoster, keys, verified }),
    readDocument: ({ token, id }) => readLinearDocument({ id, request: linearReadRequest({ token }) }),
    readDocumentComment: ({ token, documentId, commentId }) =>
      findLinearDocumentComment({ commentId, documentId, request: linearReadRequest({ token }) }),
    readForm: ({ source }) => (source === "-" ? readFileSync(0, "utf8") : source),
    resolveMentions: ({ home, keys, verified }) =>
      mentionsFromIdentity({ askedAtIso, home, identityRoster, keys, verified }),
    resolveToken: ({ home }) => linearToken({ home }),
  };
}
