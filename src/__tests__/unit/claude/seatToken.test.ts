import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "#lib/result.js";

import type { ClaudeAccountGauge } from "../../../claude/contracts.js";
import { ClaudeRotationErrors } from "../../../claude/errors.js";
import { probePlan, probeSetupToken } from "../../../claude/probeStore.js";
import { bootEnvPrefix } from "../../../claude/seatPinning.js";
import {
  judgeSetupToken,
  readSetupTokenFile,
  seatCredential,
  setupTokenPath,
  validateSetupToken,
  writeSetupToken,
} from "../../../claude/seatToken.js";
import { parseClaudeTokenArgs, renderTokenStatus } from "../../../cli/commands/claude/tokenRun.js";

const NOW = "2026-09-16T02:00:00.000Z";

/** A value shaped like what `claude setup-token` prints. Not a credential. */
const PASTED = "sk-ant-oat01-not-a-real-token";

/** A healthy response to a Fable probe, carrying the Fable trio and an account. */
const FABLE_HEADERS: Readonly<Record<string, string>> = {
  "anthropic-organization-id": "org-plan-two",
  "anthropic-ratelimit-unified-5h-reset": "1788459000",
  "anthropic-ratelimit-unified-5h-status": "allowed",
  "anthropic-ratelimit-unified-5h-utilization": "0.01",
  "anthropic-ratelimit-unified-7d-reset": "1788645600",
  "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.65",
  "anthropic-ratelimit-unified-7d_oi-reset": "1788645600",
  "anthropic-ratelimit-unified-7d_oi-status": "allowed",
  "anthropic-ratelimit-unified-7d_oi-utilization": "0.3",
  "anthropic-ratelimit-unified-status": "allowed",
};

const ENROLLED = { alias: "plan-two", assertedAtIso: "2026-09-10T00:00:00.000Z", organizationId: "org-plan-two" };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fresh store directory under the per-file temp sandbox.
 *
 * @returns its path
 */
function freshStoreDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "seat-token-"));
  dirs.push(dir);
  return dir;
}

describe("validateSetupToken", () => {
  it("accepts a pasted token, stripping the newline a pipe adds", () => {
    expect(unwrap(validateSetupToken({ input: `${PASTED}\n` }))).toBe(PASTED);
  });

  it("refuses anything that is not a setup token before a request is spent on it", () => {
    const error = unwrapErr(validateSetupToken({ input: "sk-ant-api03-an-api-key" }));
    expect(error.code).toBe("SETUP_TOKEN_INVALID");
    expect(error.message).toContain("`claude setup-token` prints one beginning sk-ant-oat");
  });

  it("refuses an empty paste", () => {
    expect(unwrapErr(validateSetupToken({ input: "\n" })).message).toContain("empty");
  });
});

describe("the token file", () => {
  it("round-trips a written token at 0600, and reads ABSENT before one exists", () => {
    const dir = freshStoreDir();
    expect(readSetupTokenFile({ storeDir: dir }).kind).toBe("absent");
    expect(unwrap(writeSetupToken({ storeDir: dir, token: PASTED }))).toBe(`${dir}/setup-token`);
    expect(readSetupTokenFile({ storeDir: dir })).toEqual({ kind: "token", token: PASTED });
    expect(statSync(setupTokenPath({ storeDir: dir })).mode & 0o777).toBe(0o600);
  });

  it("reads an EMPTY token file as unreadable, never as absent", () => {
    const dir = freshStoreDir();
    writeFileSync(setupTokenPath({ storeDir: dir }), "\n");
    expect(readSetupTokenFile({ storeDir: dir }).kind).toBe("unreadable");
  });

  it("reads a token file this process cannot open as unreadable, never as absent", () => {
    const dir = freshStoreDir();
    writeFileSync(setupTokenPath({ storeDir: dir }), PASTED);
    chmodSync(setupTokenPath({ storeDir: dir }), 0o000);
    expect(readSetupTokenFile({ storeDir: dir }).kind).toBe("unreadable");
  });
});

