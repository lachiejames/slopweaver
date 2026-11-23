/**
 * The Knock key resolves from one secrets-store file only: an absent file is TOKEN_MISSING with the hand step, a
 * present file that cannot be used is a different failure naming the file and no byte of it, and a stored key is
 * trimmed.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { KNOCK_API_KEY_SECRET, resolveKnockCredential } from "../../../../live/knock/credential.js";
import { KNOCK_KEY_HAND_STEP, KnockReadErrors } from "../../../../live/knock/errors.js";
import { secretFilePath } from "../../../../stateHome.js";

const KEY = "sk_fake_knock_secret_key";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-knock-credential-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write the key file at 0600. */
function store({ value }: { value: string }): string {
  const path = secretFilePath({ home, name: KNOCK_API_KEY_SECRET });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { mode: 0o600 });
  return path;
}

describe("resolveKnockCredential", () => {
  it("is TOKEN_MISSING, carrying the hand step, when nothing is stored", () => {
    const refused = unwrapErr(resolveKnockCredential({ home }));
    expect(refused).toEqual(KnockReadErrors.tokenMissing());
    expect(refused.message).toContain(KNOCK_KEY_HAND_STEP);
  });

  it("returns the key trimmed of its trailing newline", () => {
    store({ value: `${KEY}\n` });
    expect(unwrap(resolveKnockCredential({ home }))).toEqual({ apiKey: KEY });
  });

  it("refuses a publishable key, naming the file and no byte of it", () => {
    const path = store({ value: "pk_fake_publishable\n" });
    const refused = unwrapErr(resolveKnockCredential({ home }));
    expect(refused).toEqual(
      KnockReadErrors.credentialUnreadable({
        path,
        reason: "it is not a Knock secret key (`sk_…`) — a publishable `pk_` key cannot read messages",
      }),
    );
    expect(refused.message).not.toContain("pk_fake_publishable");
  });

  it("refuses a bare `sk_` prefix and one carrying a character outside the registered shape", () => {
    const refusals = ["sk_\n", "sk_!\n", "sk_abc.def\n"].map((value) => {
      store({ value });
      return unwrapErr(resolveKnockCredential({ home }));
    });
    const expected = KnockReadErrors.credentialUnreadable({
      path: secretFilePath({ home, name: KNOCK_API_KEY_SECRET }),
      reason: "it is not a Knock secret key (`sk_…`) — a publishable `pk_` key cannot read messages",
    });
    expect(refusals).toEqual([expected, expected, expected]);
  });

  it("refuses a key no Authorization header can carry, naming no byte of it", () => {
    const path = store({ value: "sk_fake knock key\n" });
    const refused = unwrapErr(resolveKnockCredential({ home }));
    expect(refused).toEqual(
      KnockReadErrors.credentialUnreadable({
        path,
        reason: "it holds a character an Authorization header cannot carry — re-run the hand step",
      }),
    );
    expect(refused.message).not.toContain("sk_fake");
  });

  it("refuses a key file that is a symlink, never reading what it points at", () => {
    const path = secretFilePath({ home, name: KNOCK_API_KEY_SECRET });
    mkdirSync(dirname(path), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), "slopweaver-knock-outside-"));
    writeFileSync(join(outside, "key"), "sk_outside_secret\n");
    symlinkSync(join(outside, "key"), path);
    const refused = unwrapErr(resolveKnockCredential({ home }));
    rmSync(outside, { force: true, recursive: true });
    expect(refused).toEqual(
      KnockReadErrors.credentialUnreadable({ path, reason: "it is a symlink — re-run the hand step" }),
    );
    expect(refused.message).not.toContain("sk_outside");
  });

  it("refuses a key file its group or others can read, never quoting it", () => {
    const path = store({ value: `${KEY}\n` });
    chmodSync(path, 0o644);
    const refused = unwrapErr(resolveKnockCredential({ home }));
    expect(refused.code).toBe("CREDENTIAL_UNREADABLE");
    expect(refused.message).toContain("must be owner-only (mode 0600 or stricter)");
    expect(refused.message).not.toContain(KEY);
  });
});

describe("the hand step", () => {
  it("asks for the production secret key and names the verbs that store and prove it", () => {
    expect(KNOCK_KEY_HAND_STEP).toContain("PRODUCTION environment's secret key");
    expect(KNOCK_KEY_HAND_STEP).toContain("slopweaver secrets set knock-api-key");
    expect(KNOCK_KEY_HAND_STEP).toContain("slopweaver knock verify");
  });

  it("names the dashboard path generically, never one install's Knock account", () => {
    expect(KNOCK_KEY_HAND_STEP.startsWith("In dashboard.knock.app → your Knock account → Developers → API keys")).toBe(
      true,
    );
  });
});
