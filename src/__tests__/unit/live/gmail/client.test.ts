/**
 * Binding the Gmail SDK to a stored grant, in an explicit temp home with no network call: an empty home is
 * NOT_CONNECTED, a grant without the read scope is SCOPE_MISSING naming gmail.readonly, a grant with no OAuth
 * client configured is CREDENTIAL_UNREADABLE in the Gmail door's own wording, and a complete one yields a
 * Gmail v1 surface whose refreshed token is written back to the same home. The bound client judges every write
 * under the SAME home it was resolved for: a clean draft sends under a home whose terms pass it, where the ambient
 * sandbox home (no terms file) would refuse it, and two homes holding different terms each refuse by their own class.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gmail_v1 } from "@googleapis/gmail";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { makeGmailApi } from "../../../../live/gmail/api.js";
import { resolveGmailClient } from "../../../../live/gmail/client.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import { gmailGrantStore } from "../../../../secrets/gmailGrant.js";
import { secretFilePath } from "../../../../stateHome.js";
import { connectGmailHome, countingGmailTransport } from "../../../gmailTransportFixture.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const READ = "https://www.googleapis.com/auth/gmail.readonly";
const SEND = "https://www.googleapis.com/auth/gmail.send";
const ENV_NAMES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;

let home: string;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gmail-client-"));
  for (const name of ENV_NAMES) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
  for (const name of ENV_NAMES) {
    const value = savedEnv.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

/** Store a Gmail grant carrying exactly these scopes. */
function storeGrant({ scopes }: { scopes: readonly string[] }): void {
  unwrap(
    gmailGrantStore.write({
      grant: { account: "owner@example.com", grantedAtIso: "2026-10-01T00:00:00.000Z", refreshToken: "rt-1", scopes },
      home,
    }),
  );
}

/** Configure the user-data OAuth client id and secret as home secret files. */
function storeClient(): void {
  for (const [name, value] of [
    ["google-client-id", "client-id"],
    ["google-client-secret", "client-secret"],
  ] as const) {
    const path = secretFilePath({ home, name });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value, { mode: 0o600 });
  }
}

describe("resolveGmailClient", () => {
  it("is NOT_CONNECTED on a home with no Gmail grant, naming the connect verb", () => {
    const error = unwrapErr(resolveGmailClient({ capabilities: ["read"], home }));

    expect(error.code).toBe("NOT_CONNECTED");
    expect(error.message).toBe("no Gmail grant stored for this home — run `slopweaver gmail connect`");
    expect(error).toEqual(GmailErrors.notConnected());
  });

  it("is SCOPE_MISSING naming gmail.readonly when a send-only grant is asked to read", () => {
    storeGrant({ scopes: [SEND] });

    const error = unwrapErr(resolveGmailClient({ capabilities: ["read"], home }));

    expect(error.code).toBe("SCOPE_MISSING");
    expect(error).toEqual(GmailErrors.scopeMissing({ missing: [READ] }));
  });

  it("is CREDENTIAL_UNREADABLE when the grant is fine but no OAuth client is configured", () => {
    storeGrant({ scopes: [READ] });

    const error = unwrapErr(resolveGmailClient({ capabilities: ["read"], home }));

    expect(error.code).toBe("CREDENTIAL_UNREADABLE");
    expect(error.message).toBe(
      "the Gmail OAuth client id/secret are not configured — run `slopweaver secrets set google-client-id` and " +
        "`slopweaver secrets set google-client-secret`",
    );
  });

  it("binds a Gmail v1 surface to the grant's account, scopes and refresh credential", () => {
    storeGrant({ scopes: [READ] });
    storeClient();

    const bound = unwrap(resolveGmailClient({ capabilities: ["read"], home }));

    expect(bound.account).toBe("owner@example.com");
    expect(bound.scopes).toEqual([READ]);
    expect(bound.auth.credentials).toEqual({ refresh_token: "rt-1" });
    expect(bound.client).toBeInstanceOf(gmail_v1.Gmail);
    // googleapis declares the bound auth on its request context's `_options`; matched structurally rather
    // than read as a member, so this pins the binding without reaching past the typed surface.
    expect(bound.client.context).toMatchObject({ _options: { auth: bound.auth } });
  });

  it("writes a refreshed access token back to the same home's Gmail grant", () => {
    storeGrant({ scopes: [READ] });
    storeClient();
    const bound = unwrap(resolveGmailClient({ capabilities: ["read"], home }));

    bound.auth.emit("tokens", { access_token: "at-2", expiry_date: 1_800_000_000_000 });

    expect(unwrap(gmailGrantStore.read({ home }))).toEqual({
      accessToken: "at-2",
      account: "owner@example.com",
      expiryMs: 1_800_000_000_000,
      grantedAtIso: "2026-10-01T00:00:00.000Z",
      refreshToken: "rt-1",
      scopes: [READ],
    });
  });
});

describe("resolveGmailClient judges every write under the VERB'S home, never the ambient one", () => {
  const COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
  const extraHomes: string[] = [];

  afterEach(() => {
    for (const made of extraHomes.splice(0)) {
      rmSync(made, { force: true, recursive: true });
    }
  });

  /**
   * A home of its own holding a compose grant with a cached token expiring in 2100 (so no refresh is ever sent), the
   * OAuth client, and a private-terms file of `rows`. The ambient sandbox home a test runs under holds none of these.
   */
  function connectedHome({ rows }: { rows: readonly string[] }): string {
    const made = mkdtempSync(join(tmpdir(), "gmail-verb-home-"));
    extraHomes.push(made);
    connectGmailHome({ home: made, scopes: [COMPOSE] });
    writePrivateTerms({ home: made, rows });
    return made;
  }

  /** Create one draft whose body is `text` through the client resolved for `home`, into a counting transport. */
  async function draftUnder({ home: verbHome, text }: { home: string; text: string }): Promise<{
    message: string;
    routes: readonly string[];
  }> {
    const { sent, transport } = countingGmailTransport();
    const bound = unwrap(resolveGmailClient({ capabilities: ["compose"], home: verbHome, transport }));
    const api = makeGmailApi({ account: bound.account, client: bound.client });
    const raw = Buffer.from(`Subject: note\r\n\r\n${text}\r\n`, "utf8").toString("base64url");
    const created = await api.createDraft({ raw });
    const message = created.match(
      () => "",
      (error) => error.message,
    );
    return { message, routes: sent.map((one) => one.route) };
  }

  it("sends a clean draft under the verb's home, which the ambient home, holding no terms file, would refuse", async () => {
    const { message, routes } = await draftUnder({
      home: connectedHome({ rows: ["person\ti\tquillfeather\tsynthetic"] }),
      text: "the build is green",
    });
    expect(message).toBe("");
    expect(routes).toEqual(["POST gmail.googleapis.com/gmail/v1/users/me/drafts"]);
  });

  it("refuses a draft by the verb's home's OWN terms, each home naming only its own class, sending nothing", async () => {
    const text = "for quillfeather at zorvane";
    const person = await draftUnder({ home: connectedHome({ rows: ["person\ti\tquillfeather\tsynthetic"] }), text });
    const organisation = await draftUnder({
      home: connectedHome({ rows: ["organisation\ti\tzorvane\tsynthetic"] }),
      text,
    });
    expect(person.routes).toEqual([]);
    expect(organisation.routes).toEqual([]);
    expect(person.message).toContain("gmail drafts.create message.raw text line 1: a private person term");
    expect(person.message).not.toContain("organisation term");
    expect(organisation.message).toContain("gmail drafts.create message.raw text line 1: a private organisation term");
    expect(organisation.message).not.toContain("person term");
  });
});
