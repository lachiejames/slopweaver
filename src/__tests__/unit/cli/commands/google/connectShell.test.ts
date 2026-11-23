/**
 * Unit: the shared Google `connect` shell, driven through the MAIL door's real vocabulary and real parser.
 * The consent round trip is an injected seam, so these exercise the properties that matter and none needs a
 * browser: `--status` never starts a flow, and a grant is stored with the scopes Google APPROVED rather than
 * the scopes that were asked for.
 *
 * Driven through a real door rather than a synthetic one on purpose. The shell's whole job is to compose a
 * door's parser, scope table and grant store correctly, so a stand-in door would test the composition
 * against a shape nothing ships.
 */
import { describe, expect, it } from "vitest";
import { parseGmailConnectArgs } from "../../../../../cli/commands/gmail/connectCore.js";
import { GMAIL_DOOR } from "../../../../../cli/commands/gmail/connectRun.js";
import { type GoogleConnectDeps, runGoogleConnect } from "../../../../../cli/commands/google/connectShell.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err, ok } from "../../../../../lib/result.js";
import { type GmailError, GmailErrors } from "../../../../../live/gmail/errors.js";
import { GMAIL_SCOPES } from "../../../../../live/gmail/scopes.js";
import type { GmailGrant } from "../../../../../secrets/gmailGrant.js";

const NOW = "2026-08-27T12:00:00.000Z";

/** Captured shell output, the calls each seam saw, and whatever grant was persisted. */
interface Captured {
  readonly deps: GoogleConnectDeps<GmailError>;
  readonly out: string[];
  readonly diagnostics: string[];
  readonly calls: string[];
  readonly persisted: GmailGrant[];
}

function fakeDeps({
  grantedScope = `${GMAIL_SCOPES.identity} ${GMAIL_SCOPES.read} ${GMAIL_SCOPES.modify} ${GMAIL_SCOPES.docs}`,
  // A boolean rather than an optional token: a destructuring default fires on an explicit `undefined`, so
  // `refreshToken: undefined` would silently take the default and the refusal path would never be reached.
  noRefreshToken = false,
  stored = undefined as { account: string; scopes: readonly string[]; refreshTokenExpiresAtIso?: string } | undefined,
  consentFails = false,
  revokeFails = false,
  nowIso = NOW,
  refreshLifetime = {},
}: {
  nowIso?: string;
  grantedScope?: string;
  noRefreshToken?: boolean;
  stored?: { account: string; scopes: readonly string[]; refreshTokenExpiresAtIso?: string } | undefined;
  consentFails?: boolean;
  revokeFails?: boolean;
  /** Google's `refresh_token_expires_in`, as a Testing-status client is sent it; empty for a Production one. */
  refreshLifetime?: { readonly refreshTokenExpiresInSeconds?: number };
} = {}): Captured {
  const out: string[] = [];
  const diagnostics: string[] = [];
  const calls: string[] = [];
  const persisted: GmailGrant[] = [];
  return {
    calls,
    deps: {
      consent: async ({ scopes, home }) => {
        calls.push(`consent:${scopes.join("+")}:${home}`);
        return consentFails
          ? err(GmailErrors.consentFailed({ message: "the consent window closed" }))
          : ok({
              account: "me@example.test",
              tokens: {
                accessToken: "ya29-at",
                expiresInSeconds: 3599,
                scope: grantedScope,
                ...(noRefreshToken ? {} : { refreshToken: "1//rt" }),
                ...refreshLifetime,
              },
            });
      },
      nowIso: () => {
        calls.push("nowIso");
        return nowIso;
      },
      revoke: async ({ home }) => {
        calls.push(`revoke:${home}`);
        if (revokeFails) {
          return err(GmailErrors.consentFailed({ message: "Google refused the revocation" }));
        }
        return stored === undefined
          ? ok(undefined)
          : ok({ account: stored.account, path: `${home}/secrets/gmail-oauth.json` });
      },
      persist: ({ grant, home }) => {
        calls.push(`persist:${home}`);
        persisted.push(grant);
        return ok(`${home}/secrets/gmail-oauth.json`);
      },
      status: ({ home }) => {
        calls.push(`status:${home}`);
        return ok(
          stored === undefined
            ? undefined
            : {
                account: stored.account,
                grantedAtIso: NOW,
                path: `${home}/secrets/gmail-oauth.json`,
                scopes: stored.scopes,
                ...(stored.refreshTokenExpiresAtIso === undefined
                  ? {}
                  : { refreshTokenExpiresAtIso: stored.refreshTokenExpiresAtIso }),
              },
        );
      },
      writeDiagnostic: (line) => diagnostics.push(line),
      writeOut: (line) => out.push(line),
    },
    diagnostics,
    out,
    persisted,
  };
}

/** Run the shell the way `slopweaver gmail connect` does — same door, same parser. */
async function runConnect({
  deps,
  rest,
}: {
  deps: GoogleConnectDeps<GmailError>;
  rest: readonly string[];
}): Promise<number> {
  return runGoogleConnect({
    deps,
    door: GMAIL_DOOR,
    parse: (args) => parseGmailConnectArgs(args).mapErr((error) => [error.message, error.usage]),
    rest,
  });
}

