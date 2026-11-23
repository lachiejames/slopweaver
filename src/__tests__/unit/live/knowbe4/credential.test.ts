/**
 * The KnowBe4 token resolves from the secrets store only: absent is the hand step's starting state, empty or
 * unreadable is a different failure, and a stored token is trimmed.
 */
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  KNOWBE4_API_TOKEN_SECRET,
  KNOWBE4_TOKEN_HAND_STEP,
  KNOWBE4_TOKEN_MIN_LENGTH,
  resolveKnowbe4Token,
} from "../../../../live/knowbe4/credential.js";
import { Knowbe4ReadErrors } from "../../../../live/knowbe4/errors.js";
import { secretFilePath } from "../../../../stateHome.js";

let home: string;
let tokenPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-knowbe4-credential-"));
  tokenPath = secretFilePath({ home, name: KNOWBE4_API_TOKEN_SECRET });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("resolveKnowbe4Token", () => {
  it("answers TOKEN_MISSING naming the one file it checked when nothing is stored", () => {
    expect(unwrapErr(resolveKnowbe4Token({ home }))).toEqual(Knowbe4ReadErrors.tokenMissing({ checked: [tokenPath] }));
  });

  it("answers CREDENTIAL_UNREADABLE for a stored file holding only whitespace", () => {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "  \n", { mode: 0o600 });
    expect(unwrapErr(resolveKnowbe4Token({ home }))).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({ path: tokenPath, reason: "the file is empty" }),
    );
  });

  it("answers CREDENTIAL_UNREADABLE, not TOKEN_MISSING, when the path is there and cannot be read", () => {
    mkdirSync(tokenPath, { recursive: true });
    expect(unwrapErr(resolveKnowbe4Token({ home })).code).toBe("CREDENTIAL_UNREADABLE");
  });

  it("refuses a token no Authorization header can carry, naming no byte of it", () => {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "kb4-fake-secret\u0000x\n", { mode: 0o600 });
    const refused = unwrapErr(resolveKnowbe4Token({ home }));

    expect(refused).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({
        path: tokenPath,
        reason: "the token holds a character an Authorization header cannot carry — re-run the hand step",
      }),
    );
    expect(refused.message).not.toContain("kb4-fake-secret");
  });

  it("refuses a token file that is a symlink to elsewhere, never reading the token it points at", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-knowbe4-outside-"));
    writeFileSync(join(outside, "token"), "kb4-outside-token\n");
    mkdirSync(dirname(tokenPath), { recursive: true });
    symlinkSync(join(outside, "token"), tokenPath);
    const refused = unwrapErr(resolveKnowbe4Token({ home }));
    rmSync(outside, { force: true, recursive: true });

    expect(refused).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({ path: tokenPath, reason: "it is a symlink — re-run the hand step" }),
    );
    expect(refused.message).not.toContain("kb4-outside-token");
  });

  it("refuses a secrets directory that is a symlink to elsewhere", () => {
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-knowbe4-outside-"));
    writeFileSync(join(outside, KNOWBE4_API_TOKEN_SECRET), "kb4-outside-token\n");
    symlinkSync(outside, dirname(tokenPath));
    const refused = unwrapErr(resolveKnowbe4Token({ home }));
    rmSync(outside, { force: true, recursive: true });

    expect(refused).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({
        path: tokenPath,
        reason: `${dirname(tokenPath)} is a symlink — re-run the hand step`,
      }),
    );
  });

  it("refuses to read under a home its group or others can write, where a rename could swap the directory", () => {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "kb4-test-token-of-a-real-length\n", { mode: 0o600 });
    chmodSync(home, 0o770);
    const realHome = realpathSync(home);
    expect(unwrapErr(resolveKnowbe4Token({ home }))).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({
        path: tokenPath,
        reason: `${realHome} is writable by its group or others, so a secret is never written or read under it — chmod go-w ${realHome}`,
      }),
    );
  });

  it("returns the stored token trimmed of its trailing newline", () => {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "kb4-test-token-of-a-real-length\n", { mode: 0o600 });
    expect(unwrap(resolveKnowbe4Token({ home }))).toBe("kb4-test-token-of-a-real-length");
  });

  it("refuses a token shorter than the minimum, which a withheld failure's fixed sentence could contain", () => {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "redacted\n", { mode: 0o600 });
    expect(unwrapErr(resolveKnowbe4Token({ home }))).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({
        path: tokenPath,
        reason: `the token is shorter than ${String(KNOWBE4_TOKEN_MIN_LENGTH)} characters, which no Reporting API token is — re-run the hand step`,
      }),
    );
  });

  it("refuses a token file its group or others can read, naming the mode and never the token", () => {
    mkdirSync(dirname(tokenPath), { recursive: true });
    writeFileSync(tokenPath, "kb4-test-token-of-a-real-length\n");
    chmodSync(tokenPath, 0o644);
    const refused = unwrapErr(resolveKnowbe4Token({ home }));

    expect(refused).toEqual(
      Knowbe4ReadErrors.credentialUnreadable({
        path: tokenPath,
        reason: `its mode is 644, not 600, so its group or others can read it — chmod 600 ${tokenPath}`,
      }),
    );
    expect(refused.message).not.toContain("kb4-test-token-of-a-real-length");
  });
});

describe("the hand step", () => {
  it("names where a NEW token is minted, that Vanta's is never regenerated, and the verb that stores it", () => {
    expect(KNOWBE4_TOKEN_HAND_STEP).toContain("Account Settings → Account Integrations → API → Reporting API");
    expect(KNOWBE4_TOKEN_HAND_STEP).toContain("never regenerate the existing one, which Vanta's connector reads");
    expect(KNOWBE4_TOKEN_HAND_STEP).toContain("slopweaver secrets set knowbe4-api-token");
  });
});
