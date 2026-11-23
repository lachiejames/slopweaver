/**
 * Unit: withdrawing a stored Google grant. The one network call is an injected seam and the filesystem is a
 * real `mkdtempSync` home, so what is under test is the ORDER of the two effects — Google first, the file
 * second — which is the property that decides what an interrupted revocation leaves behind.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { runGoogleRevoke } from "../../../../live/google/revoke.js";
import { gmailGrantStore } from "../../../../secrets/gmailGrant.js";

/** The mail door's failure factory, reduced to the one member a revocation ever reaches for. */
const ERRORS = { consentFailed: ({ message }: { message: string; cause?: unknown }) => ({ message }) };

const homes: string[] = [];

/** A throwaway home carrying one stored grant, so the revocation has something real to delete. */
function homeWithGrant({ refreshToken = "1//rt" }: { refreshToken?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), "revoke-"));
  homes.push(home);
  gmailGrantStore.write({
    grant: {
      account: "me@example.test",
      grantedAtIso: "2026-09-22T00:00:00.000Z",
      refreshToken,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    },
    home,
  });
  return home;
}

/** A `postForm` seam that records what it was asked to send. */
function fakePost({ body = "", fails = false }: { body?: string; fails?: boolean } = {}): {
  readonly postForm: (args: {
    url: string;
    body: string;
    operation: string;
  }) => Promise<Result<string, { message: string }>>;
  readonly sent: { url: string; body: string; operation: string }[];
} {
  const sent: { url: string; body: string; operation: string }[] = [];
  return {
    postForm: async (args) => {
      sent.push(args);
      return fails ? err({ message: "the network refused" }) : ok(body);
    },
    sent,
  };
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("runGoogleRevoke", () => {
  it("posts the refresh token to Google's revocation endpoint and deletes the grant file", async () => {
    const home = homeWithGrant();
    const post = fakePost();
    const outcome = await runGoogleRevoke({
      deps: { postForm: post.postForm },
      errors: ERRORS,
      home,
      provider: "gmail",
      store: gmailGrantStore,
    });
    expect(unwrap(outcome)!.account).toBe("me@example.test");
    expect(unwrap(outcome)!.path).toBe(gmailGrantStore.path({ home }));
    expect(post.sent[0]!.url).toBe("https://oauth2.googleapis.com/revoke");
    expect(post.sent[0]!.body).toBe("token=1%2F%2Frt");
    expect(post.sent[0]!.operation).toBe("gmail.oauth.revoke");
    expect(existsSync(gmailGrantStore.path({ home }))).toBe(false);
  });

  it("reports nothing to withdraw when no grant is stored, and calls Google not at all", async () => {
    const home = mkdtempSync(join(tmpdir(), "revoke-"));
    homes.push(home);
    const post = fakePost();
    const outcome = await runGoogleRevoke({
      deps: { postForm: post.postForm },
      errors: ERRORS,
      home,
      provider: "gmail",
      store: gmailGrantStore,
    });
    expect(unwrap(outcome)).toBeUndefined();
    expect(post.sent).toStrictEqual([]);
  });

  it("LEAVES the grant file in place when Google refuses, so the credential is still usable", async () => {
    const home = homeWithGrant();
    const post = fakePost({ fails: true });
    const outcome = await runGoogleRevoke({
      deps: { postForm: post.postForm },
      errors: ERRORS,
      home,
      provider: "gmail",
      store: gmailGrantStore,
    });
    expect(outcome.isErr()).toBe(true);
    expect(unwrapErr(outcome).message).toBe("the network refused");
    expect(existsSync(gmailGrantStore.path({ home }))).toBe(true);
  });

  it("LEAVES the grant file in place when Google's body reports a refusal", async () => {
    const home = homeWithGrant();
    const post = fakePost({ body: JSON.stringify({ error: "invalid_token" }) });
    const outcome = await runGoogleRevoke({
      deps: { postForm: post.postForm },
      errors: ERRORS,
      home,
      provider: "gmail",
      store: gmailGrantStore,
    });
    expect(outcome.isErr()).toBe(true);
    expect(unwrapErr(outcome).message).toContain("invalid_token");
    expect(existsSync(gmailGrantStore.path({ home }))).toBe(true);
  });
});
