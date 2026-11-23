/**
 * Whether one tick of a `cmux reseat` read-back proves the relaunch came up — pure; the reads are
 * `../cli/commands/cmux/reseatRelaunch.ts`'s.
 *
 * ## The false positive this replaces
 *
 * The read-back used to accept ANY registry record carrying the session id under a pid it had not seen before, read
 * from the WHOLE registry, dead pids included. MEASURED: the relaunch typed
 * `--resume 68f60302-…` into a tab whose session had never taken a prompt, Claude registered the id, printed `No
 * conversation found` and exited — and the pass journalled `reseated`, then typed the worker nudge into zsh. So a
 * confirmation now needs all of: a LIVE record, whose pid sits in THIS tab's tree, a Claude composer on its screen,
 * and the session id the launch intended.
 */
import { type ComposerProbe, witnessedComposer } from "../cmux/composerProbe.js";
import type { ReseatLaunch } from "../cmux/reseatLine.js";
import type { SessionRecord } from "./liveSessions.js";

/** One tick's verdict. */
export type ReseatConfirmation =
  /** The intended session is live in this tab, under a new pid, at a Claude composer. */
  | { readonly kind: "resumed"; readonly sessionId: string; readonly pid: number }
  /** A fresh session is live in this tab, under a new pid and a new id, at a Claude composer. */
  | { readonly kind: "fresh"; readonly sessionId: string; readonly pid: number }
  /** A new missing-conversation line appeared since the launch was typed: the resume failed. */
  | { readonly kind: "missing-conversation" }
  /** Not yet, and why — the poll goes on. */
  | { readonly kind: "not-confirmed"; readonly reason: string };

/**
 * Judge one tick of the read-back.
 *
 * @param intended what the typed line launched: a resume of an id, or a fresh session
 * @param priorPids the pids that carried the session before the relaunch, never mistaken for it
 * @param inTab the registry records whose own process runs NOW inside this tab (`./liveInTab.ts`)
 * @param composer this tick's styled-grid read
 * @param missingConversationSeen whether the screen carries more missing-conversation lines than before the send
 * @returns the verdict
 */
export function judgeReseatConfirmation({
  intended,
  priorPids,
  inTab,
  composer,
  missingConversationSeen,
}: {
  intended: ReseatLaunch;
  priorPids: ReadonlySet<number>;
  inTab: readonly SessionRecord[];
  composer: ComposerProbe;
  missingConversationSeen: boolean;
}): ReseatConfirmation {
  if (missingConversationSeen) {
    return { kind: "missing-conversation" };
  }
  const record = inTab
    .filter((candidate) => !priorPids.has(candidate.pid))
    .find((candidate) => (intended.kind === "resume" ? candidate.sessionId === intended.sessionId : true));
  if (record === undefined) {
    return { kind: "not-confirmed", reason: "no new live session in this tab carries the intended id yet" };
  }
  if (witnessedComposer({ probe: composer }) === undefined) {
    return { kind: "not-confirmed", reason: "no Claude composer is on the surface yet" };
  }
  if (intended.kind === "resume") {
    return { kind: "resumed", pid: record.pid, sessionId: record.sessionId };
  }
  return { kind: "fresh", pid: record.pid, sessionId: record.sessionId };
}
