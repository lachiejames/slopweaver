/**
 * The control plane's answer to a `session.origin` claim: whether a `slopweaver` verb runs inside the hosted session
 * it names. Pure: the registry and the claim in, the session or the refusal out.
 *
 * A claim is matched only when the named session is reachable, is the claimed vendor's, and the vendor session id the
 * control plane holds for it (from its worker's `ready` report, `sessionRegistry.ts`) is present and exactly the one
 * claimed. Every refusal is one code and never says which vendor id the control plane holds, so a wrong guess learns
 * nothing about the right one.
 *
 * Residue, stated: this is a same-user local control plane. A process that rewrites both its app session id and its
 * vendor session id to another session's can impersonate that session once it has learned both, because the
 * owner-only socket is not a per-session authentication boundary. What the check does stop is an ordinary sibling
 * session substituting only another session's app id: its own vendor id, which its host set, will not match.
 */
import { err, ok, type Result } from "neverthrow";

import type { AppSessionSnapshot } from "./sessionControlProtocol";
import type { SessionRegistry } from "./sessionRegistryShape";
import type { AppHarnessVendor, AppSessionState } from "./wireBasics";

/** The states a claim can match: a closed, failed or stopping session runs nothing a verb could be called from. */
const REACHABLE: ReadonlySet<AppSessionState> = new Set(["starting", "idle", "running"]);

/** Why a claim was not matched: one code, and a line that never carries the vendor id the control plane holds. */
export interface SessionOriginRefusal {
  readonly code: "ORIGIN_REFUSED";
  readonly message: string;
}

/**
 * Match one `session.origin` claim against the hosted sessions.
 *
 * @param registry the sessions this app hosts
 * @param appSessionId the control plane id the caller's environment named
 * @param vendor the vendor the caller's own host is
 * @param vendorSessionId the vendor session id the caller's own host set
 * @returns the claimed session's snapshot, or the refusal
 */
export function sessionOriginOf({
  registry,
  appSessionId,
  vendor,
  vendorSessionId,
}: {
  registry: SessionRegistry;
  appSessionId: string;
  vendor: AppHarnessVendor;
  vendorSessionId: string;
}): Result<AppSessionSnapshot, SessionOriginRefusal> {
  const entry = registry.get(appSessionId);
  if (entry === undefined || !REACHABLE.has(entry.snapshot.state)) {
    return err({ code: "ORIGIN_REFUSED", message: `no reachable app session ${appSessionId}` });
  }
  if (entry.snapshot.vendor !== vendor) {
    return err({
      code: "ORIGIN_REFUSED",
      message: `app session ${appSessionId} is a ${entry.snapshot.vendor} session, not a ${vendor} one`,
    });
  }
  if (entry.vendorSessionId === undefined) {
    return err({
      code: "ORIGIN_REFUSED",
      message: `app session ${appSessionId} has not reported its vendor session yet, so no claim on it can be matched`,
    });
  }
  if (entry.vendorSessionId !== vendorSessionId) {
    return err({
      code: "ORIGIN_REFUSED",
      message: `app session ${appSessionId} does not run the vendor session this caller is in`,
    });
  }
  return ok(entry.snapshot);
}
