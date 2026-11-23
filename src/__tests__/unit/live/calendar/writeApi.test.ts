/**
 * The outbound privacy check at the Calendar write seam, through the real `makeCalendarWriteApi` over a real
 * `@googleapis/calendar` client and a real private-terms file under a throwaway home. The auth client's transport
 * `fetch` is a counting seam rather than a mock, so a refused mutation is seen to send nothing and a clean one to
 * send exactly once.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { calendar } from "@googleapis/calendar";
import { afterEach, describe, expect, it } from "vitest";

import { FORBIDDEN_IDENTIFIER_RULES } from "../../../../hygiene/forbiddenIdentifiers.js";
import { PRIVATE_TERMS_HEADER_V2 } from "../../../../hygiene/privateTerms.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { makeCalendarWriteApi } from "../../../../live/calendar/writeApi.js";
import { makeGoogleAuthClient } from "../../../../live/google/authClient.js";
import { type CalendarWritePrivacy, calendarWritePrivacy } from "../../../../outbound/calendar/writePrivacy.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { absentPrivateTermsRefusal, writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "calendar-write-privacy-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];

// The address one transport call names, whichever of fetch's three input shapes carried it.
function urlOf({ input }: { input: Parameters<typeof fetch>[0] }): string {
  if (input instanceof Request) {
    return input.url;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input;
}

/** One request the counting transport saw. */
interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

