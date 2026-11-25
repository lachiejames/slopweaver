import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GithubAttachDeps } from "../../../../../cli/commands/github/attachDeps.js";
import { runGithubAttach } from "../../../../../cli/commands/github/attachRun.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import type { SupervisorEvent } from "../../../../../events/event.js";
import { ok } from "../../../../../lib/result.js";
import type { AttachFetch, AttachResponse } from "../../../../../outbound/github/attachClient.js";
import {
  type AttachablePicture,
  consoleShotPicture,
  fileAttachableEvidence,
  renderAttachablePicture,
  servingReadBack,
} from "../../../../attachEvidenceFixture.js";
import { PERMITTED_ATTACH_UPLOAD } from "../../../../attachRunFixture.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { gifWithFrames } from "../../../../gifFixtures.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

// Real picture bytes under a console-shot receipt, the one verb attach admits, whose receipt and passed record every
// home holds, so a case that should upload can.
let PICTURE: AttachablePicture;

beforeAll(async () => {
  PICTURE = consoleShotPicture({ picture: await renderAttachablePicture() });
});

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const SIGNED_IN_PAGE =
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

const HAPPY: readonly AttachResponse[] = [
  { status: 200, text: () => Promise.resolve(SIGNED_IN_PAGE) },
  { status: 201, text: () => Promise.resolve(POLICY_BODY) },
  { status: 204, text: () => Promise.resolve("") },
  { status: 200, text: () => Promise.resolve('{"id":999}') },
];

/** The measured matplotlib `tEXt Software` stamp, at the byte offset `savefig` writes it to. */
const MATPLOTLIB_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("\u0000\u0000\u0000\rIHDR", "latin1"),
  Buffer.from("\u0000".repeat(21), "latin1"),
  Buffer.from("tEXtSoftware\u0000Matplotlib version3.9.4, https://matplotlib.org/", "latin1"),
]);

/** Everything one run wrote, so an assertion reads the real output rather than a spy. */
interface Captured {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly events: SupervisorEvent[];
}

/** The incident's scratchpad, rebuilt: a rendered page, and the shot that was taken of it. */
function scratchpadWith({ shot, bytes }: { shot: string; bytes: Buffer }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-invented-"));
  fixtureDirs.push(dir);
  writeFileSync(join(dir, "before.html"), "<html><title>Vanta vulnerabilities</title></html>");
  const path = join(dir, shot);
  writeFileSync(path, bytes);
  return path;
}

/** A directory holding only real captures — nothing rendered here. */
function capturesWith({ shot, bytes }: { shot: string; bytes: Buffer }): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-captures-"));
  fixtureDirs.push(dir);
  const path = join(dir, shot);
  writeFileSync(path, bytes);
  return path;
}

/** Real filesystem edges plus a scripted transport — plain functions only, no `vi.fn`. */
function makeDeps(): {
  readonly deps: GithubAttachDeps;
  readonly captured: Captured;
  readonly door: MemoryDoorLedger;
  readonly home: string;
} {
  const captured: Captured = { diagnostics: [], events: [], out: [] };
  const door = memoryDoorLedger();
  const home = mkdtempSync(join(tmpdir(), "slopweaver-invented-home-"));
  fixtureDirs.push(home);
  fileAttachableEvidence({ home, picture: PICTURE });
  let index = 0;
  const fetchImpl: AttachFetch = () => {
    const reply = HAPPY[index]!;
    index += 1;
    return Promise.resolve(reply);
  };
  return {
    captured,
    deps: {
      attachUploadStanding: () => PERMITTED_ATTACH_UPLOAD,
      doorLedger: door.port,
      fetchAsset: servingReadBack({ served: PICTURE.bytes }),
      fetchImpl,
      home: () => home,
      listSiblings: ({ path }) => readdirSync(dirname(path)).filter((name) => name !== basename(path)),
      loadCookies: () => Promise.resolve(ok("user_session=v")),
      newUploadReceiptId: () => "upl-00000000-0000-4000-8000-000000000002",
      nowIso: () => "2026-09-06T14:30:00.000Z",
      recogniseImageText: () => ok({ lines: [] }),
      textScanFor: () => ok(() => []),
      out: (line) => captured.out.push(line),
      publishEvent: ({ event }) => captured.events.push(event),
      readFileBytes: ({ path }) => ok(readFileSync(path)),
      status: () =>
        Promise.resolve({
          detail: undefined,
          expiresAtIso: "2026-09-07T00:00:00.000Z",
          login: "octocat",
          present: true,
          sessionScoped: false,
          source: "your Chrome profile Default",
          usable: true,
        }),
      writeDiagnostic: (line) => captured.diagnostics.push(line),
    },
    door,
    home,
  };
}

const argvFor = ({ path, extra = [] }: { path: string; extra?: readonly string[] }): readonly string[] => [
  "upload",
  "--file",
  path,
  "--repo",
  "slopweaver/slopweaver",
  "--number",
  "485",
  "--proves",
  "the monitor panel shows the alert firing",
  ...extra,
];

/** The door's own ledger, read back as one line per recorded decision. */
function ledgerLines({ door }: { door: MemoryDoorLedger }): readonly string[] {
  return door.text().trim().split("\n");
}

