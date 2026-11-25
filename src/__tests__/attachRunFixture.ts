/**
 * The scripted transport, deps and temp files the `github attach` run tests share — plain functions only, no
 * `vi.fn`. {@link attachRunHarness} registers its own `beforeAll`/`afterEach`, so a test file calls it once at module
 * scope and every home and file it mints is removed after each test.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll } from "vitest";
import type { GithubAttachDeps } from "../cli/commands/github/attachDeps.js";
import type { SupervisorEvent } from "../events/event.js";
import type { AttachUploadStanding } from "../handover/attachUploadRuling.js";
import { ok, type Result } from "../lib/result.js";
import type { AttachFetch, AttachResponse } from "../outbound/github/attachClient.js";
import type { ImageTextError, RecognisedImageText } from "../visualEvidence/imageTextRecognition.js";
import {
  type AttachablePicture,
  consoleShotPicture,
  fileAttachableEvidence,
  renderAttachablePicture,
  servingReadBack,
} from "./attachEvidenceFixture.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "./doorLedgerFixture.js";

/** The upload receipt id every scripted run mints. */
export const RECEIPT_ID = "upl-00000000-0000-4000-8000-000000000001";

/** A pull request page as a signed-in visitor sees it, upload region and token included. */
export const SIGNED_IN_PAGE =
  '<meta name="user-login" content="octocat">' +
  '<file-attachment data-upload-repository-id="1226919613" data-upload-policy-url="/upload/policies/assets">' +
  '<input class="js-data-upload-policy-url-csrf" value="page-token"></file-attachment>';

const POLICY_BODY = JSON.stringify({
  asset: { href: "https://github.com/user-attachments/assets/uuid-1", id: 999, name: "shot.png" },
  asset_upload_authenticity_token: "finalize-token",
  asset_upload_url: "/upload/assets/999",
  form: { key: "k", policy: "p" },
  upload_url: "https://bucket.example",
});

/** GitHub's answer to a lapsed session: a perfectly valid page, served to an anonymous visitor. */
export const ANONYMOUS_PAGE: AttachResponse = { status: 200, text: () => Promise.resolve("<html></html>") };

/** The four replies of an upload that works: the page, the policy, the bucket, the finalise. */
export const HAPPY: readonly AttachResponse[] = [
  { status: 200, text: () => Promise.resolve(SIGNED_IN_PAGE) },
  { status: 201, text: () => Promise.resolve(POLICY_BODY) },
  { status: 204, text: () => Promise.resolve("") },
  { status: 200, text: () => Promise.resolve('{"id":999}') },
];

/** Everything one run wrote, so an assertion reads the real output rather than a spy. */
interface Captured {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly events: SupervisorEvent[];
  /** Every buffer the run asked the recogniser to read, in order. */
  readonly recognised: Uint8Array[];
}

/** What {@link AttachRunHarness.makeDeps} takes, every field optional. */
interface MakeDepsOptions {
  /** The path the test means to upload; the deps read the receipted bytes whatever it names. */
  filePath?: string;
  /** The receipted bytes the file holds, the rendered terminal shot when omitted. */
  picture?: AttachablePicture;
  replies?: readonly AttachResponse[];
  sessionCookies?: Awaited<ReturnType<GithubAttachDeps["loadCookies"]>>;
  /** What `status` reports the browser holds — the two halves are independent on purpose. */
  usable?: boolean;
  login?: string | undefined;
  /** Whether the home holds the picture's capture receipt and passed image record. */
  evidence?: boolean;
  /** What the recogniser reads off the picture's pixels: no lines when omitted. */
  pixelText?: Result<RecognisedImageText, ImageTextError>;
  /** The attach-upload standing: permitted when omitted, so a picture-check test reaches the checks. */
  attachUpload?: AttachUploadStanding;
}

/** Attach upload permitted by a recorded owner ruling, the standing every picture-check test runs behind. */
export const PERMITTED_ATTACH_UPLOAD: Extract<AttachUploadStanding, { kind: "permitted" }> = {
  by: {
    ruling: {
      anchor: "talk:p1",
      atIso: "2026-08-26T14:00:00.000Z",
      attachUpload: { verdict: "permitted" },
      decidedIso: "2026-08-26T14:00:00.000Z",
      kind: "ruling",
      ruling: "pictures may go up",
    },
    slug: "a-row",
  },
  kind: "permitted",
};

