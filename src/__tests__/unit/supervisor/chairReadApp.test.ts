/*
 * A chair the desktop app hosts is read through the app: the app vouches for the pinned session and that session's
 * own transcript is judged. Every way the read cannot see is `app-chair-unread`, never `cmux-unanswered`, because only
 * that second cause opens the caller-only pass. The transport is a plain scripted function, a seam and not a mock.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result } from "../../../lib/result.js";
import type { AppHarnessRequest, AppHarnessResponse } from "../../../sessionHarness/appProtocol.js";
import { AppSessionOriginErrors } from "../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport, AppTransportFailure } from "../../../sessionHarness/appSocketTransport.js";
import type { AppSupervisorPinRecord } from "../../../sessions/supervisorPin.js";
import { CODEX_PIN_HAS_NO_CLAUDE_CHAIR, readAppChairThrough } from "../../../supervisor/chairRead.js";

const APP_ID = "a0000107-0000-4000-8000-0000000000a1";
const CLAUDE_ID = "a0000023-0000-4000-8000-000000000026";

/** The frozen, field-trimmed transcript of the chair a safeguard fallback reseated on Opus. */
const FIXTURE = join(import.meta.dirname, "../../fixtures/supervisor/chair-fallback-a0000023.jsonl");

/** A Claude chair pinned on an app session, as `cmux pin` records it inside the app. */
const CLAUDE_PIN: AppSupervisorPinRecord = {
  appSessionId: APP_ID,
  pinnedAtIso: "2026-11-09T01:00:00.000Z",
  session: { host: "claude-code", id: CLAUDE_ID },
};

/** The session the app answers `session.origin` with when it vouches for {@link CLAUDE_PIN}. */
const SNAPSHOT = {
  directory: "/work/acme",
  handle: `app:${APP_ID}`,
  ledgerKey: "abc-1",
  openedAtIso: "2026-11-09T01:00:00.000Z",
  sessionId: APP_ID,
  state: "idle",
  title: "abc-1",
  vendor: "claude",
} as const;

/** Every temp `~/.claude` this file minted, removed after each test. */
const minted: string[] = [];

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A throwaway `~/.claude`, holding the chair's transcript only when asked.
 *
 * @param withTranscript whether the pinned session's transcript is copied in
 * @returns the directory
 */
function claudeHome({ withTranscript }: { withTranscript: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "chair-app-"));
  minted.push(dir);
  const project = join(dir, "projects", "-work-acme");
  mkdirSync(project, { recursive: true });
  if (withTranscript) {
    copyFileSync(FIXTURE, join(project, `${CLAUDE_ID}.jsonl`));
  }
  return dir;
}

/** A transport answering one scripted outcome, and the requests it was handed, in order. */
function scripted({ answer }: { answer: Result<AppHarnessResponse, AppTransportFailure> }): {
  transport: AppTransport;
  asked: AppHarnessRequest[];
} {
  const asked: AppHarnessRequest[] = [];
  const transport: AppTransport = async ({ request }) => {
    asked.push(request);
    return answer;
  };
  return { asked, transport };
}

describe("readAppChairThrough", () => {
  it("resolves a Claude app chair the app vouches for, judging that one session's transcript", async () => {
    const { asked, transport } = scripted({ answer: ok({ kind: "session-origin", session: SNAPSHOT }) });

    const read = await readAppChairThrough({
      claudeHome: claudeHome({ withTranscript: true }),
      pin: CLAUDE_PIN,
      transport,
    });

    expect(asked).toStrictEqual([
      { appSessionId: APP_ID, kind: "session.origin", vendor: "claude", vendorSessionId: CLAUDE_ID },
    ]);
    expect(read).toMatchObject({
      directory: "/work/acme",
      kind: "resolved",
      location: { appSessionId: APP_ID, kind: "app" },
      sessions: [{ sessionId: CLAUDE_ID, verdict: { kind: "off-fable", model: "claude-opus-4-8" } }],
    });
  });

  it("reads a Codex app chair as codex-chair and never asks the app", async () => {
    const { asked, transport } = scripted({ answer: ok({ kind: "session-origin", session: SNAPSHOT }) });

    const read = await readAppChairThrough({
      claudeHome: claudeHome({ withTranscript: false }),
      pin: { ...CLAUDE_PIN, session: { host: "codex", id: "thread-1" } },
      transport,
    });

    expect(asked).toStrictEqual([]);
    expect(read).toStrictEqual({
      cause: "codex-chair",
      kind: "unresolved",
      why: `app:${APP_ID}: ${CODEX_PIN_HAS_NO_CLAUDE_CHAIR}`,
    });
  });

  it("reads an origin the app refuses as app-chair-unread, naming the app's own line", async () => {
    const { transport } = scripted({ answer: err({ code: "ORIGIN_REFUSED", kind: "refused", message: "no match" }) });

    const read = await readAppChairThrough({
      claudeHome: claudeHome({ withTranscript: true }),
      pin: CLAUDE_PIN,
      transport,
    });

    expect(read).toStrictEqual({
      cause: "app-chair-unread",
      kind: "unresolved",
      why: `the desktop app did not vouch for the pinned chair app:${APP_ID} (${AppSessionOriginErrors.refused({ message: "no match" }).message})`,
    });
  });

  it("reads an app that is not serving as app-chair-unread, never as cmux-unanswered", async () => {
    const { transport } = scripted({
      answer: err({ causeCode: "ENOENT", kind: "unreachable", message: "not serving" }),
    });

    const read = await readAppChairThrough({
      claudeHome: claudeHome({ withTranscript: true }),
      pin: CLAUDE_PIN,
      transport,
    });

    expect(read).toStrictEqual({
      cause: "app-chair-unread",
      kind: "unresolved",
      why: `the desktop app did not vouch for the pinned chair app:${APP_ID} (${AppSessionOriginErrors.unavailable({ message: "not serving" }).message})`,
    });
  });

  it("reads a vouched chair with no transcript as app-chair-unread, never as Fable", async () => {
    const { transport } = scripted({ answer: ok({ kind: "session-origin", session: SNAPSHOT }) });

    const read = await readAppChairThrough({
      claudeHome: claudeHome({ withTranscript: false }),
      pin: CLAUDE_PIN,
      transport,
    });

    expect(read).toStrictEqual({
      cause: "app-chair-unread",
      kind: "unresolved",
      why: `the pinned chair app:${APP_ID} is live, but no transcript was found for this session`,
    });
  });
});
