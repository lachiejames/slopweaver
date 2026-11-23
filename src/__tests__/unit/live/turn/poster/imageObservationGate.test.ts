import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";

import type { ReviewedImage, ReviewVerdict } from "../../../../../admit/reviewVerdict.js";
import { answerDigestOf, liveTurnPoster, NO_MENTIONS } from "../../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { imageDigestOf } from "../../../../../visualEvidence/imageIo.js";
import { appendImageRecord, readImageRecords } from "../../../../../visualEvidence/store.js";
import { IMAGE_POLICY_VERSION, type ImageRecord } from "../../../../../visualEvidence/types.js";
import { memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import {
  CARD_CHROME,
  CHROME,
  CLEAN_VERDICT,
  DM_MENTION,
  judge,
  minimalAnswer,
  NO_ROW,
  POSTED,
  PROVENANCE,
  READY,
  REPLY,
  warnRefusal,
} from "./fixtures.js";
import { fakeTransport, home, type Recorded, usePosterHome } from "./harness.js";

usePosterHome();

describe("the image-observation gate, wired", () => {
  /** A real 2x2 PNG, written to a temp path so the answer's `images` name a file that exists. */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4AWP8z8DwnwEImBigAAAfFwICgH3ifwAAAABJRU5ErkJggg==",
    "base64",
  );

  /** The answer above, attaching one picture at `path`. */
  const answerWithImage = ({ path }: { path: string }): AnswerFormAnswer => ({ ...minimalAnswer(), images: [path] });

  /** One fit observation of that picture, which `over` turns into whatever the case is about. */
  const observation = ({ path, over = {} }: { path: string; over?: Partial<ReviewedImage> }): ReviewedImage => ({
    artifactDigest: imageDigestOf({ bytes: PNG }),
    contextRetained: true,
    legible: true,
    observedContent: "the 15d timeseries, query env:staging, y axis 0 to 40",
    path,
    targetState: "data",
    ...over,
  });

  /** A verdict bound to the image-bearing answer's real digest, carrying `imageObservations`. */
  const verdictFor = ({
    path,
    observations,
  }: {
    path: string;
    observations: readonly ReviewedImage[];
  }): ReviewVerdict => ({
    ...CLEAN_VERDICT,
    answerDigest: answerDigestOf({ answer: answerWithImage({ path }) }),
    imageObservations: observations,
  });

  const posterFor = ({ log, verdict }: { log: Recorded[]; verdict: ReviewVerdict }) =>
    liveTurnPoster({
      doorLedger: memoryDoorLedger().port,
      identityRoster: NO_ROW,
      askIdentity: DM_MENTION,
      chrome: CARD_CHROME,
      freshnessNote: undefined,
      home,
      judge,
      mentions: NO_MENTIONS,
      provenance: PROVENANCE,
      readiness: READY,
      transport: {
        ...fakeTransport({ log }),
        attachAssistantMedia: async () => {
          log.push({ method: "attachAssistantMedia" });
        },
        postAssistantMessage: async () => POSTED,
        readBackFileCount: async () => 1,
        uploadPrivately: async ({ upload }) => {
          log.push({ detail: upload.filename, method: "uploadPrivately" });
          return "F_POOL";
        },
      },
      turnChrome: CHROME,
      turnId: "turn-1",
      verdict,
    });

  const shotPath = () => {
    const path = join(home, "pool.png");
    writeFileSync(path, PNG);
    return path;
  };

  /** What `slopweaver browser image-record` would have written when the composer attached this picture. */
  const composerRecord = (): ImageRecord => ({
    artifact: { digest: imageDigestOf({ bytes: PNG }), heightPx: 2, widthPx: 2 },
    crop: { kind: "already-framed", reason: "a tiny test artifact has nothing to crop" },
    outcome: "passed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: true,
      observedAtIso: "2026-09-13T02:00:00.000Z",
      observedContent: "a flat block of colour",
      observerSession: "worker-session",
      targetState: "data",
    },
    receiptId: "img-composer",
    schemaVersion: 1,
  });

  it("REFUSES an attached picture the verdict never looked at, and touches the transport not at all", async () => {
    const log: Recorded[] = [];
    const path = shotPath();
    const poster = posterFor({ log, verdict: verdictFor({ observations: [], path }) });

    const refusal = await warnRefusal({
      offered: poster.postAnswer({
        answer: answerWithImage({ path }),
        askIdentity: DM_MENTION,
        documents: [],
        reply: REPLY,
        uploads: [{ bytes: Uint8Array.from(PNG), filename: "pool.png" }],
      }),
    });

    expect(refusal).toContain("ANSWER_IMAGE_OBSERVATION_MISSING");
    expect(log).toEqual([]);
  });

  it("RECORDS a picture the reviewer found unreadable, durably, BEFORE it refuses the send", async () => {
    // The whole owner ruling in one assertion: the refusal is not merely for this send. PR1's
    // `known-bad` arm now refuses these exact bytes through every upload lane, with no hatch, forever.
    const log: Recorded[] = [];
    const path = shotPath();
    const unfit = observation({ over: { legible: false, unfitReason: "illegible" }, path });
    const poster = posterFor({ log, verdict: verdictFor({ observations: [unfit], path }) });

    await expect(
      poster.postAnswer({
        answer: answerWithImage({ path }),
        askIdentity: DM_MENTION,
        documents: [],
        reply: REPLY,
        uploads: [{ bytes: Uint8Array.from(PNG), filename: "pool.png" }],
      }),
    ).rejects.toThrow("ANSWER_IMAGE_OBSERVATION_UNFIT");
    expect(log).toEqual([]);
    const records = unwrap(readImageRecords({ digest: imageDigestOf({ bytes: PNG }), home }));
    expect(records.length).toBe(1);
    expect(records[0]!.outcome).toBe("failed");
    expect(records[0]!.readBack.observerSession).toBe("reviewer-session");
  });

  it("sends the same answer once the COMPOSER recorded the picture and the verdict covers it", async () => {
    // Two records, not one, and neither substitutes for the other: PR1's is the composer saying it looked
    // before attaching, and the verdict's `imageObservations` is a second session saying so independently.
    // This is the send that proves the reviewer half does not loosen the composer half.
    const log: Recorded[] = [];
    const path = shotPath();
    unwrap(appendImageRecord({ home, record: composerRecord() }));
    const poster = posterFor({ log, verdict: verdictFor({ observations: [observation({ path })], path }) });

    const outcome = await poster.postAnswer({
      answer: answerWithImage({ path }),
      askIdentity: DM_MENTION,
      documents: [],
      reply: REPLY,
      uploads: [{ bytes: Uint8Array.from(PNG), filename: "pool.png" }],
    });

    expect(outcome.kind).toBe("posted");
    expect(log.map((entry) => entry.method)).toEqual(["uploadPrivately", "attachAssistantMedia"]);
    expect(unwrap(readImageRecords({ digest: imageDigestOf({ bytes: PNG }), home })).length).toBe(1);
  });

  it("REFUSES a picture the reviewer found unfit even though the composer had passed it", async () => {
    // The reviewer's look is the independent one. A composer's own `passed` record cannot release bytes a
    // second session opened and wrote down as unreadable — `admission.ts`'s ANY-failure rule sees to that.
    const log: Recorded[] = [];
    const path = shotPath();
    unwrap(appendImageRecord({ home, record: composerRecord() }));
    const unfit = observation({ over: { legible: false, unfitReason: "illegible" }, path });
    const poster = posterFor({ log, verdict: verdictFor({ observations: [unfit], path }) });

    await expect(
      poster.postAnswer({
        answer: answerWithImage({ path }),
        askIdentity: DM_MENTION,
        documents: [],
        reply: REPLY,
        uploads: [{ bytes: Uint8Array.from(PNG), filename: "pool.png" }],
      }),
    ).rejects.toThrow("ANSWER_IMAGE_OBSERVATION_UNFIT");
    expect(log).toEqual([]);
    const outcomes = unwrap(readImageRecords({ digest: imageDigestOf({ bytes: PNG }), home })).map(
      (record) => record.outcome,
    );
    expect(outcomes).toEqual(["passed", "failed"]);
  });
});
