/**
 * Unit: the rails the owner named on the Google doors — what these credentials may never be able to do.
 *
 * Two are standing rails: nothing may send emails as other people, and nothing may hold a scope that
 * allows wiping company drives. Two more split what the doors may ask for: the owner's own mail, drive,
 * docs and calendar may be written, while everything on the Google admin side is read-only — and the
 * mechanism that carries it: the admin door consents through its OWN OAuth client, and no consent URL asks
 * Google to merge previously granted scopes.
 *
 * Each is verified against the live grant. This file is what stops that verification being
 * a one-off observation: a rail checked once is a rail that quietly breaks, and none of these failures would
 * announce itself. The checks read SOURCE rather than behaviour on purpose — what makes sending as someone
 * else impossible is the absence of a construction, and an absence has no call to observe.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DRIVE_SCOPES } from "../../../../live/drive/scopes.js";
import { GOOGLE_ADMIN_SCOPES } from "../../../../live/googleAdmin/scopes.js";
import { GOOGLE_SECOPS_SCOPE_TABLE } from "../../../../live/googleSecops/scopes.js";

/** Every Google door's source, read once — these are checks about what the code CANNOT do. */
function googleDoorSources(): readonly { readonly path: string; readonly text: string }[] {
  const roots = [
    "src/live/google",
    "src/live/gmail",
    "src/live/drive",
    "src/live/calendar",
    "src/live/googleAdmin",
    "src/live/googleSecops",
  ];
  return roots.flatMap((root) =>
    readdirSync(root)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({ path: join(root, name), text: readFileSync(join(root, name), "utf8") })),
  );
}

describe("nothing here can act as another person", () => {
  it("constructs no service-account or JWT client, which is the only way to impersonate", () => {
    // Domain-wide delegation needs a service-account JWT carrying a `subject`. An OAuth2Client built from a
    // user's own refresh token cannot express one, so the rail holds by construction rather than by policy.
    const offenders = googleDoorSources().filter(({ text }) =>
      /new\s+JWT\b|GoogleAuth\(|setSubject\(|client_email|private_key/.test(text),
    );
    expect(offenders.map(({ path }) => path)).toStrictEqual([]);
  });

  it("addresses every Gmail call to the authenticated user and never to a named mailbox", () => {
    const gmail = googleDoorSources().filter(({ path }) => path.includes("/gmail/"));
    const addressed = gmail.flatMap(({ path, text }) =>
      // Capture the VALUE only — a string literal or a bare identifier — so a single-line call does not
      // drag its closing brace into the comparison and turn a passing check into a false failure.
      [...text.matchAll(/userId:\s*("[^"]*"|[A-Za-z_$][\w$.]*)/g)].map((match) => ({
        path,
        value: match[1]!,
      })),
    );
    expect(addressed.length).toBeGreaterThan(0);
    expect(addressed.filter((entry) => entry.value !== '"me"')).toStrictEqual([]);
  });

  it("stores a grant shape that has nowhere to put an impersonated subject", () => {
    const store = readFileSync("src/secrets/googleGrant.ts", "utf8");
    expect(/readonly subject\b|readonly sub\b|impersonat/i.test(store)).toBe(false);
  });
});

describe("nothing here can wipe a drive", () => {
  it("declares exactly the Drive scopes it is allowed to, so a wider one fails a test rather than a review", () => {
    // Asserted as an exact SET rather than as a filter with an exemption, because a filter phrased as "any
    // scope that is not this one" admits the next wide scope somebody adds. `drive.file` is the only
    // non-readonly member and it is per-file: it reaches only what this application created or the owner
    // explicitly opened with it, so it can create what the owner asked for and cannot touch a shared drive.
    // `https://www.googleapis.com/auth/drive` — the one that CAN wipe a company drive — is what this
    // assertion exists to keep out.
    const driveScopes = Object.values(DRIVE_SCOPES)
      .filter((scope) => scope.includes("/drive"))
      .toSorted();
    expect(driveScopes).toStrictEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ]);
  });

  it("declares no Google Admin scope that is not read-only, beside the account binding", () => {
    const writable = Object.entries(GOOGLE_ADMIN_SCOPES)
      .filter(([capability]) => capability !== "identity")
      .map(([, scope]) => scope)
      .filter((scope) => !scope.endsWith(".readonly"));
    expect(writable).toStrictEqual([]);
  });
});

