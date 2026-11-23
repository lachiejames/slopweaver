/**
 * The transport that reads one Fathom share page in the owner's own Chrome.
 *
 * One operation, one page, no click: it takes the machine-wide relay lease bound to the Fathom origin, runs
 * the fixed `fathom-share-transcript` arm (`fathomShareSnippet.ts`), releases the session on every path, and
 * hands back the snippet's own decoded object for `corpus/fathom/sharePage.ts` to judge. It decides nothing
 * about the page itself — a sign-in wall and a redesign are the pure reader's to name.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type BrowserTransportError, BrowserTransportErrors } from "./pageTransport.js";
import type { RelayOperation } from "./relayOperation.js";
import { runLeasedOperation } from "./relayRun.js";
import { openScratch, openSession, type PlaywrightCliDeps, readSnippetOutput, releaseSession } from "./relaySession.js";

/**
 * How long the page is given to paint before the first read. MEASURED on all four Auditco share
 * pages: the cues were present at the first read after this settle.
 *
 * @internal
 */
export const FATHOM_SHARE_SETTLE_MS = 4_000;

/**
 * The one relay operation a share read is: the fixed `fathom-share-transcript` arm on this address.
 *
 * @param url the canonical share URL, already validated
 * @returns the operation, carrying the measured settle
 *
 * @internal
 */
export function fathomShareOperation({ url }: { url: string }): RelayOperation {
  return { kind: "fathom-share-transcript", settleMs: FATHOM_SHARE_SETTLE_MS, url };
}

/**
 * Decode what the terminal client printed for a share read into the snippet's own object. Pure.
 *
 * @param stdout the client's raw output
 * @returns the snippet's decoded object, or a lost session when nothing parseable came home
 *
 * @internal
 */
export function decodeFathomShareOutput({
  stdout,
}: {
  stdout: string;
}): Result<Record<string, unknown>, BrowserTransportError> {
  const output = readSnippetOutput({ stdout });
  if (output === null) {
    return err(
      BrowserTransportErrors.sessionLost({
        reason: "the Fathom share read printed nothing this could parse, so its result never came home",
      }),
    );
  }
  return ok(output);
}

/**
 * Read one share page and return what its snippet printed.
 *
 * @param deps the relay dependencies, leased for the Fathom origin
 * @param url the canonical share URL, already validated
 * @returns the snippet's decoded object, or why the browser could not give one back
 */
export function readFathomSharePage({
  deps,
  url,
}: {
  deps: PlaywrightCliDeps;
  url: string;
}): Result<Record<string, unknown>, BrowserTransportError> {
  const scratch = openScratch();
  const session = openSession();
  const result = runLeasedOperation({
    deps,
    offLeaseReason: "this share read is bound to the Fathom origin the lease was taken with",
    operation: fathomShareOperation({ url }),
    scratch,
    session,
    url,
  });
  releaseSession({ deps, scratch, session });
  if (result.isErr()) {
    return err(result.error);
  }
  return decodeFathomShareOutput({ stdout: result.value });
}
