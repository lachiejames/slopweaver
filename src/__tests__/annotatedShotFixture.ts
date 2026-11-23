/**
 * A real annotated screenshot under a throwaway home: a 2x2 PNG kept in the private draft media store, and the image
 * record `browser image-record` would write for it, vouching for one box and nothing covering it — the receipt a first
 * message in a channel owes (`../outbound/slack/firstMessageProof.ts`). Written through the real stores, so a test of
 * a seam that reads them (`../cli/commands/slack/draftMediaEvidence.ts`) reads exactly what production reads.
 */
import { storeSlackDraftMedia } from "../admit/slackDraftMediaStore.js";
import { unwrap } from "../lib/result.js";
import type { ParkedSlackDraftMedia } from "../outbound/slack/draftRegister.js";
import { imageDigestOf } from "../visualEvidence/imageIo.js";
import { appendImageRecord } from "../visualEvidence/store.js";
import { IMAGE_POLICY_VERSION, type ImageFailureReason, type ImageRecord } from "../visualEvidence/types.js";

/** A 2x2 PNG, encoded here rather than fixtured so every read is over real bytes. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
  "base64",
);

/** The note the fixture's one box carries. */
export const SHOT_NOTE = "the failing control";

/**
 * A passed record for those bytes, annotated and unobstructed unless `over` says otherwise.
 *
 * @param digest the `sha256:` digest the record is filed under
 * @param over fields replacing the default record's
 * @returns the record
 */
export function annotatedRecord({
  digest,
  over = {},
}: {
  digest: string;
  over?: Partial<Extract<ImageRecord, { outcome: "passed" }>>;
}): ImageRecord {
  return {
    annotations: [{ note: SHOT_NOTE, rect: { height: 1, width: 1, x: 0, y: 0 } }],
    artifact: { digest, heightPx: 2, widthPx: 2 },
    crop: { kind: "already-framed", reason: "a 2x2 test artifact has nothing to crop" },
    obstruction: "none",
    outcome: "passed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: true,
      observedAtIso: "2026-10-21T01:00:00.000Z",
      observedContent: "four pixels, the top-left one boxed",
      observerSession: "unit-test",
      targetState: "data",
    },
    receiptId: "rec-1",
    schemaVersion: 1,
    ...over,
  };
}

/**
 * A failed record for those bytes — a later look that found them unfit, which is terminal for them.
 *
 * @param digest the `sha256:` digest the record is filed under
 * @param reason why the look failed them
 * @param correction what the recorder must do instead
 * @returns the record
 */
export function failedRecord({
  correction,
  digest,
  reason,
}: {
  correction: string;
  digest: string;
  reason: ImageFailureReason;
}): ImageRecord {
  const { artifact, crop, policyVersion, readBack, receiptId, schemaVersion } = annotatedRecord({ digest });
  return { artifact, correction, crop, outcome: "failed", policyVersion, readBack, reason, receiptId, schemaVersion };
}

/**
 * Keep the PNG in `home`'s draft media store and file each record for it, oldest first.
 *
 * @param home the throwaway state home
 * @param records the records to file, each built from the PNG's digest; one annotated pass when omitted
 * @returns the row entry naming the stored bytes
 */
export function storeAnnotatedShot({
  home,
  records = ({ digest }) => [annotatedRecord({ digest })],
}: {
  home: string;
  records?: (args: { digest: string }) => readonly ImageRecord[];
}): ParkedSlackDraftMedia {
  const [entry] = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: TINY_PNG, filename: "control.png" }] }));
  for (const record of records({ digest: imageDigestOf({ bytes: TINY_PNG }) })) {
    unwrap(appendImageRecord({ home, record }));
  }
  return entry!;
}
