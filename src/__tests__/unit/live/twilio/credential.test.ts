/**
 * The Twilio key resolves from three secrets-store files only: every absent file is named in one TOKEN_MISSING,
 * a present file that cannot be used is a different failure naming the file and no byte of it, and a stored key
 * is trimmed.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  resolveTwilioCredentials,
  TWILIO_ACCOUNT_SID_SECRET,
  TWILIO_API_KEY_SECRET_SECRET,
  TWILIO_API_KEY_SID_SECRET,
  TWILIO_SECRET_MIN_LENGTH,
} from "../../../../live/twilio/credential.js";
import { TWILIO_KEY_HAND_STEP, TwilioReadErrors } from "../../../../live/twilio/errors.js";
import { secretFilePath } from "../../../../stateHome.js";

const ACCOUNT = `AC${"a".repeat(32)}`;
const KEY_SID = `SK${"b".repeat(32)}`;
const SECRET = "fake-twilio-secret-of-real-length";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-twilio-credential-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write one secret file at 0600. */
function store({ name, value }: { name: string; value: string }): string {
  const path = secretFilePath({ home, name });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { mode: 0o600 });
  return path;
}

/** Store a complete, well-shaped key. */
function storeAll(): void {
  store({ name: TWILIO_ACCOUNT_SID_SECRET, value: `${ACCOUNT}\n` });
  store({ name: TWILIO_API_KEY_SID_SECRET, value: `${KEY_SID}\n` });
  store({ name: TWILIO_API_KEY_SECRET_SECRET, value: `${SECRET}\n` });
}

describe("resolveTwilioCredentials", () => {
  it("names all three files in ONE TOKEN_MISSING when nothing is stored", () => {
    expect(unwrapErr(resolveTwilioCredentials({ home }))).toEqual(
      TwilioReadErrors.tokenMissing({
        missing: [TWILIO_ACCOUNT_SID_SECRET, TWILIO_API_KEY_SID_SECRET, TWILIO_API_KEY_SECRET_SECRET],
      }),
    );
  });

  it("names only the file still missing when the others are stored", () => {
    store({ name: TWILIO_ACCOUNT_SID_SECRET, value: `${ACCOUNT}\n` });
    store({ name: TWILIO_API_KEY_SID_SECRET, value: `${KEY_SID}\n` });
    expect(unwrapErr(resolveTwilioCredentials({ home }))).toEqual(
      TwilioReadErrors.tokenMissing({ missing: [TWILIO_API_KEY_SECRET_SECRET] }),
    );
  });

  it("carries the hand step in the TOKEN_MISSING message", () => {
    expect(unwrapErr(resolveTwilioCredentials({ home })).message).toContain(TWILIO_KEY_HAND_STEP);
  });

  it("returns the three values trimmed of their trailing newline", () => {
    storeAll();
    expect(unwrap(resolveTwilioCredentials({ home }))).toEqual({
      accountSid: ACCOUNT,
      keySecret: SECRET,
      keySid: KEY_SID,
    });
  });

  it("refuses an account file that is not an AC SID, naming the file", () => {
    storeAll();
    const path = store({ name: TWILIO_ACCOUNT_SID_SECRET, value: "not-an-account\n" });
    expect(unwrapErr(resolveTwilioCredentials({ home }))).toEqual(
      TwilioReadErrors.credentialUnreadable({ path, reason: "it is not an account SID (`AC` then 32 hex characters)" }),
    );
  });

  it("refuses an auth token stored where the API key SID belongs", () => {
    storeAll();
    const path = store({ name: TWILIO_API_KEY_SID_SECRET, value: `${"c".repeat(32)}\n` });
    expect(unwrapErr(resolveTwilioCredentials({ home }))).toEqual(
      TwilioReadErrors.credentialUnreadable({
        path,
        reason: "it is not an API key SID (`SK` then 32 hex characters) — an auth token is not an API key",
      }),
    );
  });

  it("refuses a secret no Authorization header can carry, naming no byte of it", () => {
    storeAll();
    const path = store({ name: TWILIO_API_KEY_SECRET_SECRET, value: "fake-twilio-secret\u0000of-real-length\n" });
    const refused = unwrapErr(resolveTwilioCredentials({ home }));
    expect(refused).toEqual(
      TwilioReadErrors.credentialUnreadable({
        path,
        reason: "it holds a character an Authorization header cannot carry — re-run the hand step",
      }),
    );
    expect(refused.message).not.toContain("fake-twilio-secret");
  });

  it("refuses a secret shorter than the minimum", () => {
    storeAll();
    const path = store({ name: TWILIO_API_KEY_SECRET_SECRET, value: "short\n" });
    expect(unwrapErr(resolveTwilioCredentials({ home }))).toEqual(
      TwilioReadErrors.credentialUnreadable({
        path,
        reason: `it is shorter than ${String(TWILIO_SECRET_MIN_LENGTH)} characters, which no Twilio key secret is — re-run the hand step`,
      }),
    );
  });

  it("refuses a secret file that is a symlink, never reading what it points at", () => {
    storeAll();
    const path = secretFilePath({ home, name: TWILIO_API_KEY_SECRET_SECRET });
    rmSync(path);
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-twilio-outside-"));
    writeFileSync(join(outside, "secret"), "outside-secret-of-real-length\n");
    symlinkSync(join(outside, "secret"), path);
    const refused = unwrapErr(resolveTwilioCredentials({ home }));
    rmSync(outside, { force: true, recursive: true });
    expect(refused).toEqual(
      TwilioReadErrors.credentialUnreadable({ path, reason: "it is a symlink — re-run the hand step" }),
    );
    expect(refused.message).not.toContain("outside-secret");
  });

  it("refuses a secret file its group or others can read, never quoting it", () => {
    storeAll();
    const path = secretFilePath({ home, name: TWILIO_API_KEY_SECRET_SECRET });
    chmodSync(path, 0o644);
    const refused = unwrapErr(resolveTwilioCredentials({ home }));
    expect(refused.code).toBe("CREDENTIAL_UNREADABLE");
    expect(refused.message).toContain("must be owner-only (mode 0600 or stricter)");
    expect(refused.message).not.toContain(SECRET);
  });
});

describe("the hand step", () => {
  it("asks for a RESTRICTED key reading Messages, and names every verb that stores it", () => {
    expect(TWILIO_KEY_HAND_STEP).toContain("RESTRICTED API key granting only Messaging → Messages → Read");
    expect(TWILIO_KEY_HAND_STEP).toContain("slopweaver secrets set twilio-account-sid");
    expect(TWILIO_KEY_HAND_STEP).toContain("slopweaver secrets set twilio-api-key-sid");
    expect(TWILIO_KEY_HAND_STEP).toContain("slopweaver secrets set twilio-api-key-secret");
    expect(TWILIO_KEY_HAND_STEP).toContain("slopweaver twilio verify");
  });
});
