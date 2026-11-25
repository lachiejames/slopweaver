/**
 * The app-session origin check, both halves: what a process's environment claims, and what the app's control plane
 * vouches for. The transport is a plain scripted function that records the request it was handed — a seam, not a mock.
 *
 * The residue's mechanical half is pinned here too: a sibling that substitutes only another session's app id sends
 * its OWN vendor session id, which the app refuses; a process that rewrote both ids is indistinguishable on the wire,
 * which is exactly the request this check cannot tell apart.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import {
  APP_SESSION_ID_ENV,
  type AppHarnessRequest,
  type AppHarnessResponse,
} from "../../../sessionHarness/appProtocol.js";
import {
  type AppSessionClaim,
  AppSessionOriginErrors,
  appSessionClaim,
  verifyAppSessionOrigin,
} from "../../../sessionHarness/appSessionOrigin.js";
import type { AppTransport, AppTransportFailure } from "../../../sessionHarness/appSocketTransport.js";
import type { SupervisorSessionDetection } from "../../../supervisor/session.js";

const APP_ID = "a0000107-0000-4000-8000-0000000000a1";
const CLAUDE_ID = "a0000107-0000-4000-8000-0000000000c1";

const CLAUDE_ACTIVE: SupervisorSessionDetection = { kind: "active", session: { host: "claude-code", id: CLAUDE_ID } };
const CODEX_ACTIVE: SupervisorSessionDetection = { kind: "active", session: { host: "codex", id: "thread-1" } };

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

const CLAIM: AppSessionClaim = { appSessionId: APP_ID, session: { host: "claude-code", id: CLAUDE_ID } };

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

describe("appSessionClaim", () => {
  it("reads no claim at all when no app session id is set, whatever host is detected", () => {
    const claims = [CLAUDE_ACTIVE, CODEX_ACTIVE, { kind: "missing" } as const].map((detection) =>
      unwrap(appSessionClaim({ detection, env: {} })),
    );
    expect(claims).toEqual([undefined, undefined, undefined]);
  });

  it("pairs the app session id with the detected vendor session", () => {
    expect(unwrap(appSessionClaim({ detection: CLAUDE_ACTIVE, env: { [APP_SESSION_ID_ENV]: APP_ID } }))).toEqual({
      appSessionId: APP_ID,
      session: { host: "claude-code", id: CLAUDE_ID },
    });
    expect(unwrap(appSessionClaim({ detection: CODEX_ACTIVE, env: { [APP_SESSION_ID_ENV]: APP_ID } }))).toEqual({
      appSessionId: APP_ID,
      session: { host: "codex", id: "thread-1" },
    });
  });

  it("refuses an app session id set but blank", () => {
    const refused = unwrapErr(appSessionClaim({ detection: CLAUDE_ACTIVE, env: { [APP_SESSION_ID_ENV]: "  " } }));
    expect(refused).toEqual(AppSessionOriginErrors.blankId());
    expect(refused.message).toBe("SLOPWEAVER_APP_SESSION_ID is set but blank, so it names no app session");
  });

  it("refuses an app session id that is not bare, the handle form and a path included", () => {
    const refusals = [`app:${APP_ID}`, "../escape", "a b"].map(
      (value) => unwrapErr(appSessionClaim({ detection: CLAUDE_ACTIVE, env: { [APP_SESSION_ID_ENV]: value } })).code,
    );
    expect(refusals).toEqual(["APP_SESSION_ID_MALFORMED", "APP_SESSION_ID_MALFORMED", "APP_SESSION_ID_MALFORMED"]);
  });

  it("refuses an app session id beside a cmux workspace as ambiguous, never picking one", () => {
    const env = { [APP_SESSION_ID_ENV]: APP_ID, CMUX_WORKSPACE_ID: "workspace-7" };
    expect(unwrapErr(appSessionClaim({ detection: CLAUDE_ACTIVE, env }))).toEqual(
      AppSessionOriginErrors.cmuxAlsoSet({ appSessionId: APP_ID }),
    );
  });

  it("reads a blank cmux workspace variable as no cmux workspace", () => {
    const env = { [APP_SESSION_ID_ENV]: APP_ID, CMUX_WORKSPACE_ID: "" };
    expect(unwrap(appSessionClaim({ detection: CLAUDE_ACTIVE, env }))!.appSessionId).toBe(APP_ID);
  });

  it("refuses an app session id with no vendor session to prove it by, never falling back", () => {
    const refused = unwrapErr(
      appSessionClaim({ detection: { kind: "missing" }, env: { [APP_SESSION_ID_ENV]: APP_ID } }),
    );
    expect(refused).toEqual(AppSessionOriginErrors.noVendorSession({ appSessionId: APP_ID }));
    expect(refused.code).toBe("APP_SESSION_ID_MISSING");
  });

  it("refuses an app session id beside both vendors' session ids as ambiguous", () => {
    const detection: SupervisorSessionDetection = {
      kind: "ambiguous",
      sessions: [
        { host: "claude-code", id: CLAUDE_ID },
        { host: "codex", id: "thread-1" },
      ],
    };
    const refused = unwrapErr(appSessionClaim({ detection, env: { [APP_SESSION_ID_ENV]: APP_ID } }));
    expect(refused).toEqual(AppSessionOriginErrors.bothVendors({ appSessionId: APP_ID }));
    expect(refused.code).toBe("APP_SESSION_HOST_AMBIGUOUS");
  });
});

describe("verifyAppSessionOrigin", () => {
  it("asks the app once with the claim, the Claude Code host named claude, and answers the session as a target", async () => {
    const { asked, transport } = scripted({ answer: ok({ kind: "session-origin", session: SNAPSHOT }) });
    const target = unwrap(await verifyAppSessionOrigin({ claim: CLAIM, transport }));
    expect(asked).toEqual([
      { appSessionId: APP_ID, kind: "session.origin", vendor: "claude", vendorSessionId: CLAUDE_ID },
    ]);
    expect([target.session.id, target.session.handle, target.session.groupId]).toEqual([
      APP_ID,
      `app:${APP_ID}`,
      "app",
    ]);
  });

  it("names a Codex host codex on the wire", async () => {
    const { asked, transport } = scripted({
      answer: ok({ kind: "session-origin", session: { ...SNAPSHOT, vendor: "codex" } }),
    });
    const claim: AppSessionClaim = { appSessionId: APP_ID, session: { host: "codex", id: "thread-1" } };
    expect(unwrap(await verifyAppSessionOrigin({ claim, transport })).session.id).toBe(APP_ID);
    expect(asked).toEqual([
      { appSessionId: APP_ID, kind: "session.origin", vendor: "codex", vendorSessionId: "thread-1" },
    ]);
  });

  it("refuses an answer that vouches for another session, another handle or another vendor", async () => {
    const answers = [
      { ...SNAPSHOT, sessionId: "a0000107-0000-4000-8000-0000000000a2" },
      { ...SNAPSHOT, handle: "app:a0000107-0000-4000-8000-0000000000a2" },
      { ...SNAPSHOT, vendor: "codex" as const },
    ];
    const codes = await Promise.all(
      answers.map(async (session) => {
        const { transport } = scripted({ answer: ok({ kind: "session-origin", session }) });
        return unwrapErr(await verifyAppSessionOrigin({ claim: CLAIM, transport })).code;
      }),
    );
    expect(codes).toEqual(["APP_SESSION_ORIGIN_REFUSED", "APP_SESSION_ORIGIN_REFUSED", "APP_SESSION_ORIGIN_REFUSED"]);
  });

  it("carries the app's own origin refusal as a refusal", async () => {
    const message = `app session ${APP_ID} does not run the vendor session this caller is in`;
    const { transport } = scripted({ answer: err({ code: "ORIGIN_REFUSED", kind: "refused", message }) });
    expect(unwrapErr(await verifyAppSessionOrigin({ claim: CLAIM, transport }))).toEqual(
      AppSessionOriginErrors.refused({ message }),
    );
  });

  it("calls an unreachable app, another refusal or an answer of the wrong kind unavailable", async () => {
    const answers: Result<AppHarnessResponse, AppTransportFailure>[] = [
      err({ causeCode: "ENOENT", kind: "unreachable", message: "not serving" }),
      err({ code: "BAD_REQUEST", kind: "refused", message: "not a request" }),
      err({ kind: "malformed", message: "unreadable" }),
      ok({ kind: "resolved", session: SNAPSHOT }),
    ];
    const refusals = await Promise.all(
      answers.map(async (answer) =>
        unwrapErr(await verifyAppSessionOrigin({ claim: CLAIM, transport: scripted({ answer }).transport })),
      ),
    );
    expect(refusals).toEqual([
      AppSessionOriginErrors.unavailable({ message: "not serving" }),
      AppSessionOriginErrors.unavailable({ message: "not a request" }),
      AppSessionOriginErrors.unavailable({ message: "unreadable" }),
      AppSessionOriginErrors.unavailable({ message: "the desktop app answered session.origin with resolved" }),
    ]);
  });
});

describe("the residue, mechanically", () => {
  it("sends a sibling's own vendor session id when it substitutes only another session's app id", async () => {
    const sibling = unwrap(
      appSessionClaim({
        detection: { kind: "active", session: { host: "claude-code", id: "a0000107-0000-4000-8000-0000000000c2" } },
        env: { [APP_SESSION_ID_ENV]: APP_ID },
      }),
    )!;
    const { asked, transport } = scripted({
      answer: err({ code: "ORIGIN_REFUSED", kind: "refused", message: "no match" }),
    });
    expect(unwrapErr(await verifyAppSessionOrigin({ claim: sibling, transport })).code).toBe(
      "APP_SESSION_ORIGIN_REFUSED",
    );
    expect(asked).toEqual([
      {
        appSessionId: APP_ID,
        kind: "session.origin",
        vendor: "claude",
        vendorSessionId: "a0000107-0000-4000-8000-0000000000c2",
      },
    ]);
  });

  it("sends exactly the victim's own request when a process rewrites both ids, which is why that residue stands", async () => {
    const victim = unwrap(appSessionClaim({ detection: CLAUDE_ACTIVE, env: { [APP_SESSION_ID_ENV]: APP_ID } }))!;
    const rewritten = unwrap(
      appSessionClaim({
        detection: { kind: "active", session: { host: "claude-code", id: CLAUDE_ID } },
        env: { [APP_SESSION_ID_ENV]: APP_ID },
      }),
    )!;
    const sent = await Promise.all(
      [victim, rewritten].map(async (claim) => {
        const { asked, transport } = scripted({ answer: ok({ kind: "session-origin", session: SNAPSHOT }) });
        await verifyAppSessionOrigin({ claim, transport });
        return asked;
      }),
    );
    expect(sent[1]).toEqual(sent[0]);
  });
});
