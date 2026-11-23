/**
 * Parking a candidate's owed conversation on the owner's Queue — the effectful half of `./loopIn.ts`.
 *
 * The check and the park run under one lock per candidate and person, so two presses racing cannot both find nothing
 * held and both park; the precedent is `../cli/commands/github/reviewerAsk.ts`. The park itself is injected: the CLI
 * wires `slack draft record`'s own path, so every as-me gate runs and NOTHING IS SENT.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { ReceiptsDeclaration } from "../outbound/slack/draftReceipts.js";
import type { SlackDraftItem } from "../outbound/slack/draftRegister.js";

import { readCandidateCatalog } from "./candidateStore.js";
import { type LoopInDraftState, loopInDraftOf, loopInOpenerOf, loopInWhyOf } from "./loopIn.js";
import { type LoopInError, LoopInErrors } from "./loopInErrors.js";

/** A parked draft: its id on the Queue. */
export interface ParkedLoopIn {
  readonly draftId: string;
}

/** What parking a loop-in touches outside itself. */
export interface LoopInDeps {
  /** The draft register, folded. */
  readonly drafts: (args: { home: string }) => readonly SlackDraftItem[];
  /** Park one draft through `slack draft record`'s path, as the owner, nothing sent. */
  readonly park: (args: {
    home: string;
    channel: string;
    form: string;
    why: string;
    /** What the opener declares about its receipts ({@link loopInOpenerOf}). */
    receipts: ReceiptsDeclaration;
  }) => Promise<Result<ParkedLoopIn, LoopInError>>;
  /** Hold the lock one candidate-and-person's park runs under; `err` says who holds it. */
  readonly lock: (args: {
    home: string;
    key: string;
    nowIso: string;
  }) => Result<{ readonly release: () => void }, string>;
  readonly now: () => string;
}

/** What one `parkLoopIn` call did. */
export interface LoopInReceipt {
  readonly candidate: string;
  readonly person: string;
  readonly draftId: string;
  /** `held` or `released` when a draft already stood, so nothing new was parked; `parked` when this call parked it. */
  readonly state: Exclude<LoopInDraftState, "none"> | "parked";
}

/**
 * Park the conversation a candidate owes one person, or name the draft already held or sent for it.
 *
 * @param candidateId the candidate whose `loopIn` names the person
 * @param person the person's Slack member id
 * @returns what stands on the Queue, or why nothing parked
 */
export async function parkLoopIn({
  deps,
  home,
  candidateId,
  person,
}: {
  deps: LoopInDeps;
  home: string;
  candidateId: string;
  person: string;
}): Promise<Result<LoopInReceipt, LoopInError>> {
  const catalog = readCandidateCatalog({ home });
  if (catalog.isErr()) {
    return err(LoopInErrors.candidates({ cause: catalog.error }));
  }
  const candidate = catalog.value.candidates.find((one) => one.id === candidateId);
  if (candidate === undefined) {
    return err(LoopInErrors.notOwed({ candidate: candidateId, person, why: `no candidate has the id ${candidateId}` }));
  }
  const owed = candidate.loopIn.find((one) => one.slack === person);
  if (owed === undefined) {
    const named = candidate.loopIn.map((one) => one.slack).join(", ");
    const why =
      named.length === 0
        ? `${candidateId} names nobody to loop in`
        : `${candidateId} does not name ${person} to loop in; it names ${named}`;
    return err(LoopInErrors.notOwed({ candidate: candidateId, person, why }));
  }
  const lock = deps.lock({ home, key: `workstream-loop-in|${candidateId}|${person}`, nowIso: deps.now() });
  if (lock.isErr()) {
    return err(LoopInErrors.locked({ holder: lock.error }));
  }
  try {
    const why = loopInWhyOf({ candidateId, candidateName: candidate.name, name: owed.name, person });
    const standing = loopInDraftOf({ items: deps.drafts({ home }), why });
    if (standing.draftId !== null && standing.state !== "none") {
      return ok({ candidate: candidateId, draftId: standing.draftId, person, state: standing.state });
    }
    const { form, receipts } = loopInOpenerOf({ candidateId, evidence: candidate.evidence, opener: owed.opener });
    const parked = await deps.park({
      channel: person,
      form,
      home,
      receipts,
      why,
    });
    return parked.map((one) => ({ candidate: candidateId, draftId: one.draftId, person, state: "parked" as const }));
  } finally {
    lock.value.release();
  }
}