describe("runGoogleConnect --status", () => {
  it("reads the stored grant and NEVER starts a consent flow", async () => {
    const captured = fakeDeps({ stored: { account: "me@example.test", scopes: [GMAIL_SCOPES.read] } });
    const code = await runConnect({ deps: captured.deps, rest: ["--status", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["status:/tmp/h"]);
    expect(captured.out.join("\n")).toContain("connected as me@example.test");
  });

  it("reports not-connected as a FINDING exit code rather than as a fault", async () => {
    const captured = fakeDeps();
    const code = await runConnect({ deps: captured.deps, rest: ["--status", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(captured.out).toStrictEqual(["gmail: not connected"]);
  });

  it("emits a token-free JSON status", async () => {
    const captured = fakeDeps({ stored: { account: "me@example.test", scopes: [GMAIL_SCOPES.read] } });
    await runConnect({ deps: captured.deps, rest: ["--status", "--json", "--home", "/tmp/h"] });
    expect(JSON.parse(captured.out[0]!)).toStrictEqual({
      account: "me@example.test",
      connected: true,
      grantedAtIso: NOW,
      path: "/tmp/h/secrets/gmail-oauth.json",
      scopes: [GMAIL_SCOPES.read],
    });
  });
});

describe("runGoogleConnect refresh-token lapse", () => {
  const LAPSE = "2026-09-03T12:00:00.000Z";
  const stored = { account: "me@example.test", refreshTokenExpiresAtIso: LAPSE, scopes: [GMAIL_SCOPES.read] };

  it("stores the lapse Google named, from the same single clock read as the grant's other times", async () => {
    const captured = fakeDeps({ refreshLifetime: { refreshTokenExpiresInSeconds: 604800 } });
    expect(await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] })).toBe(EXIT_OK);
    expect(captured.persisted[0]!.refreshTokenExpiresAtIso).toBe(LAPSE);
    expect(captured.calls.filter((call) => call === "nowIso")).toStrictEqual(["nowIso"]);
    expect(captured.out.join("\n")).toContain(`refresh token lapses at: ${LAPSE}`);
    expect(captured.diagnostics).toStrictEqual([
      `Google set this refresh token to lapse at ${LAPSE}, which it does for an OAuth client whose consent screen ` +
        "is in Testing — re-run `slopweaver gmail connect` before then, or publish the client to Production",
    ]);
  });

  it("stores no lapse, prints none and warns of none when Google named none", async () => {
    const captured = fakeDeps();
    await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(Object.keys(captured.persisted[0]!)).not.toContain("refreshTokenExpiresAtIso");
    expect(captured.out.join("\n")).not.toContain("refresh token");
    expect(captured.diagnostics).toStrictEqual([]);
  });

  it("refuses a lifetime that ends past any instant a Date can hold, storing nothing", async () => {
    const captured = fakeDeps({ refreshLifetime: { refreshTokenExpiresInSeconds: 9e12 } });
    expect(await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] })).toBe(EXIT_ERROR);
    expect(captured.persisted).toStrictEqual([]);
  });

  it.each([
    ["more than 48 hours out", "2026-08-27T12:00:00.000Z", []],
    [
      "within 48 hours",
      "2026-09-02T12:00:00.000Z",
      [`gmail: refresh token lapses at ${LAPSE} — re-run \`slopweaver gmail connect\` before then to reconnect`],
    ],
    [
      "past it",
      "2026-09-04T12:00:00.000Z",
      [`gmail: refresh token lapsed at ${LAPSE} — re-run \`slopweaver gmail connect\` to reconnect`],
    ],
  ])("prints the lapse on --status and warns only when %s is not the case", async (_label, nowIso, warned) => {
    const captured = fakeDeps({ nowIso, stored });
    expect(await runConnect({ deps: captured.deps, rest: ["--status", "--home", "/tmp/h"] })).toBe(EXIT_OK);
    expect(captured.out.join("\n")).toContain(`refresh token lapses at: ${LAPSE}`);
    expect(captured.diagnostics).toStrictEqual(warned);
  });

  it("carries the lapse in --status --json", async () => {
    const captured = fakeDeps({ stored });
    await runConnect({ deps: captured.deps, rest: ["--status", "--json", "--home", "/tmp/h"] });
    expect(JSON.parse(captured.out[0]!).refreshTokenExpiresAtIso).toBe(LAPSE);
  });
});

