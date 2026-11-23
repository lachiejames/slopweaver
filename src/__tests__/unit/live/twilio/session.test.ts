/**
 * `openTwilioSession` is the one construction site of a live Twilio seam: no key is the install's TOKEN_MISSING,
 * and a stored key yields a seam bound to the configured account whose send refuses a URL the builder could not
 * have made — before any request leaves the process.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  TWILIO_ACCOUNT_SID_SECRET,
  TWILIO_API_KEY_SECRET_SECRET,
  TWILIO_API_KEY_SID_SECRET,
} from "../../../../live/twilio/credential.js";
import { TwilioReadErrors } from "../../../../live/twilio/errors.js";
import { openTwilioSession } from "../../../../live/twilio/session.js";
import { secretFilePath } from "../../../../stateHome.js";

const ACCOUNT = `AC${"a".repeat(32)}`;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-twilio-session-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write one secret file at 0600. */
function store({ name, value }: { name: string; value: string }): void {
  const path = secretFilePath({ home, name });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { mode: 0o600 });
}

describe("openTwilioSession", () => {
  it("is TOKEN_MISSING when nothing is stored", () => {
    expect(unwrapErr(openTwilioSession({ home })).code).toBe("TOKEN_MISSING");
  });

  it("binds the stored account, and its seam refuses an off-list URL before sending", async () => {
    store({ name: TWILIO_ACCOUNT_SID_SECRET, value: `${ACCOUNT}\n` });
    store({ name: TWILIO_API_KEY_SID_SECRET, value: `SK${"b".repeat(32)}\n` });
    store({ name: TWILIO_API_KEY_SECRET_SECRET, value: "fake-twilio-secret-of-real-length\n" });
    const session = unwrap(openTwilioSession({ home }));
    expect(session.accountSid).toBe(ACCOUNT);
    const sent = await session.get({
      url: new URL(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT}/Calls.json`),
    });
    expect(unwrapErr(sent)).toEqual(
      TwilioReadErrors.urlRefused({
        path: `/2010-04-01/Accounts/${ACCOUNT}/Calls.json`,
        why: "the URL is not one the closed call list builds",
      }),
    );
  });
});
