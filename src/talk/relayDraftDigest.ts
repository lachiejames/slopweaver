/**
 * A relay draft's DIGEST — what a second relay of the same turn is compared against, so a replay can never land the
 * owner's words beside another picture, ruling, workspace, offer, card list or cut than the first relay named. Split
 * from `relayDraft.ts`, which forms the draft; this module only decides what the draft binds.
 */
import { createHash } from "node:crypto";

import type { StatedWorkspace } from "../handover/workspace.js";
import type { DiscussFirstRecord } from "./discussFirst.js";
import { type RelayOffer, relayOfferDigestLine } from "./relayOffer.js";
import type { RelayPicture } from "./relayPicture.js";
import type { TriageRuling } from "./triageVocabulary.js";

/** The candidate a relay rules on and the owner's word on it, as the digest binds them. */
export interface RelayCandidateVerdict {
  readonly candidate: string;
  readonly reaction: string;
}

/**
 * What a draft binds beside its words and picture: the candidate ruling, the workspace and the copy-tray offer its
 * digest carries, and the triage ruling its ask carries.
 */
export interface DigestBound {
  readonly alsoAnswers: readonly string[];
  readonly candidateVerdict: RelayCandidateVerdict | undefined;
  readonly discussFirst: DiscussFirstRecord | undefined;
  readonly heardTailCut: boolean | undefined;
  readonly offered: RelayOffer | undefined;
  readonly triageRuling: TriageRuling | undefined;
  readonly workspace: StatedWorkspace | undefined;
}

/**
 * A draft's digest: its ask, what it binds of its picture and the candidate ruling it carries, so a second relay
 * of the same turn compares all three. A relay carrying no ruling digests exactly as one did before rulings rode
 * it, so a replay of a turn recorded then still matches. Bound because the ruling's write can fail after the
 * turn is claimed (a busy register) and leave no row behind: without it a replay naming another candidate would
 * find nothing to refuse and write that one instead. The workspace the page stated is bound
 * for the same reason: a turn claimed and then lost before its row was registered must not register under another
 * one on replay. A relay stating none digests exactly as one did before. So with the copy-tray offer: a
 * retry carrying another offer, or none, must conflict rather than register the owner's words beside text they never
 * reacted to, and a relay carrying none digests as one did before offers rode it.
 *
 * @param wholeHeard every word the owner said, when the ask quotes fewer of them; `undefined` when the ask has them all
 * @returns the sha256 hex digest
 */
export function draftDigest({
  ask,
  picture,
  bound: { alsoAnswers, candidateVerdict, discussFirst, heardTailCut, offered, workspace },
  wholeHeard,
}: {
  ask: string;
  picture: RelayPicture;
  bound: DigestBound;
  wholeHeard: string | undefined;
}): string {
  let bound = `${ask}\n${pictureKeyOf({ picture })}`;
  if (candidateVerdict !== undefined) {
    bound += `\ncandidate:${candidateVerdict.candidate}:${candidateVerdict.reaction}`;
  }
  if (wholeHeard !== undefined) {
    bound += `\nheard:${createHash("sha256").update(wholeHeard, "utf8").digest("hex")}`;
  }
  if (workspace !== undefined) {
    bound += `\nworkspace:${workspace.workspace}:${workspace.because}`;
  }
  bound += relayOfferDigestLine({ offered });
  // A replay must not turn a held fix into a go-ahead, or move it to another repository or thread.
  if (discussFirst !== undefined) {
    const prior = discussFirst.status === "override" ? discussFirst.priorTurnId : "";
    bound += `\ndiscuss-first:${discussFirst.status}:${discussFirst.repository}:${String(discussFirst.thread)}:${prior}`;
  }
  // A replay must not land the owner's words on other cards than the first relay of the turn named. In order: the page
  // names a unique ordered list, so sorting would hide a changed request rather than expose it. None digests as before.
  if (alsoAnswers.length > 0) {
    bound += `\nalso-answers:${alsoAnswers.join("\0")}`;
  }
  // A replay must not turn words cut short into whole ones, nor the reverse. Unstated digests as before.
  if (heardTailCut !== undefined) {
    bound += `\nheard-tail:${heardTailCut ? "cut" : "whole"}`;
  }
  return createHash("sha256").update(bound, "utf8").digest("hex");
}

/** What a draft's digest binds of its picture: the image's own hash, or the reason there is none. */
function pictureKeyOf({ picture }: { picture: RelayPicture }): string {
  if (picture.kind === "attached") {
    return `picture:${picture.sha256}`;
  }
  return `picture:none:${picture.reason}`;
}