describe("runGoogleConnect", () => {
  it("requests the grant's scopes and stores what Google approved", async () => {
    const captured = fakeDeps();
    const code = await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls[0]).toBe(
      `consent:${GMAIL_SCOPES.identity}+${GMAIL_SCOPES.read}+${GMAIL_SCOPES.modify}+${GMAIL_SCOPES.docs}:/tmp/h`,
    );
    expect(captured.persisted[0]!.account).toBe("me@example.test");
    expect(captured.persisted[0]!.refreshToken).toBe("1//rt");
    expect(captured.persisted[0]!.scopes).toStrictEqual([
      GMAIL_SCOPES.identity,
      GMAIL_SCOPES.read,
      GMAIL_SCOPES.modify,
      GMAIL_SCOPES.docs,
    ]);
  });

  it("stores the access token's expiry, `expires_in` after the instant the grant landed", async () => {
    const captured = fakeDeps();
    const code = await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.persisted[0]!.accessToken).toBe("ya29-at");
    expect(captured.persisted[0]!.grantedAtIso).toBe(NOW);
    // Google's 3599 s, measured from the SAME clock read the grant's own timestamp came from.
    expect(captured.persisted[0]!.expiryMs).toBe(Date.parse(NOW) + 3_599_000);
    expect(captured.calls.filter((call) => call === "nowIso")).toStrictEqual(["nowIso"]);
  });

  it("refuses to store a grant whose own timestamp is no instant, rather than storing it with no expiry", async () => {
    const captured = fakeDeps({ nowIso: "not-a-time" });
    const code = await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.persisted).toStrictEqual([]);
    expect(captured.diagnostics).toStrictEqual([
      "the grant's own timestamp not-a-time is not an ISO instant, so its access token's expiry cannot be recorded",
    ]);
  });

  it("stores the NARROWER approved set and warns per withheld scope when consent was trimmed", async () => {
    const captured = fakeDeps({ grantedScope: `${GMAIL_SCOPES.identity} ${GMAIL_SCOPES.read}` });
    const code = await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.persisted[0]!.scopes).toStrictEqual([GMAIL_SCOPES.identity, GMAIL_SCOPES.read]);
    expect(captured.diagnostics).toStrictEqual([
      `this grant does NOT carry ${GMAIL_SCOPES.modify} — the verbs needing it will refuse`,
      `this grant does NOT carry ${GMAIL_SCOPES.docs} — the verbs needing it will refuse`,
    ]);
  });

  it("refuses a grant with no refresh token, and says how to clear the prior grant", async () => {
    const captured = fakeDeps({ noRefreshToken: true });
    const code = await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.persisted).toStrictEqual([]);
    expect(captured.diagnostics[0]).toContain("myaccount.google.com/permissions");
  });

  it("reports a failed consent round trip and stores nothing", async () => {
    const captured = fakeDeps({ consentFails: true });
    const code = await runConnect({ deps: captured.deps, rest: ["--home", "/tmp/h"] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.persisted).toStrictEqual([]);
    expect(captured.diagnostics[0]).toContain("consent window closed");
  });

  it("refuses an unknown grant name without starting a flow", async () => {
    const captured = fakeDeps();
    const code = await runConnect({ deps: captured.deps, rest: ["--grant", "everything"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
  });
});

describe("runGoogleConnect --revoke", () => {
  it("withdraws the stored grant and NEVER starts a consent flow", async () => {
    const captured = fakeDeps({ stored: { account: "me@example.test", scopes: [GMAIL_SCOPES.read] } });
    const code = await runConnect({ deps: captured.deps, rest: ["--revoke", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_OK);
    expect(captured.calls).toStrictEqual(["revoke:/tmp/h"]);
    expect(captured.out.join("\n")).toContain("withdrew the grant for me@example.test");
  });

  it("says the withdrawal takes every door sharing the OAuth client, because Google's does", async () => {
    const captured = fakeDeps({ stored: { account: "me@example.test", scopes: [GMAIL_SCOPES.read] } });
    await runConnect({ deps: captured.deps, rest: ["--revoke", "--home", "/tmp/h"] });
    expect(captured.out.join("\n")).toContain("every door sharing this OAuth client");
  });

  it("reports nothing-to-revoke as a FINDING exit code rather than as a fault", async () => {
    const captured = fakeDeps();
    const code = await runConnect({ deps: captured.deps, rest: ["--revoke", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(captured.out).toStrictEqual(["gmail: nothing to revoke"]);
  });

  it("emits a machine-readable document naming the account and the deleted file", async () => {
    const captured = fakeDeps({ stored: { account: "me@example.test", scopes: [GMAIL_SCOPES.read] } });
    await runConnect({ deps: captured.deps, rest: ["--revoke", "--json", "--home", "/tmp/h"] });
    expect(JSON.parse(captured.out[0]!)).toStrictEqual({
      account: "me@example.test",
      path: "/tmp/h/secrets/gmail-oauth.json",
      revoked: true,
    });
  });

  it("reports a refused revocation and exits an error", async () => {
    const captured = fakeDeps({ revokeFails: true, stored: { account: "me@example.test", scopes: [] } });
    const code = await runConnect({ deps: captured.deps, rest: ["--revoke", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics).toStrictEqual(["Google refused the revocation"]);
  });

  it("refuses --status and --revoke together without touching either seam", async () => {
    const captured = fakeDeps({ stored: { account: "me@example.test", scopes: [] } });
    const code = await runConnect({ deps: captured.deps, rest: ["--status", "--revoke", "--home", "/tmp/h"] });
    expect(code).toBe(EXIT_USAGE);
    expect(captured.calls).toStrictEqual([]);
    expect(captured.diagnostics[0]).toContain("--status and --revoke ask for opposite things");
  });
});
