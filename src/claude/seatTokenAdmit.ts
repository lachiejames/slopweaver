/**
 * The one path a setup token takes from "captured" to "written into its plan's store": probe it, judge it
 * against the plan's standing enrollment, and write it only when the judge says it proved itself.
 *
 * Two verbs capture a token — `claude token` from a paste, `claude mint` off the screen of a login it drove —
 * and they must never disagree about what a token has to prove before it becomes a plan's credential. One
 * function for both is how they cannot: the proof lives in `seatToken.ts`'s `judgeSetupToken`, and this is
 * the only caller that turns its verdict into a write.
 *
 * The token goes into one probe request and one file, and nowhere else: no error variant here carries it.
 */
import { err, ok, type Result } from "#lib/result.js";

import { readAssertions } from "./assertionStore.js";
import type { ClaudeAccount } from "./contracts.js";
import { type ClaudeRotationError, ClaudeRotationErrors } from "./errors.js";
import { assertionFor } from "./identityAssertions.js";
import { type ProbeRequester, probeSetupToken } from "./probeStore.js";
import { judgeSetupToken, writeSetupToken } from "./seatToken.js";

/**
 * Probe, judge and write one plan's setup token.
 *
 * @param account the plan the token is offered for
 * @param home the Slopweaver home the plan's enrollment is read from
 * @param token a token `validateSetupToken` already accepted — never logged, never carried by an error
 * @param nowIso the instant the probe's reading is stamped with
 * @param request the probe's request seam, injected only by tests
 * @returns the judge's lines and the path written, or SETUP_TOKEN_UNPROVEN carrying why, or the write failure
 */
export async function admitSetupToken({
  account,
  home,
  nowIso,
  request,
  token,
}: {
  account: ClaudeAccount;
  home: string;
  nowIso: string;
  request?: ProbeRequester;
  token: string;
}): Promise<Result<{ readonly lines: readonly string[]; readonly path: string }, ClaudeRotationError>> {
  const probe = await probeSetupToken({
    alias: account.alias,
    nowIso,
    token,
    ...(request === undefined ? {} : { request }),
  });
  const assertion = assertionFor({ alias: account.alias, assertions: readAssertions({ home }) });
  const verdict = judgeSetupToken({ alias: account.alias, probe, ...(assertion === undefined ? {} : { assertion }) });
  if (!verdict.ok) {
    return err(ClaudeRotationErrors.setupTokenUnproven({ alias: account.alias, lines: verdict.lines }));
  }
  const written = writeSetupToken({ storeDir: account.storeDir, token });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ lines: verdict.lines, path: written.value });
}
