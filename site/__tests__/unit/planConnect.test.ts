/** What Settings → Models' live sign-in row says, and when it keeps polling. */
import { describe, expect, it } from "vitest";

import { CONNECTION_FAILURES, type PlanConnectionView } from "../../components/live/readPlanConnections";
import {
  CONNECTION_FAILURE_WORDS,
  connectionActiveOf,
  connectionLineOf,
  connectionMarkOf,
} from "../../lib/planConnect";

const WAITING: PlanConnectionView = {
  alias: "codex-1",
  detail: undefined,
  email: undefined,
  failure: undefined,
  host: "codex",
  id: "0123abcd4567ef89",
  phase: "browser",
  signInUrl: "https://auth.openai.com/oauth/authorize",
  updatedAtIso: "2026-11-07T10:00:02.000Z",
};

describe("connectionActiveOf", () => {
  it("is active while starting or waiting in the browser, and not once it ended or with none", () => {
    expect(
      [
        { ...WAITING, phase: "starting" as const },
        WAITING,
        { ...WAITING, phase: "connected" as const },
        { ...WAITING, failure: "TIMED_OUT" as const, phase: "failed" as const },
        { ...WAITING, phase: "cancelled" as const },
        undefined,
      ].map((connection) => connectionActiveOf({ connection })),
    ).toEqual([true, true, false, false, false, false]);
  });
});

describe("connectionLineOf", () => {
  it("says the step, the account it connected, or the failure in plain words", () => {
    expect([
      connectionLineOf({ connection: WAITING }),
      connectionLineOf({ connection: { ...WAITING, email: "b@example.com", phase: "connected" } }),
      connectionLineOf({ connection: { ...WAITING, failure: "DUPLICATE_ACCOUNT", phase: "failed" } }),
    ]).toEqual([
      "Waiting for you to sign in, in your browser.",
      "Connected b@example.com.",
      "That account is already connected, so it would add nothing. Sign in with a different account.",
    ]);
  });

  it("words every failure, and never tells anyone to run a command", () => {
    expect(CONNECTION_FAILURES.length).toBe(11);
    const words = CONNECTION_FAILURES.map((failure) => CONNECTION_FAILURE_WORDS[failure]);
    expect(words.filter((line) => line.length === 0 || /slopweaver|terminal|`/u.test(line))).toEqual([]);
  });
});

describe("connectionMarkOf", () => {
  it("keys an attempt by its id and phase, and none by nothing", () => {
    expect([connectionMarkOf({ connection: WAITING }), connectionMarkOf({ connection: undefined })]).toEqual([
      "0123abcd4567ef89:browser",
      "",
    ]);
  });
});
