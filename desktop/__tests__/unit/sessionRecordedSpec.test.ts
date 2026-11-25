/**
 * What `launch.inspect` answers (`desktop/src/sessionRecordedSpec.ts`): the launch the recovery journal recorded for an
 * exact session, its `$CODEX_HOME` included, refused by name wherever a resume would be refused for the journal's own
 * reasons — and the desktop copy of the wire decoding the request and its answer.
 */
import { describe, expect, it } from "vitest";

import {
  APP_HARNESS_PROTOCOL_VERSION,
  type AppLaunchSpec,
  isAppHarnessRequestEnvelope,
  isAppHarnessResponseEnvelope,
} from "../../src/sessionControlProtocol";
import { recordedSpecOf } from "../../src/sessionRecordedSpec";
import type { RecoveredSession, RecoveryJournal } from "../../src/sessionRecoveryRecord";

const CODEX: AppLaunchSpec = {
  codexHome: "/home/acme/.codex-three",
  directory: "/work/acme",
  judgedInstanceId: "instance-1",
  ledgerHome: "/home/acme/.slopweaver",
  ledgerKey: "ABC-1",
  title: "ABC-1",
  vendor: "codex",
};

/** A journal holding one session `s1` opened with {@link CODEX}, closed or carrying torn lines when asked. */
function journalOf({
  closed = false,
  malformedLines = [],
  opened = true,
}: {
  closed?: boolean;
  malformedLines?: readonly number[];
  opened?: boolean;
}): RecoveryJournal {
  const row: RecoveredSession["opened"] = {
    atIso: "2026-11-10T00:00:01Z",
    kind: "opened",
    sessionId: "s1",
    spec: CODEX,
    vendorSessionId: "thread-1",
  };
  const session: RecoveredSession = { closed, groups: [], opened: opened ? row : undefined, sessionId: "s1" };
  return { malformedLines, sessions: new Map([["s1", session]]) };
}

describe("recordedSpecOf", () => {
  it("answers the exact spec the session opened with, its CODEX_HOME included", () => {
    const recorded = recordedSpecOf({ journal: journalOf({}), sessionId: "s1" });
    expect(recorded._unsafeUnwrap()).toEqual(CODEX);
  });

  it("refuses a session that was stopped", () => {
    const refusal = recordedSpecOf({ journal: journalOf({ closed: true }), sessionId: "s1" })._unsafeUnwrapErr();
    expect(refusal.code).toBe("SESSION_CLOSED");
    expect(refusal.message).toBe(
      "session s1 was stopped from its card or a close, so its launch is not offered for a resume",
    );
  });

  it("refuses a journal holding any line no row decodes from, whatever it says of the session", () => {
    const refusal = recordedSpecOf({
      journal: journalOf({ malformedLines: [3, 9] }),
      sessionId: "s1",
    })._unsafeUnwrapErr();
    expect(refusal.code).toBe("JOURNAL_MALFORMED");
    expect(refusal.message).toBe(
      "the recovery journal has lines no row decodes from (3, 9), so no session's launch is read from it",
    );
  });

  it("refuses a session that never came up, and one the journal never names", () => {
    const neverUp = recordedSpecOf({ journal: journalOf({ opened: false }), sessionId: "s1" })._unsafeUnwrapErr();
    expect(neverUp.code).toBe("SESSION_UNRECORDED");
    const unnamed = recordedSpecOf({ journal: journalOf({}), sessionId: "s2" })._unsafeUnwrapErr();
    expect(unnamed.code).toBe("SESSION_UNRECORDED");
    expect(unnamed.message).toBe(
      "the recovery journal records no session s2 that came up, so it holds no launch to resume",
    );
  });
});

describe("the desktop copy of launch.inspect on the wire", () => {
  it("decodes the request naming one session and refuses one naming none", () => {
    const envelopeOf = ({ request }: { request: unknown }): unknown => ({
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      request,
      requestId: "r1",
    });
    expect(isAppHarnessRequestEnvelope(envelopeOf({ request: { kind: "launch.inspect", sessionId: "s1" } }))).toBe(
      true,
    );
    expect(isAppHarnessRequestEnvelope(envelopeOf({ request: { kind: "launch.inspect", sessionId: "" } }))).toBe(false);
  });

  it("decodes the launch-spec answer and refuses one with no readable spec", () => {
    const answerOf = ({ response }: { response: unknown }): unknown => ({
      outcome: "answered",
      protocolVersion: APP_HARNESS_PROTOCOL_VERSION,
      requestId: "r1",
      response,
    });
    expect(
      isAppHarnessResponseEnvelope(answerOf({ response: { kind: "launch-spec", sessionId: "s1", spec: CODEX } })),
    ).toBe(true);
    expect(isAppHarnessResponseEnvelope(answerOf({ response: { kind: "launch-spec", sessionId: "s1" } }))).toBe(false);
  });
});
