/**
 * An attachable picture for `github attach` tests: real terminal-shot bytes, the capture receipt the verb files for
 * them, and the passed image record a session writes after looking — filed into an explicit home, never the
 * ambient one. Plus the read-back transports a test scripts GitHub's answer with: plain functions, no mocks.
 */

import { unwrap } from "../lib/result.js";
import type { AttachAssetFetch, AttachAssetResponse } from "../outbound/github/attachReadBack.js";
import { cassetteReceiptOf } from "../proof/cassette/receipt.js";
import { type CaptureReceipt, writeCaptureRecord } from "../visualEvidence/captureRecord.js";
import { appendImageRecord } from "../visualEvidence/store.js";
import { renderTerminalShot } from "../visualEvidence/terminalShot.js";
import { IMAGE_POLICY_VERSION, type ImageRecord } from "../visualEvidence/types.js";

/** The terminal text the fixture draws; lines 2-3 are kept, so the crop is strictly smaller than the screen. */
const FIXTURE_SCREEN = "$ yarn test\n PASS  unit/a.test.ts\nTests  12 passed\n$ ";

/** A rendered picture and the receipt that names it. */
export interface AttachablePicture {
  readonly bytes: Uint8Array;
  readonly receipt: CaptureReceipt;
}

/**
 * Render the fixture's terminal shot. Async and pure: call once per file, then {@link fileAttachableEvidence} per home.
 *
 * @param text the terminal text to draw, the fixture screen when omitted
 * @returns the picture and its receipt
 */
export async function renderAttachablePicture({
  text = FIXTURE_SCREEN,
}: { text?: string } = {}): Promise<AttachablePicture> {
  const shot = unwrap(
    await renderTerminalShot({
      capturedAtIso: "2026-11-17T01:00:00.000Z",
      label: "acme test pane",
      out: "/tmp/terminal.png",
      range: { from: 2, to: 3 },
      text,
    }),
  );
  return { bytes: shot.bytes, receipt: shot.receipt };
}

/**
 * A recording `proof cassette` wrote: stand-in video bytes and the receipt the verb files for them, its frame text
 * read from a transcript. The bytes are not a real MP4 — nothing on the attach path decodes a video, it digests one.
 *
 * @param transcript the transcript the recorder wrote, a passing test run when omitted
 * @returns the recording and its receipt
 */
export function recordedCassette({ transcript = FIXTURE_SCREEN }: { transcript?: string } = {}): AttachablePicture {
  const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const receipt = cassetteReceiptOf({
    bytes,
    capturedAtIso: "2026-11-17T01:00:00.000Z",
    frame: { heightPx: 600, widthPx: 1200 },
    out: "/tmp/demo.mp4",
    tape: "/tmp/demo.tape",
    tapeSource: 'Type "yarn test"\nEnter',
    transcript,
    transcriptPath: "/tmp/demo.mp4.txt",
  });
  return { bytes, receipt };
}

/**
 * The passed image record a session writes after opening the picture.
 *
 * @param picture the picture looked at
 * @returns the record, naming the capture it came out of
 */
export function passedRecordFor({ picture }: { picture: AttachablePicture }): ImageRecord {
  return {
    artifact: picture.receipt.final.artifact,
    captureId: picture.receipt.captureId,
    crop: { kind: "already-framed", reason: "rendered from the kept lines only" },
    obstruction: "none",
    outcome: "passed",
    policyVersion: IMAGE_POLICY_VERSION,
    readBack: {
      contextRetained: true,
      observedAtIso: "2026-11-17T01:05:00.000Z",
      observedContent: "a terminal showing one passing test file and 12 passing tests",
      observerSession: "unit-test",
      targetState: "data",
    },
    receiptId: "rec-attachable",
    schemaVersion: 1,
  };
}

/**
 * File the picture's capture receipt and, unless told not to, its passed image record under a home.
 *
 * @param home the explicit test home
 * @param picture the picture to file
 * @param viewed whether a session has recorded looking at it
 */
export function fileAttachableEvidence({
  home,
  picture,
  viewed = true,
}: {
  home: string;
  picture: AttachablePicture;
  viewed?: boolean;
}): void {
  unwrap(writeCaptureRecord({ home, record: picture.receipt }));
  if (viewed) {
    unwrap(appendImageRecord({ home, record: passedRecordFor({ picture }) }));
  }
}

/** The signed attachment-host address a scripted redirect points at; the token is a fixture. */
export const SIGNED_ASSET_URL = "https://private-user-images.githubusercontent.com/1/asset.png?jwt=FIXTURE";

/**
 * GitHub's answer to a read-back, scripted: a redirect from the asset address to a signed attachment host, then the
 * bytes. Every request is pushed onto `seen`, so a test reads which hop carried the cookie.
 *
 * @param served the bytes the second hop serves
 * @param seen where each request is recorded
 * @returns the read-back transport
 */
export function servingReadBack({
  served,
  seen = [],
}: {
  served: Uint8Array;
  seen?: { url: string; cookieHeader: string | undefined }[];
}): AttachAssetFetch {
  return ({ url, cookieHeader }) => {
    seen.push({ cookieHeader, url });
    const response: AttachAssetResponse =
      url === SIGNED_ASSET_URL
        ? { bytes: () => Promise.resolve(served), location: null, status: 200 }
        : { bytes: () => Promise.resolve(new Uint8Array(0)), location: SIGNED_ASSET_URL, status: 302 };
    return Promise.resolve(response);
  };
}