/** One file's harness: the deps factory, the temp-file maker, and the picture rendered once for it. */
export interface AttachRunHarness {
  readonly makeDeps: (options: MakeDepsOptions) => {
    readonly deps: GithubAttachDeps;
    readonly captured: Captured;
    readonly door: MemoryDoorLedger;
    readonly home: string;
  };
  readonly fixtureFile: (file: { name: string; bytes: number }) => string;
  readonly picture: () => AttachablePicture;
}

/** The deps one run gets: the scripted replies in order, the held bytes served back, every output captured. */
function scriptedDeps({
  attachUpload,
  captured,
  door,
  held,
  home,
  login,
  pixelText,
  replies,
  sessionCookies,
  usable,
}: {
  attachUpload: AttachUploadStanding;
  captured: Captured;
  door: MemoryDoorLedger;
  held: AttachablePicture;
  home: string;
  login: string | undefined;
  pixelText: Result<RecognisedImageText, ImageTextError>;
  replies: readonly AttachResponse[];
  sessionCookies: Awaited<ReturnType<GithubAttachDeps["loadCookies"]>>;
  usable: boolean;
}): GithubAttachDeps {
  let index = 0;
  const fetchImpl: AttachFetch = () => {
    const reply = replies[index]!;
    index += 1;
    return Promise.resolve(reply);
  };
  return {
    attachUploadStanding: () => attachUpload,
    doorLedger: door.port,
    fetchAsset: servingReadBack({ served: held.bytes }),
    fetchImpl,
    home: () => home,
    listSiblings: () => [],
    loadCookies: () => Promise.resolve(sessionCookies),
    newUploadReceiptId: () => RECEIPT_ID,
    nowIso: () => "2026-08-26T14:30:00.000Z",
    out: (line) => captured.out.push(line),
    publishEvent: ({ event }) => captured.events.push(event),
    readFileBytes: () => ok(held.bytes),
    recogniseImageText: ({ bytes }) => {
      captured.recognised.push(bytes);
      return pixelText;
    },
    textScanFor: () => ok(() => []),
    status: () =>
      Promise.resolve({
        detail: usable ? undefined : "your Chrome holds no usable github.com session",
        expiresAtIso: "2026-09-07T00:00:00.000Z",
        login,
        present: usable,
        sessionScoped: false,
        source: "your Chrome profile Default",
        usable,
      }),
    writeDiagnostic: (line) => captured.diagnostics.push(line),
  };
}

/**
 * Register the hooks and hand back the factories. `home` is a real temp directory rather than a made-up path,
 * because the door reads the profile from it; the door's decision lands in an in-memory ledger a test reads back.
 *
 * @returns the harness for one test file
 */
export function attachRunHarness(): AttachRunHarness {
  const fixtureDirs: string[] = [];
  let rendered: AttachablePicture | undefined;
  beforeAll(async () => {
    // A console-shot receipt: the one capture verb attach admits, so a run reaches the concern its test is about.
    rendered = consoleShotPicture({ picture: await renderAttachablePicture() });
  });
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
  const picture = (): AttachablePicture => rendered!;
  const makeDeps: AttachRunHarness["makeDeps"] = ({
    replies = [],
    sessionCookies = ok("user_session=v"),
    usable = true,
    login = "octocat",
    evidence = true,
    picture: held = picture(),
    pixelText = ok({ lines: [] }),
    attachUpload = PERMITTED_ATTACH_UPLOAD,
  }) => {
    const captured: Captured = { diagnostics: [], events: [], out: [], recognised: [] };
    const door = memoryDoorLedger();
    const home = mkdtempSync(join(tmpdir(), "slopweaver-attach-home-"));
    fixtureDirs.push(home);
    if (evidence) {
      fileAttachableEvidence({ home, picture: held });
    }
    const deps = scriptedDeps({
      attachUpload,
      captured,
      door,
      held,
      home,
      login,
      pixelText,
      replies,
      sessionCookies,
      usable,
    });
    return { captured, deps, door, home };
  };
  // A real file on disk, so `statSync` measures a genuine size rather than a stubbed one.
  const fixtureFile: AttachRunHarness["fixtureFile"] = ({ name, bytes }) => {
    const dir = mkdtempSync(join(tmpdir(), "slopweaver-attach-"));
    fixtureDirs.push(dir);
    const path = join(dir, name);
    writeFileSync(path, Buffer.alloc(bytes));
    return path;
  };
  return { fixtureFile, makeDeps, picture };
}
