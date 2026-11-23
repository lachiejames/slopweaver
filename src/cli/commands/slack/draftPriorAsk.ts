/**
 * The re-ask hold at recording, under either identity: a draft that asks a question declares whether it was asked
 * before, a declared earlier ask is read live, and an ANSWERED one parks only with a change shown in pictures or a
 * reason the replies were no answer (`../../../outbound/slack/priorAsk.ts` holds the ruling and the judgement).
 *
 * Called by `./draftRecordRun.ts` and `./draftRecordBotRun.ts` after the reads that prove where the row lands and
 * BEFORE its own `--media` is stored, so a refused re-ask stores no bytes at all. The change's pictures are admitted
 * through `slack post --media`'s own admission and kept in the same private store, so the charts they approve are the
 * charts the card shows.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { AskedBeforeErrors } from "../../../outbound/slack/askedBeforeErrors.js";
import type { ParkedPriorAsk, ParkedSlackDraftMedia } from "../../../outbound/slack/draftRegister.js";
import {
  type AskedBeforeDeclaration,
  judgePriorAsk,
  parkedPriorAsk,
  priorAskRefusal,
  undeclaredAskRefusal,
} from "../../../outbound/slack/priorAsk.js";
import { ImageAdmissionRefused } from "../../../visualEvidence/admitUploads.js";
import { NOTHING_PARKED } from "./draftMedia.js";
import type { SlackDraftDeps } from "./draftRun.js";

/** What a refused proof admission is reported as — the command the owner would have typed. */
const RECORD_COMMAND = "slopweaver slack draft record --changed-media";

/**
 * Admit and store a declared change's pictures. At least one must be a PICTURE: a document proves nothing they can
 * look at on a card.
 *
 * @param deps the admission and store edges, the hatch environment and the clock
 * @param home the state home the store lives under
 * @param paths the `--changed-media` files, in the order given
 * @returns the stored entries, or why nothing may park
 */
async function storedProof({
  deps,
  home,
  paths,
}: {
  deps: Pick<SlackDraftDeps, "prepareMedia" | "storeMedia" | "doorEnv" | "nowIso">;
  home: string;
  paths: readonly string[];
}): Promise<Result<readonly ParkedSlackDraftMedia[]>> {
  if (paths.length === 0) {
    return ok([]);
  }
  const admitted = await deps.prepareMedia({ env: deps.doorEnv(), home, nowIso: deps.nowIso(), paths });
  if (admitted.isErr()) {
    return err([
      ...new ImageAdmissionRefused({ command: RECORD_COMMAND, error: admitted.error }).lines,
      NOTHING_PARKED,
    ]);
  }
  if (admitted.value.evidence.length === 0) {
    return err([AskedBeforeErrors.proofWithoutPicture().message, NOTHING_PARKED]);
  }
  const stored = deps.storeMedia({ home, uploads: admitted.value.uploads });
  if (stored.isErr()) {
    return err([stored.error.message, NOTHING_PARKED]);
  }
  return ok(stored.value);
}

/**
 * The row's `priorAsk`, or why the draft may not park: refused when it asks and declared nothing, or when its
 * declared earlier ask was answered and it shows neither a change nor why the replies were no answer.
 *
 * @param deps the injected world, for the earlier ask's read and the proof's admission and store
 * @param asked the words the draft asks in, or `undefined` when it asks nothing
 * @param declared what the recording declared
 * @param home the state home the proof is stored under
 * @param readSelfUserId the identity the draft goes out under, which the earlier ask must be by — asked only when
 *   a prior is declared, so a recording that declares none reads nothing it did not already
 * @param token the token the read goes out under — the asking identity's own
 * @returns the field (nothing for a draft that asks nothing and declared nothing), or the hold's lines
 */
export async function priorAskOfRecording({
  deps,
  asked,
  declared,
  home,
  readSelfUserId,
  token,
}: {
  deps: Pick<SlackDraftDeps, "readPriorAsk" | "prepareMedia" | "storeMedia" | "doorEnv" | "nowIso">;
  asked: string | undefined;
  declared: AskedBeforeDeclaration;
  home: string;
  readSelfUserId: () => Promise<string | undefined>;
  token: string;
}): Promise<Result<ParkedPriorAsk | undefined>> {
  const undeclared = undeclaredAskRefusal({ asked, declared });
  if (undeclared.length > 0) {
    return err([...undeclared, NOTHING_PARKED]);
  }
  if (declared === "undeclared" || declared.kind === "none") {
    return ok(parkedPriorAsk({ declared, judgement: undefined, proof: [] }));
  }
  const selfUserId = await readSelfUserId();
  if (selfUserId === undefined) {
    return err([AskedBeforeErrors.withoutSelf({ permalink: declared.permalink }).message, NOTHING_PARKED]);
  }
  const read = await deps.readPriorAsk({ permalink: declared.permalink, token });
  if (read.isErr()) {
    return err([read.error.message]);
  }
  const judgement = judgePriorAsk({ read: read.value, selfUserId });
  const refusal = priorAskRefusal({ declared, judgement });
  if (refusal.length > 0 || judgement.kind !== "read") {
    return err([...refusal, NOTHING_PARKED]);
  }
  const proof = await storedProof({ deps, home, paths: declared.changedMedia });
  return proof.map((stored) => parkedPriorAsk({ declared, judgement, proof: stored }));
}