describe("github attach upload — the invented-visual gate", () => {
  it("refuses the shot the incident took, and uploads nothing", async () => {
    const path = scratchpadWith({ bytes: Buffer.alloc(4), shot: "01-before.jpg" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.out).toStrictEqual([]);
    expect(captured.diagnostics.some((line) => line.includes("[INVENTED_VISUAL_RENDERED_PAGE_SIBLING]"))).toBe(true);
  });

  it("names the way back rather than only what is wrong", async () => {
    const path = scratchpadWith({ bytes: Buffer.alloc(4), shot: "01-before.jpg" });
    const { captured, deps } = makeDeps();
    await runGithubAttach({ deps, rest: argvFor({ path }) });
    expect(
      captured.diagnostics.some((line) =>
        line.includes("capture the provider's OWN surface through the doored browser route"),
      ),
    ).toBe(true);
  });

  it("refuses a matplotlib chart on its own bytes, with no rendered page anywhere near it", async () => {
    const path = capturesWith({ bytes: MATPLOTLIB_PNG, shot: "backtest.png" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.some((line) => line.includes("[INVENTED_VISUAL_GENERATED_CHART]"))).toBe(true);
  });

  it("uploads a real capture from a directory holding no rendered page", async () => {
    const path = capturesWith({ bytes: Buffer.from(PICTURE.bytes), shot: "monitor-panel.png" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_OK);
    expect(captured.out[1]).toBe("https://github.com/user-attachments/assets/uuid-1");
  });

  it("uploads the refused shot once acknowledged, and records the waiver in the door ledger", async () => {
    const path = scratchpadWith({ bytes: Buffer.from(PICTURE.bytes), shot: "01-before.png" });
    const { captured, deps, door } = makeDeps();
    const rest = argvFor({
      extra: ["--acknowledge", "vanta has no doorless surface to capture"],
      path,
    });
    expect(await runGithubAttach({ deps, rest })).toBe(EXIT_OK);
    expect(captured.out[1]).toBe("https://github.com/user-attachments/assets/uuid-1");
    const recorded = ledgerLines({ door }).at(-1)!;
    expect(recorded).toContain("INVENTED_VISUAL_RENDERED_PAGE_SIBLING");
    expect(recorded).toContain('"status":"pass"');
  });

  it("prints the acknowledgement's reason where the person taking the decision reads it", async () => {
    const path = scratchpadWith({ bytes: Buffer.from(PICTURE.bytes), shot: "01-before.png" });
    const { captured, deps } = makeDeps();
    await runGithubAttach({
      deps,
      rest: argvFor({ extra: ["--acknowledge", "vanta has no doorless surface to capture"], path }),
    });
    expect(captured.diagnostics[0]).toBe(
      "INVENTED_VISUAL_RENDERED_PAGE_SIBLING waived: vanta has no doorless surface to capture",
    );
  });

  it("refuses a bare acknowledgement at parse time, before any file is even read", async () => {
    const path = scratchpadWith({ bytes: Buffer.alloc(4), shot: "01-before.jpg" });
    const { captured, deps } = makeDeps();
    await runGithubAttach({ deps, rest: argvFor({ extra: ["--acknowledge", "yes"], path }) });
    expect(captured.diagnostics[0]).toContain("--acknowledge needs the REASON");
  });

  it("reports the finding in --dry-run, fully offline, before a session is looked for", async () => {
    const path = scratchpadWith({ bytes: Buffer.alloc(4), shot: "01-before.jpg" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ extra: ["--dry-run"], path }) })).toBe(EXIT_OK);
    expect(captured.out.some((line) => line.includes("[INVENTED_VISUAL_RENDERED_PAGE_SIBLING]"))).toBe(true);
  });
});

describe("github attach upload — the animated-GIF gate", () => {
  it("refuses a looping cassette GIF, uploads nothing, and names the video route", async () => {
    const path = capturesWith({ bytes: gifWithFrames({ frames: 3, loop: true }), shot: "cassette.gif" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.out).toStrictEqual([]);
    expect(captured.diagnostics.some((line) => line.includes("[ANIMATED_GIF]"))).toBe(true);
    expect(captured.diagnostics.some((line) => line.includes("slopweaver browser console-shot"))).toBe(true);
  });

  it("refuses a still GIF, which no capture verb writes, so no receipt can describe it", async () => {
    const path = capturesWith({ bytes: gifWithFrames({ frames: 1 }), shot: "still.gif" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.out).toStrictEqual([]);
    expect(captured.diagnostics.some((line) => line.includes("the upload would be declared image/gif"))).toBe(true);
  });

  it("waives the GIF finding when acknowledged, and still refuses on the receipt check no reason can waive", async () => {
    const path = capturesWith({ bytes: gifWithFrames({ frames: 2 }), shot: "spinner.gif" });
    const { captured, deps, door } = makeDeps();
    const rest = argvFor({ extra: ["--acknowledge", "the spinner loop is the whole claim"], path });
    expect(await runGithubAttach({ deps, rest })).toBe(EXIT_ERROR);
    expect(captured.out).toStrictEqual([]);
    const recorded = ledgerLines({ door }).at(-1)!;
    expect(recorded).toContain("attach.capture-receipt");
    expect(recorded).toContain('"status":"hold"');
  });

  it("reports the finding in --dry-run, before a session is looked for", async () => {
    const path = capturesWith({ bytes: gifWithFrames({ frames: 2 }), shot: "cassette.gif" });
    const { captured, deps } = makeDeps();
    expect(await runGithubAttach({ deps, rest: argvFor({ extra: ["--dry-run"], path }) })).toBe(EXIT_OK);
    expect(captured.out.some((line) => line.includes("[ANIMATED_GIF]"))).toBe(true);
  });
});