describe("seatCredential", () => {
  it("leaves a plan with no token on its store, exactly as before", () => {
    expect(
      seatCredential({ home: "/home", seat: "w1", storeDir: "/stores/two", tokenFile: { kind: "absent" } }),
    ).toEqual({ kind: "store", storeDir: "/stores/two" });
  });

  it("boots a token plan against an UNBOUND store of the seat's own, never the plan's store", () => {
    expect(
      seatCredential({
        home: "/home",
        seat: "w1",
        storeDir: "/stores/two",
        tokenFile: { kind: "token", token: PASTED },
      }),
    ).toEqual({
      kind: "setup-token",
      storeDir: "/home/claude-accounts/unbound/w1",
      tokenPath: "/stores/two/setup-token",
    });
  });

  it("refuses a plan whose token file will not read, rather than downgrading the seat to the store", () => {
    const credential = seatCredential({
      home: "/home",
      seat: "w1",
      storeDir: "/stores/two",
      tokenFile: { kind: "unreadable" },
    });
    expect(credential.kind).toBe("refused");
  });
});

describe("bootEnvPrefix for a token seat", () => {
  it("opens the token on fd 3 with a leading redirect, naming only its PATH", () => {
    expect(bootEnvPrefix({ storeDir: "/home/unbound/w1", tokenPath: "/stores/two/setup-token" })).toBe(
      "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/home/unbound/w1 3</stores/two/setup-token ",
    );
  });

  it("quotes a token path a shell would otherwise split", () => {
    expect(bootEnvPrefix({ storeDir: "/u", tokenPath: "/my stores/setup-token" })).toBe(
      "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 CLAUDE_SECURESTORAGE_CONFIG_DIR=/u 3<'/my stores/setup-token' ",
    );
  });
});

describe("probeSetupToken", () => {
  it("reads the windows and the account off a token's response", async () => {
    const probe = await probeSetupToken({
      alias: "plan-two",
      nowIso: NOW,
      request: async () => ({ headers: FABLE_HEADERS, status: 200 }),
      token: PASTED,
    });
    expect(unwrap(probe.reading).sevenDay.utilization).toBe(0.65);
    expect(probe.organizationId).toBe("org-plan-two");
  });

  it("names a refusal as the TOKEN's, so the store repair can never fire on it", async () => {
    const probe = await probeSetupToken({
      alias: "plan-two",
      nowIso: NOW,
      request: async () => ({ headers: {}, status: 401 }),
      token: PASTED,
    });
    expect(unwrapErr(probe.reading).code).toBe("SETUP_TOKEN_REJECTED");
  });
});

describe("probePlan on a plan that holds a token", () => {
  it("presents the TOKEN, not the store's access token", async () => {
    const presented: string[] = [];
    const result = await probePlan({
      alias: "plan-two",
      deps: {
        read: () => ({ claudeAiOauth: { accessToken: "the-store-token" } }),
        readToken: () => ({ kind: "token", token: PASTED }),
        request: async ({ accessToken }) => {
          presented.push(accessToken);
          return { headers: FABLE_HEADERS, status: 200 };
        },
      },
      nowIso: NOW,
      storeDir: "/stores/plan-two",
    });
    expect(presented).toEqual([PASTED]);
    expect(unwrap(result.reading).alias).toBe("plan-two");
  });

  it("reads an unreadable token file as SETUP_TOKEN_UNREADABLE and sends nothing", async () => {
    const presented: string[] = [];
    const result = await probePlan({
      alias: "plan-two",
      deps: {
        read: () => ({ claudeAiOauth: { accessToken: "the-store-token" } }),
        readToken: () => ({ kind: "unreadable" }),
        request: async ({ accessToken }) => {
          presented.push(accessToken);
          return { headers: FABLE_HEADERS, status: 200 };
        },
      },
      nowIso: NOW,
      storeDir: "/stores/plan-two",
    });
    expect(presented).toEqual([]);
    expect(unwrapErr(result.reading).code).toBe("SETUP_TOKEN_UNREADABLE");
  });
});