/** A real Calendar write API over `privacy`, every request answered by a counting `fetch` that never leaves the process. */
function countingApi({ privacy, account = "owner@acme.test" }: { privacy: CalendarWritePrivacy; account?: string }) {
  const sent: SentRequest[] = [];
  const auth = makeGoogleAuthClient({
    clientId: "client-id",
    clientSecret: "client-secret",
    // A token valid far past any run, so the client never asks for a refresh.
    grant: {
      accessToken: "at-1",
      account: "owner@acme.test",
      expiryMs: 4_102_444_800_000,
      grantedAtIso: "2026-11-20T00:00:00.000Z",
      refreshToken: "rt-1",
      scopes: [],
    },
    persist: () => ok("unused"),
  });
  const transport: typeof fetch = async (input, init) => {
    const body = init?.body;
    const method = init?.method;
    sent.push({
      body: typeof body === "string" ? body : undefined,
      method: typeof method === "string" ? method : "GET",
      url: urlOf({ input }),
    });
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ id: "evt1", summary: "acme sync" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  auth.transporter.defaults.fetchImplementation = transport;
  const api = makeCalendarWriteApi({
    account,
    client: calendar({ auth, version: "v3" }),
    privacy,
  });
  return { api, sent };
}

/** A capability over a fixed sequence of policy answers, counting how often it was asked. */
function sequencedPrivacy({ answers }: { answers: readonly ("clean" | "broken")[] }) {
  let asked = 0;
  const privacy: CalendarWritePrivacy = {
    resolve: () => {
      const answer = answers[asked];
      asked += 1;
      if (answer === "broken") {
        return Promise.resolve(err("the private terms file for acme could not be read"));
      }
      return Promise.resolve(ok({ denylist: [], identifierRules: FORBIDDEN_IDENTIFIER_RULES, privateTerms: [] }));
    },
  };
  return { asked: () => asked, privacy };
}

const PATCH_TARGET = { calendarId: "primary", conferenceDataVersion: 0, etag: '"e1"', eventId: "evt1" } as const;

describe("the Calendar write seam's privacy guard", () => {
  it.each([
    ["summary", { summary: "lunch with Quillfeather" }],
    ["description", { description: "ask quillfeather about the plan" }],
    ["location", { location: "Quillfeather's office" }],
    ["attendees[0].email", { attendees: [{ email: "quillfeather@acme.test" }] }],
  ])("refuses an insert whose %s carries a private term before any request", async (path, body) => {
    const { api, sent } = countingApi({ privacy: calendarWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const error = unwrapErr(
      await api.insertEvent({ body, calendarId: "primary", conferenceDataVersion: 0, sendUpdates: "all" }),
    );
    expect(error.code).toBe("PRIVACY_REFUSED");
    expect(error.message).toBe(
      [
        "calendar calendar.events.insert refused before sending: the outbound privacy check stopped it.",
        `  calendar calendar.events.insert ${path} line 1: a private person term (redacted here) — remove or generalise it, or if it is not private ask the chair to narrow that terms row`,
        "  the matched row(s) line-2 carry no meaning, so a match refuses outright; if the owner says what the term means, the chair records it with `slopweaver private-terms narrow <id> --meaning <words>` and a match is then held for a review in context",
        "  This is a refusal, with no override: reword the text, or repair the private terms file, then run the command again.",
      ].join("\n"),
    );
    expect(sent).toStrictEqual([]);
  });

  it("refuses a patch carrying a private term before any request", async () => {
    const { api, sent } = countingApi({ privacy: calendarWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const error = unwrapErr(
      await api.patchEvent({ ...PATCH_TARGET, body: { description: "for quillfeather" }, sendUpdates: "all" }),
    );
    expect(error.code).toBe("PRIVACY_REFUSED");
    expect(sent).toStrictEqual([]);
  });

  it("sends a clean insert exactly once, the body unchanged", async () => {
    const { api, sent } = countingApi({ privacy: calendarWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const event = unwrap(
      await api.insertEvent({
        body: { id: "abc123", summary: "acme sync" },
        calendarId: "primary",
        conferenceDataVersion: 0,
        sendUpdates: "all",
      }),
    );
    expect(event).toStrictEqual({ id: "evt1", summary: "acme sync" });
    expect(sent.map(({ method, body }) => ({ body, method }))).toStrictEqual([
      { body: JSON.stringify({ id: "abc123", summary: "acme sync" }), method: "POST" },
    ]);
  });

  it("refuses a top-level body id carrying a term when it is not door-minted, sending nothing", async () => {
    const { api, sent } = countingApi({ privacy: calendarWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    const error = unwrapErr(
      await api.insertEvent({
        body: { id: "quillfeather", summary: "acme sync" },
        calendarId: "primary",
        conferenceDataVersion: 0,
        sendUpdates: "all",
      }),
    );
    expect(error.code).toBe("PRIVACY_REFUSED");
    expect(sent).toStrictEqual([]);
  });

  it("judges no event id, ETag or calendar outside the body: a term only there still sends", async () => {
    const { api, sent } = countingApi({ privacy: calendarWritePrivacy({ home: homeWith({ rows: PERSON }) }) });
    unwrap(
      await api.patchEvent({
        body: { summary: "acme sync" },
        calendarId: "quillfeather",
        conferenceDataVersion: 0,
        etag: '"quillfeather"',
        eventId: "quillfeather",
        sendUpdates: "none",
      }),
    );
    expect(sent.length).toBe(1);
  });

  it("refuses insert, patch and delete alike when the private terms file is absent, sending nothing", async () => {
    const home = homeWith({ rows: undefined });
    const { api, sent } = countingApi({ privacy: calendarWritePrivacy({ home }) });
    const inserted = unwrapErr(
      await api.insertEvent({
        body: { summary: "acme sync" },
        calendarId: "primary",
        conferenceDataVersion: 0,
        sendUpdates: "all",
      }),
    );
    const patched = unwrapErr(await api.patchEvent({ ...PATCH_TARGET, body: { summary: "x" }, sendUpdates: "all" }));
    const deleted = unwrapErr(
      await api.deleteEvent({ calendarId: "primary", etag: '"e1"', eventId: "evt1", sendUpdates: "all" }),
    );
    expect([inserted.code, patched.code, deleted.code]).toStrictEqual([
      "PRIVACY_REFUSED",
      "PRIVACY_REFUSED",
      "PRIVACY_REFUSED",
    ]);
    expect(deleted.message).toContain(absentPrivateTermsRefusal({ home }));
    expect(sent).toStrictEqual([]);
  });

  it("loads the policy for a clean delete, which has nothing to judge, and then sends it once", async () => {
    const { asked, privacy } = sequencedPrivacy({ answers: ["clean"] });
    const { api, sent } = countingApi({ privacy });
    unwrap(await api.deleteEvent({ calendarId: "primary", etag: '"e1"', eventId: "evt1", sendUpdates: "none" }));
    expect(asked()).toBe(1);
    expect(sent.map(({ method }) => method)).toStrictEqual(["DELETE"]);
  });

  it("holds the same insert under another hold when the grant is bound to another account", async () => {
    const home = homeWith({ rows: undefined });
    mkdirSync(dirname(stateHomePaths({ home }).privateTerms), { recursive: true });
    writeFileSync(
      stateHomePaths({ home }).privateTerms,
      `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tquillfeather\ta synthetic colleague\t\trelay:acme-row\n`,
      { mode: 0o600 },
    );
    const insertAs = async ({ account }: { account: string }) => {
      const { api, sent } = countingApi({ account, privacy: calendarWritePrivacy({ home }) });
      const held = unwrapErr(
        await api.insertEvent({
          body: { id: "evt1", summary: "lunch with Quillfeather" },
          calendarId: "primary",
          conferenceDataVersion: 0,
          sendUpdates: "none",
        }),
      );
      expect(sent).toStrictEqual([]);
      return held.message;
    };
    const first = await insertAs({ account: "a@acme.test" });
    const again = await insertAs({ account: "a@acme.test" });
    const other = await insertAs({ account: "b@acme.test" });
    expect(first).toContain("held");
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("reads the policy afresh on every mutation: a policy that breaks after one write refuses the next", async () => {
    const { asked, privacy } = sequencedPrivacy({ answers: ["clean", "broken"] });
    const { api, sent } = countingApi({ privacy });
    const body = { summary: "acme sync" };
    unwrap(await api.insertEvent({ body, calendarId: "primary", conferenceDataVersion: 0, sendUpdates: "all" }));
    const second = unwrapErr(
      await api.insertEvent({ body, calendarId: "primary", conferenceDataVersion: 0, sendUpdates: "all" }),
    );
    expect(second.code).toBe("PRIVACY_REFUSED");
    expect(asked()).toBe(2);
    expect(sent.length).toBe(1);
  });
});
