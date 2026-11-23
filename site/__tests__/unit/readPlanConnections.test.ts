/*
 * Settings → Models' live sign-in row: `plans connections --json` projected per provider, and the two acts the row
 * presses. The verb's REAL output is fed to this reader from the `src` lane
 * (`src/__tests__/unit/plans/planConnectionsReaderContract.test.ts`), since the site build cannot resolve what the
 * connection store imports.
 */
import { describe, expect, it } from "vitest";

import { readPlanConnections } from "../../components/live/readPlanConnections";
import { actVerbFor, buildActArgv } from "../../lib/actVerbs";
import { liveVerbFor } from "../../lib/liveVerbs";

/** One attempt as the verb prints it, waiting in the browser. */
const WAITING = {
  alias: "codex-1",
  deadlineAtIso: "2026-11-07T10:12:00.000Z",
  host: "codex",
  id: "0123abcd4567ef89",
  phase: "browser",
  signInUrl: "https://auth.openai.com/oauth/authorize?state=abc",
  startedAtIso: "2026-11-07T10:00:00.000Z",
  storeDir: "/acme/home/codex-accounts/codex-1",
  updatedAtIso: "2026-11-07T10:00:02.000Z",
};

describe("readPlanConnections", () => {
  it("reads the attempt each provider holds, and none where it holds nothing", () => {
    expect(readPlanConnections({ connections: { codex: WAITING } })).toEqual({
      claude: undefined,
      codex: {
        alias: "codex-1",
        detail: undefined,
        email: undefined,
        failure: undefined,
        host: "codex",
        id: "0123abcd4567ef89",
        phase: "browser",
        signInUrl: "https://auth.openai.com/oauth/authorize?state=abc",
        updatedAtIso: "2026-11-07T10:00:02.000Z",
      },
    });
    expect(readPlanConnections({ connections: {} })).toEqual({ claude: undefined, codex: undefined });
  });

  it("carries a failure's code and the provider's own words", () => {
    const failed = { ...WAITING, detail: "port 1455 is in use", failure: "START_REFUSED", phase: "failed" };
    const view = readPlanConnections({ connections: { codex: failed } })!;
    expect([view.codex!.phase, view.codex!.failure, view.codex!.detail]).toEqual([
      "failed",
      "START_REFUSED",
      "port 1455 is in use",
    ]);
  });

  it("refuses the whole reading over a phase, failure or provider it does not know, or a failure without its code", () => {
    expect(
      [
        { connections: { codex: { ...WAITING, phase: "halfway" } } },
        { connections: { codex: { ...WAITING, failure: "GREMLINS", phase: "failed" } } },
        { connections: { codex: { ...WAITING, phase: "failed" } } },
        { connections: { codex: { ...WAITING, failure: "TIMED_OUT" } } },
        { connections: { codex: { ...WAITING, host: "claude" } } },
        { connections: { gemini: WAITING } },
        { connections: { codex: { ...WAITING, email: 7 } } },
        { connections: [] },
        "nope",
      ].map((payload) => readPlanConnections(payload)),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("the live sign-in row's verbs", () => {
  it("reads the attempts on the fast lane through the verb's JSON form", () => {
    const row = liveVerbFor({ slug: "plan-connections" })!;
    expect([row.argv, row.format, row.lane, row.stampsItsOwnTime, row.expectedEmpty]).toEqual([
      ["plans", "connections", "--json"],
      "json",
      "fast",
      false,
      undefined,
    ]);
  });

  it("presses Connect with no slot and Cancel with the attempt's own id, each re-reading the attempts", () => {
    const connect = actVerbFor({ slug: "plans-connect-codex" })!;
    const cancel = actVerbFor({ slug: "plans-connect-cancel" })!;
    expect([
      buildActArgv({ slots: {}, verb: connect }),
      buildActArgv({ slots: { id: WAITING.id }, verb: cancel }),
      connect.readsSlug,
      cancel.readsSlug,
    ]).toEqual([
      { argv: ["plans", "connect", "--provider", "codex", "--json"], kind: "argv" },
      { argv: ["plans", "connect-cancel", "--id", "0123abcd4567ef89", "--json"], kind: "argv" },
      "plan-connections",
      "plan-connections",
    ]);
  });
});
