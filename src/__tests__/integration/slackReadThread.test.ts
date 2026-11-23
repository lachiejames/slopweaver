/**
 * INTEGRATION test: `slack read-thread` against the REAL Slack Web API, recorded + replayed via a Polly
 * cassette (see `setup-polly.ts` + `cassetteRedact.ts`).
 *
 * Every case here is one that a GOLD RUN caught and the unit suite did not. That is the whole reason the
 * file exists: each of these shipped green through six Codex passes, ~2,900 unit tests and CI, and was
 * still broken against a real thread. Replaying the real payloads is what stops them coming back.
 *
 *   - the thread PARENT is repeated as `messages[0]` of EVERY page, so a >200-reply thread must not be
 *     mistaken for a corrupt one (this made every large thread return nothing at all);
 *   - a deleted attachment arrives as `{id, mode:"tombstone"}` and must be reported as DELETED, not as an
 *     unreadable media type;
 *   - a Slack canvas must be skipped rather than downloaded (Slack serves an HTML sign-in page for its
 *     bytes, which failed the whole read);
 *   - a file referenced only from Block Kit (`slack_file:{id}`) must be RESOLVED through `files.info`, and
 *     when that fails the output must carry the provider's own reason rather than a guess at one.
 *
 * ## What is NOT here, and why
 *
 * The MULTI-PAGE case — the worst bug of the four, where Slack repeats the parent on every page — cannot
 * be recorded with the current cassette matcher. Requests match on method + path only, and Slack paginates
 * by POSTing the SAME path with a different cursor, so both pages collapse onto one entry; replaying it
 * hands page 1 back twice and the (correct) repeated-cursor guard rejects it. `order: true` is not the
 * answer — it was tried and reverted because a macOS-recorded order did not replay on Linux CI. The real
 * fix is a cursor-aware body matcher, exactly as the GraphQL providers already do in `setup-polly.ts`,
 * and it is deliberately not attempted here. Until then the parent-repeat behaviour is pinned by a unit
 * test whose fixture was corrected to the real shape.
 *
 * ## Why no attachment BYTES are recorded
 *
 * The cassette redactor walks a parsed JSON body. A downloaded PNG/PDF is not JSON, so it would fall
 * through to the literal-only backstop and real private bytes would be committed to a public repo. So the
 * threads chosen here download NOTHING, and the injected downloader THROWS — which both keeps the cassette
 * safe and turns "no download was attempted" into an assertion rather than an assumption. Recording the
 * download path needs binary-body redaction first; it is deliberately not attempted here.
 *
 * Recorded against a REAL workspace, so every assertion is STRUCTURAL (counts, ordering, reasons) — never
 * on content, which the allowlist redactor blanks before commit. Run:
 *   yarn test:integration                                                              # replay (offline)
 *   POLLY_MODE=record SLOPWEAVER_HOME=… SLOPWEAVER_RECORD_SLACK_TOKEN=… yarn test:integration
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { absentAs } from "#lib/absent.js";
import { makeSlackApi } from "../../corpus/slack/api.js";
import { unwrap } from "../../lib/result.js";
import type { DownloadFile } from "../../live/slack/download.js";
import { readSlackThread } from "../../live/slack/readThread.js";

const RECORD = process.env["POLLY_MODE"] === "record";

function slackToken(): string {
  if (!RECORD) {
    return "dummy-replay-token-not-real";
  }
  const token = process.env["SLOPWEAVER_RECORD_SLACK_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error("set SLOPWEAVER_RECORD_SLACK_TOKEN to record the read-thread cassette");
  }
  return token;
}

/** The workspace host. Recorded requests are matched on path, so the host never gates replay. */
const WS = absentAs({
  value: process.env["SLOPWEAVER_RECORD_SLACK_WORKSPACE"],
  whenAbsent: "https://example.slack.com",
});

/**
 * The conversation to read. RECORD needs the real id (it calls the live API); REPLAY does not care, because
 * requests are matched on method + path and the channel travels in the body. So the real ids live in the
 * recording command and NEVER in this committed file — which is also what keeps the public-hygiene gate
 * green, since a raw workspace id is one of the leak classes it refuses.
 */