describe("judgeSetupToken — the proof that windows and identity survive", () => {
  const gauge = {
    alias: "plan-two",
    fiveHour: { resetAtIso: NOW, status: "allowed", utilization: 0.01 },
    observedAtIso: NOW,
    sevenDay: { resetAtIso: NOW, status: "allowed", utilization: 0.65 },
    sevenDayFable: { resetAtIso: NOW, status: "allowed", utilization: 0.3 },
  } satisfies ClaudeAccountGauge;

  it("accepts a token whose response carried the Fable week and the enrolled account", () => {
    const verdict = judgeSetupToken({
      alias: "plan-two",
      assertion: ENROLLED,
      probe: { organizationId: "org-plan-two", reading: ok(gauge) },
    });
    expect(verdict).toEqual({
      lines: [
        "plan-two: setup token VERIFIED — windows survive (5h 1%, week 65%, fable 30%) and the account is the one enrolled",
      ],
      ok: true,
    });
  });

  it("refuses a token minted on a DIFFERENT account from the one enrolled", () => {
    const verdict = judgeSetupToken({
      alias: "plan-two",
      assertion: ENROLLED,
      probe: { organizationId: "org-plan-three", reading: ok(gauge) },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("DIFFERENT account");
  });

  it("refuses when no account is enrolled to check against", () => {
    const verdict = judgeSetupToken({
      alias: "plan-two",
      probe: { organizationId: "org-plan-two", reading: ok(gauge) },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("signin --enroll plan-two");
  });

  it("refuses a response that named no account", () => {
    const verdict = judgeSetupToken({ alias: "plan-two", assertion: ENROLLED, probe: { reading: ok(gauge) } });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("named no account");
  });

  it("refuses a gauge with no Fable week, because Fable routing would be blind to the plan", () => {
    const { sevenDayFable: _dropped, ...plainGauge } = gauge;
    const verdict = judgeSetupToken({
      alias: "plan-two",
      assertion: ENROLLED,
      probe: { organizationId: "org-plan-two", reading: ok(plainGauge) },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.lines[0]).toContain("no Fable week");
  });

  it("refuses a refused token, carrying the refusal's own message", () => {
    const error = ClaudeRotationErrors.setupTokenRejected({ alias: "plan-two", status: 401 });
    const verdict = judgeSetupToken({ alias: "plan-two", assertion: ENROLLED, probe: { reading: err(error) } });
    expect(verdict).toEqual({ lines: [`plan-two: setup token NOT written — ${error.message}`], ok: false });
  });
});

describe("claude token", () => {
  it("parses --plan with --stdin", () => {
    expect(unwrap(parseClaudeTokenArgs({ rest: ["--plan", "plan-two", "--stdin"] }))).toEqual({
      alias: "plan-two",
      forceStdin: true,
      kind: "set",
    });
  });

  it("refuses --status beside --plan", () => {
    expect(unwrapErr(parseClaudeTokenArgs({ rest: ["--status", "--plan", "plan-two"] })).message).toBe(
      "claude token takes exactly one of --status or --plan <alias>: both were passed",
    );
  });

  it("refuses a bare invocation, naming both uses", () => {
    expect(unwrapErr(parseClaudeTokenArgs({ rest: [] })).code).toBe("TOKEN_ARGS_INVALID");
  });

  it("says per plan how its seats authenticate, and counts the plans on a token", () => {
    const lines = renderTokenStatus({
      accounts: [
        { alias: "plan-one", storeDir: "/s/one" },
        { alias: "plan-two", storeDir: "/s/two" },
        { alias: "plan-three", storeDir: "/s/three" },
      ],
      read: ({ storeDir }) => {
        if (storeDir === "/s/one") {
          return { kind: "token", token: PASTED };
        }
        return storeDir === "/s/two" ? { kind: "unreadable" } : { kind: "absent" };
      },
    });
    expect(lines[0]).toBe("plan-one: on a setup token — its seats boot over a file descriptor against unbound stores");
    expect(lines[1]).toContain("UNREADABLE");
    expect(lines[2]).toContain("slopweaver claude mint --plan plan-three");
    expect(lines[3]).toBe("1 of 3 plans on a setup token");
  });
});