describe("the admin door and the user-data doors consent through DIFFERENT OAuth clients", () => {
  it("resolves the admin client in the admin door, and never the user-data one", () => {
    // Google merges granted scopes over the (client, account) pair, so separation is a second client and
    // cannot be a check in this repository's code. A fallback to `googleClientId` here would put
    // administrator scopes back on the client that can write, which is the defect this rail closes.
    //
    // BOTH files, because the split has two halves and only one of them is the consent screen: the API
    // client exchanges the refresh token on every call, and a refresh token is redeemable by exactly one
    // client, so reading the user-data pair there would either fail every refresh or — worse, on a grant
    // minted before the split — quietly keep the merged credential alive.
    const doors = ["src/cli/commands/atlas/googleAdmin/connectRun.ts", "src/live/googleAdmin/client.ts"];
    const offenders = doors.filter((path) => {
      const source = readFileSync(path, "utf8");
      const namesAdmin = source.includes("googleAdminClientId") && source.includes("googleAdminClientSecret");
      return !namesAdmin || /\bgoogleClientId\(/.test(source) || /\bgoogleClientSecret\(/.test(source);
    });
    expect(offenders).toStrictEqual([]);
  });

  it("refuses, in the admin connect, an admin id that is the user-data client under another name", () => {
    // The split above can hold in code while it collapses on disk: a `google-admin-client-id`
    // byte-identical to `google-client-id`. Reading both names is not separation, so the connect verb
    // must compare them — through the one helper that can see the user-data id without consenting with it.
    const source = readFileSync("src/cli/commands/atlas/googleAdmin/connectRun.ts", "utf8");
    expect(source.includes("googleAdminClientSharesUserDataClient({ home })")).toBe(true);
  });

  it("resolves the user-data client in each user-data door, and never the admin one", () => {
    const doors = [
      "src/cli/commands/gmail/connectRun.ts",
      "src/cli/commands/drive/connectRun.ts",
      "src/cli/commands/calendar/connectRun.ts",
    ];
    const offenders = doors.filter((path) => {
      const source = readFileSync(path, "utf8");
      return !source.includes("googleClientId") || source.includes("googleAdminClientId");
    });
    expect(offenders).toStrictEqual([]);
  });
});

describe("the SecOps door is a THIRD client, asking for chronicle.readonly and nothing wider", () => {
  it("declares exactly the account binding and chronicle.readonly — the owner's pick", () => {
    // An exact set, for the Drive assertion's reason: "every scope ends .readonly" would still admit a
    // second readonly scope nobody chose, and `cloud-platform` — which the owner declined as wider than least
    // privilege — would be the next one somebody reaches for to unblock the 18 GETs it alone opens.
    expect(Object.values(GOOGLE_SECOPS_SCOPE_TABLE.scopes).toSorted()).toStrictEqual([
      "https://www.googleapis.com/auth/chronicle.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
  });

  it("resolves the SecOps client in the SecOps door, and never the admin or user-data one", () => {
    // Every file in the door, for the admin twin's reason: the consent and the refresh each pick a client,
    // and a refresh token is redeemable by exactly one.
    const doors = ["src/cli/commands/atlas/googleSecops/connectRun.ts", "src/live/googleSecops/client.ts"];
    const offenders = doors.filter((path) => {
      const source = readFileSync(path, "utf8");
      const namesSecops = source.includes("secopsClientPairIn") || source.includes("googleSecopsClientSecret");
      return (
        !namesSecops ||
        /\bgoogleClientId\(|\bgoogleClientSecret\(|\bgoogleAdminClientId\(|\bgoogleAdminClientSecret\(/.test(source)
      );
    });
    expect(offenders).toStrictEqual([]);
  });

  it("compares the SecOps id against BOTH other clients before it consents, refreshes or revokes", () => {
    const source = readFileSync("src/live/googleSecops/client.ts", "utf8");
    expect(source.includes("sharesAnotherClient: googleSecopsClientSharesAnotherClient({ home })")).toBe(true);
  });
});

describe("no consent URL asks Google to merge previously granted scopes", () => {
  it("names include_granted_scopes nowhere it could be set on a request", () => {
    // Its presence lets a grant carry write scopes its consent screen never showed. The header
    // of `oauth.ts` argues the absence at length, so the parameter appears there as PROSE — this check
    // therefore reads the code below the header rather than the file, and fails on any `searchParams` line.
    const offenders = googleDoorSources().filter(({ text }) =>
      /searchParams[\s\S]{0,40}include_granted_scopes/.test(text),
    );
    expect(offenders.map(({ path }) => path)).toStrictEqual([]);
  });
});
