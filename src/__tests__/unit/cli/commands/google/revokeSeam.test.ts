/**
 * Unit: the shared `revoke` seam every Google door hands the connect shell, driven through the MAIL door's
 * real vocabulary and a throwaway home.
 *
 * The two properties worth a test are the ones a reviewer cannot see by reading the composition. The client
 * id is resolved PER CALL rather than when the deps object is built, because `--home` is a flag — a seam
 * that captured it once would read the operator's own home and then revoke a grant in somebody else's. And
 * an unconfigured client refuses before Google is asked at all, in the door's own words.
 *
 * Google's endpoint is the one injected effect; nothing here opens a socket.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GMAIL_DOOR } from "../../../../../cli/commands/gmail/connectRun.js";
import { productionRevokeSeam } from "../../../../../cli/commands/google/revokeSeam.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { type GmailError, GmailErrors } from "../../../../../live/gmail/errors.js";
import { gmailGrantStore } from "../../../../../secrets/gmailGrant.js";

const homes: string[] = [];

/** A throwaway home carrying one stored Gmail grant, removed after the test that minted it. */
function homeWithGrant(): string {
  const home = mkdtempSync(join(tmpdir(), "revoke-seam-"));
  homes.push(home);
  gmailGrantStore.write({
    grant: {
      account: "me@example.test",
      grantedAtIso: "2026-09-21T00:00:00.000Z",
      refreshToken: "1//rt",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    },
    home,
  });
  return home;
}

/** The door's refusal when no OAuth client is configured, as `connectRun.ts` words it. */
function clientAbsent(): GmailError {
  return GmailErrors.credentialUnreadable({ message: "no Google OAuth client is configured" });
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("productionRevokeSeam", () => {
  it("resolves the OAuth client id from the home it is CALLED with, not the one it was built with", async () => {
    const seen: string[] = [];
    const seam = productionRevokeSeam({
      clientAbsent,
      door: GMAIL_DOOR,
      productName: "Gmail",
      provider: "gmail",
      resolveClientId: ({ home }) => {
        seen.push(home);
        return undefined;
      },
      store: gmailGrantStore,
    });
    await seam({ home: "/tmp/first" });
    await seam({ home: "/tmp/second" });
    expect(seen).toStrictEqual(["/tmp/first", "/tmp/second"]);
  });

  it("refuses in the door's own words when no OAuth client is configured, and leaves the grant standing", async () => {
    const home = homeWithGrant();
    const seam = productionRevokeSeam({
      clientAbsent,
      door: GMAIL_DOOR,
      productName: "Gmail",
      provider: "gmail",
      resolveClientId: () => undefined,
      store: gmailGrantStore,
    });
    const result = await seam({ home });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("no Google OAuth client is configured");
    expect(unwrap(gmailGrantStore.read({ home }))!.account).toBe("me@example.test");
  });

  it("answers nothing-revoked, without asking Google, when the home holds no grant", async () => {
    const home = mkdtempSync(join(tmpdir(), "revoke-seam-empty-"));
    homes.push(home);
    const seam = productionRevokeSeam({
      clientAbsent,
      door: GMAIL_DOOR,
      productName: "Gmail",
      provider: "gmail",
      resolveClientId: () => "client-id.apps.googleusercontent.com",
      store: gmailGrantStore,
    });
    expect(unwrap(await seam({ home }))).toBe(undefined);
  });
});