function channelFor({ slot, fallback }: { slot: string; fallback: string }): string {
  return absentAs({ value: process.env[`SLOPWEAVER_RECORD_SLACK_CHANNEL_${slot}`], whenAbsent: fallback });
}

/** Turns "no attachment was fetched" into an assertion: any download at all fails the test. */
const refuseDownloads: DownloadFile = async ({ filename }) => {
  throw new Error(`no download should have been attempted, but one was for ${filename}`);
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function permalink({ channel, ts }: { channel: string; ts: string }): string {
  return `${WS}/archives/${channel}/p${ts.replace(".", "")}`;
}

async function read({ channel, ts }: { channel: string; ts: string }) {
  const filesRoot = mkdtempSync(join(tmpdir(), "sw-int-readthread-"));
  fixtureDirs.push(filesRoot);
  return readSlackThread({
    deps: {
      api: makeSlackApi({ token: slackToken() }),
      downloadFile: refuseDownloads,
      nowIso: () => "2026-08-03T00:00:00.000Z",
    },
    filesRoot,
    permalink: permalink({ channel, ts }),
    principal: "user",
    token: slackToken(),
  });
}

describe("slack read-thread (integration — real Slack via Polly cassette)", () => {
  it("reads a large thread and reports DELETED attachments as deleted, not as unreadable media", async () => {
    const doc = unwrap(await read({ channel: channelFor({ fallback: "C900", slot: "BIG" }), ts: "1781564408.141409" }));

    expect(doc.observation.cursorExhausted).toBe(true);
    expect(doc.messageCount).toBeGreaterThan(100);
    // Exactly one parent, and no ts appears twice.
    expect(doc.messages.filter((m) => m.relation === "parent").length).toBe(1);
    expect(new Set(doc.messages.map((m) => m.ts)).size).toBe(doc.messageCount);

    const deleted = doc.skippedFiles.filter((s) => s.reason === "deleted-from-slack");
    expect(deleted.length).toBeGreaterThan(0);
    expect(doc.files.length).toBe(0);
    // The exact sentence matters: it previously claimed these were video/audio/binary, which was false.
    expect(doc.limitations.join(" ")).toContain("deleted from Slack");
    expect(doc.limitations.join(" ")).not.toContain("video/audio/binary");
  });

  it("skips a Slack canvas instead of failing the whole thread on it", async () => {
    const doc = unwrap(
      await read({ channel: channelFor({ fallback: "C901", slot: "CANVAS" }), ts: "1779421835.248239" }),
    );

    // Before the fix this read exited non-zero and returned no document at all.
    expect(doc.messageCount).toBeGreaterThan(0);
    expect(doc.skippedFiles.map((s) => s.reason)).toContain("canvas-not-downloadable");
    expect(doc.limitations.join(" ")).toContain("canvas");
  });

  it("resolves a Block Kit file reference through files.info and states the provider's own reason", async () => {
    const doc = unwrap(
      await read({ channel: channelFor({ fallback: "C902", slot: "BLOCKREF" }), ts: "1778550767.414409" }),
    );

    // FIRST: prove the recording is a real payload rather than a recorded auth failure — the specific way a
    // cassette in this repo has lied before. A complete 9-message thread whose own reply_count corroborates
    // it cannot have come from an error response.
    expect(doc.messageCount).toBe(9);
    expect(doc.completeness.providerTotalObserved).toBe(9);
    expect(doc.completeness.verdict).toBe("corroborated");

    // The `slack_file`-only reference now goes through a real `files.info` call. MEASURED against the live
    // workspace: this id, and 3 of the 4 such ids in the whole corpus, answer `file_not_found`
    // — the files were deleted after they were captured. That is why the reason is now the PROVIDER's rather
    // than the guess this verb used to print ("the block gives a file id but no download URL"), which was
    // wrong for every one of them.
    expect(doc.skippedFiles.length).toBe(1);
    expect(doc.skippedFiles[0]!.reason).toBe("block-lookup-failed");
    expect(doc.skippedFiles[0]!.detail).toContain("file_not_found");
    expect(doc.limitations.join(" ")).toContain("files.info could not resolve the id");
    // Nothing was downloaded, so no attachment bytes are in this cassette (`refuseDownloads` would throw).
    expect(doc.files).toEqual([]);
  });
});
