/**
 * The roster half's session decision: use an exported session, sign in from the stored password only when
 * there is none, and name the one missing step otherwise. Every effect is a plain fake passed in.
 */
import { describe, expect, it } from "vitest";

import { ONEPASSWORD_SIGNIN_STEP } from "../../../../atlas/onepassword/credentials.js";
import type { OpSession } from "../../../../atlas/onepassword/opCli.js";
import { type OpSessionSeams, resolveOpSessionEnv } from "../../../../atlas/onepassword/opSession.js";
import { err, ok, type Result } from "../../../../lib/result.js";

const NOT_SIGNED_IN = "[ERROR] 2026/09/28 13:00:00 no active session found for account atlas";
const SESSION: OpSession = { name: "OP_SESSION_ABC123", token: "tok-not-real" };

/**
 * Seams that record what was asked of them; `whoami` succeeds only once the fresh session is in the env.
 *
 * @param over the seams a case replaces
 * @returns the seams and the calls they saw
 */
function recordingSeams(over: Partial<OpSessionSeams> = {}): {
  seams: OpSessionSeams;
  calls: string[];
} {
  const calls: string[] = [];
  const seams: OpSessionSeams = {
    readPassword: () => {
      calls.push("readPassword");
      return "pw-not-real";
    },
    signIn: ({ password }): Result<OpSession> => {
      calls.push(`signIn:${password}`);
      return ok(SESSION);
    },
    whoami: ({ env }): Result<unknown> => {
      calls.push("whoami");
      if (env[SESSION.name] === SESSION.token) {
        return ok({});
      }
      return err([NOT_SIGNED_IN]);
    },
    ...over,
  };
  return { calls, seams };
}

describe("resolveOpSessionEnv", () => {
  it("uses an exported session as it stands, without reading the password", () => {
    const env = { OP_SESSION_OTHER: "exported" };
    const { calls, seams } = recordingSeams({ whoami: () => ok({}) });
    expect(resolveOpSessionEnv({ env, seams })).toEqual({ env });
    expect(calls).toEqual([]);
  });

  it("signs in from the stored password and binds the fresh token when there is no session", () => {
    const { calls, seams } = recordingSeams();
    expect(resolveOpSessionEnv({ env: { PATH: "/bin" }, seams })).toEqual({
      env: { OP_SESSION_ABC123: "tok-not-real", PATH: "/bin" },
    });
    expect(calls).toEqual(["whoami", "readPassword", "signIn:pw-not-real", "whoami"]);
  });

  it("names the one missing step when no password is stored", () => {
    const { calls, seams } = recordingSeams({ readPassword: () => undefined });
    expect(resolveOpSessionEnv({ env: {}, seams })).toEqual({
      reason: `${NOT_SIGNED_IN}; ${ONEPASSWORD_SIGNIN_STEP}`,
    });
    expect(calls).toEqual(["whoami"]);
  });

  it("keeps a missing binary's own reason and never signs in", () => {
    const { calls, seams } = recordingSeams({ whoami: () => err(["op: command not found (ENOENT)"]) });
    expect(resolveOpSessionEnv({ env: {}, seams })).toEqual({ reason: "op: command not found (ENOENT)" });
    expect(calls).toEqual(["readPassword"]);
  });

  it("never carries the stored password in a reason, even when op echoes it back", () => {
    const echoed = "op --account pw-not-real: command not found (ENOENT)";
    const { seams } = recordingSeams({ whoami: () => err([echoed]) });
    expect(resolveOpSessionEnv({ env: {}, seams })).toEqual({
      reason: "op --account <redacted>: command not found (ENOENT)",
    });
  });

  it("reports a failed sign-in with the sign-in's own lines", () => {
    const { seams } = recordingSeams({ signIn: () => err(["[ERROR] You are not currently signed in."]) });
    expect(resolveOpSessionEnv({ env: {}, seams })).toEqual({
      reason: "signing in from the onepassword-atlas-password secret failed; [ERROR] You are not currently signed in.",
    });
  });

  it("reports a fresh session the re-probe refuses", () => {
    const { calls, seams } = recordingSeams({ whoami: () => err([NOT_SIGNED_IN]) });
    expect(resolveOpSessionEnv({ env: {}, seams })).toEqual({
      reason: `the fresh session from the stored password was refused; ${NOT_SIGNED_IN}`,
    });
    expect(calls).toEqual(["readPassword", "signIn:pw-not-real"]);
  });
});
