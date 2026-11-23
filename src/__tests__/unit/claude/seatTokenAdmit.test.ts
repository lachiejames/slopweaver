import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import type { ClaudeAccount } from "../../../claude/contracts.js";
import { admitSetupToken } from "../../../claude/seatTokenAdmit.js";

const NOW = "2026-09-25T02:00:00.000Z";

/** A value shaped like what `claude setup-token` prints. Not a credential. */
const MINTED = "sk-ant-oat01-not-a-real-token";

/** A healthy response to a Fable probe, naming the enrolled account. */
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

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * A fresh home holding one standing enrollment for plan-two, and plan-two's account under it.
 *
 * @returns the home and the account whose store lives inside it
 */
function enrolledHome(): { home: string; account: ClaudeAccount } {
  const home = mkdtempSync(join(tmpdir(), "seat-admit-"));
  homes.push(home);
  mkdirSync(join(home, "claude-accounts"), { recursive: true });
  writeFileSync(
    join(home, "claude-accounts", "identity-assertions.json"),
    JSON.stringify({
      assertions: [
        {
          alias: "plan-two",
          assertedAtIso: "2026-09-10T00:00:00.000Z",
          email: "plan-two@example.invalid",
          organizationId: "org-plan-two",
        },
      ],
    }),
  );
  return { account: { alias: "plan-two", storeDir: join(home, "stores", "plan-two") }, home };
}

/**
 * A fake probe request — a seam, not a mock — answering with fixed headers.
 *
 * @param headers what the provider answers with
 * @returns the request seam
 */
const answering =
  ({ headers }: { headers: Readonly<Record<string, string>> }) =>
  async (): Promise<{ headers: Readonly<Record<string, string>>; status: number }> => ({ headers, status: 200 });

describe("admitSetupToken", () => {
  it("writes a token that proved the windows and the enrolled account, at 0600", async () => {
    const { account, home } = enrolledHome();

    const admitted = unwrap(
      await admitSetupToken({
        account,
        home,
        nowIso: NOW,
        request: answering({ headers: FABLE_HEADERS }),
        token: MINTED,
      }),
    );

    expect(admitted.path).toBe(join(account.storeDir, "setup-token"));
    expect(admitted.lines).toEqual([
      "plan-two: setup token VERIFIED — windows survive (5h 1%, week 65%, fable 30%) and the account is the one enrolled",
    ]);
    expect(readFileSync(admitted.path, "utf8")).toBe(MINTED);
    expect(statSync(admitted.path).mode & 0o777).toBe(0o600);
  });

  it("refuses a token minted on a DIFFERENT account, and writes nothing", async () => {
    const { account, home } = enrolledHome();
    const headers = { ...FABLE_HEADERS, "anthropic-organization-id": "org-plan-three" };

    const error = unwrapErr(
      await admitSetupToken({ account, home, nowIso: NOW, request: answering({ headers }), token: MINTED }),
    );

    expect(error.code).toBe("SETUP_TOKEN_UNPROVEN");
    expect(error.message).toContain("DIFFERENT account");
    expect(existsSync(join(account.storeDir, "setup-token"))).toBe(false);
  });

  it("refuses a token whose response carried no Fable week, and writes nothing", async () => {
    const { account, home } = enrolledHome();
    const {
      "anthropic-ratelimit-unified-7d_oi-reset": _reset,
      "anthropic-ratelimit-unified-7d_oi-status": _status,
      "anthropic-ratelimit-unified-7d_oi-utilization": _utilization,
      ...headers
    } = FABLE_HEADERS;

    const error = unwrapErr(
      await admitSetupToken({ account, home, nowIso: NOW, request: answering({ headers }), token: MINTED }),
    );

    expect(error.code).toBe("SETUP_TOKEN_UNPROVEN");
    expect(error.message).toContain("no Fable week");
    expect(existsSync(join(account.storeDir, "setup-token"))).toBe(false);
  });

  it("never carries the token in the refusal it returns", async () => {
    const { account, home } = enrolledHome();
    const headers = { ...FABLE_HEADERS, "anthropic-organization-id": "org-plan-three" };

    const error = unwrapErr(
      await admitSetupToken({ account, home, nowIso: NOW, request: answering({ headers }), token: MINTED }),
    );

    // The token WAS the input, so its absence here is a witness rather than silence.
    expect(error.code).toBe("SETUP_TOKEN_UNPROVEN");
    expect(JSON.stringify(error)).not.toContain(MINTED);
  });

  it("answers the write failure, without the token, when a PROVEN token cannot be written", async () => {
    const { account, home } = enrolledHome();
    // The store's path is a plain file, so no directory can be made there to hold the token.
    mkdirSync(join(home, "stores"), { recursive: true });
    writeFileSync(account.storeDir, "");

    const error = unwrapErr(
      await admitSetupToken({
        account,
        home,
        nowIso: NOW,
        request: answering({ headers: FABLE_HEADERS }),
        token: MINTED,
      }),
    );

    expect(error.code).toBe("SETUP_TOKEN_WRITE_FAILED");
    expect(error.message).toContain(join(account.storeDir, "setup-token"));
    expect(JSON.stringify(error)).not.toContain(MINTED);
  });
});
