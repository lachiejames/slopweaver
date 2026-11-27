/**
 * The clause a prepare refusal gains when the app most likely predates `stateHome`: only a launch carrying it, and
 * only the app's own `BAD_REQUEST`, names that cause.
 */
import { describe, expect, it } from "vitest";

import type { AppLaunchSpec } from "../../../sessionHarness/appProtocol.js";
import { stateHomeRefusalClause } from "../../../sessionHarness/stateHomeRefusal.js";

const CODEX = {
  codexHome: "/h/codex-one",
  directory: "/work/acme",
  judgedInstanceId: "instance-a",
  ledgerKey: "abc-1",
  title: "abc-1",
  vendor: "codex",
} as const satisfies AppLaunchSpec;

const PREDATES =
  " — this launch carries stateHome (cmux spawn --home), so the installed app most likely predates stateHome: " +
  "install the current desktop app before a confined seat can open on it";

describe("stateHomeRefusalClause", () => {
  it("names the probable cause for a BAD_REQUEST on a launch carrying stateHome", () => {
    const appSpec: AppLaunchSpec = { ...CODEX, stateHome: "/scratch/home" };
    const error = { code: "BAD_REQUEST", kind: "refused", message: "bad request" } as const;
    expect(stateHomeRefusalClause({ appSpec, error })).toBe(PREDATES);
  });

  it("adds nothing for the same refusal on a launch with no stateHome", () => {
    const error = { code: "BAD_REQUEST", kind: "refused", message: "bad request" } as const;
    expect(stateHomeRefusalClause({ appSpec: CODEX, error })).toBe("");
  });

  it("adds nothing for any other refusal code, or an app that never answered", () => {
    const appSpec: AppLaunchSpec = { ...CODEX, stateHome: "/scratch/home" };
    const refused = { code: "LAUNCH_FAILED", kind: "refused", message: "no" } as const;
    const unreachable = { causeCode: "ENOENT", kind: "unreachable", message: "no socket" } as const;
    expect([
      stateHomeRefusalClause({ appSpec, error: refused }),
      stateHomeRefusalClause({ appSpec, error: unreachable }),
    ]).toEqual(["", ""]);
  });
});
