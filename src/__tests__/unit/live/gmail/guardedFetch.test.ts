/**
 * The Gmail write guard at the transport, through the REAL pinned `@googleapis/gmail` client that `guardedGmailSdk`
 * builds and a real private-terms file under a throwaway home. The `fetch` under the guard is a counting seam
 * (`../../../gmailTransportFixture.ts`), not a mock: it records exactly what the SDK emitted, so the read allowlist is
 * asserted against the pinned SDK's real requests, a refused write is seen to send nothing, a clean one to send once,
 * and a send to re-read its draft first. The auth fixture carries a cached access token expiring in 2100, so no token
 * refresh can enter the count. Synthetic terms: `quillfeather` is the private person term.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "googleapis-common";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type GmailApi, makeGmailApi } from "../../../../live/gmail/api.js";
import { guardedGmailSdk } from "../../../../live/gmail/client.js";
import { guardedGmailFetch } from "../../../../live/gmail/guardedFetch.js";
import { refusedBeforeGmailWire } from "../../../../outbound/gmail/sendFailure.js";
import { gmailWritePrivacy } from "../../../../outbound/gmail/writePrivacy.js";
import { countingGmailTransport, type SentGmailRequest } from "../../../gmailTransportFixture.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "gmail-guarded-fetch-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];
const HOST = "gmail.googleapis.com/gmail/v1/users/me";
/** The metadata headers the door asks for, as the pinned SDK spells them on the wire. */
const METADATA = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "List-Id",
  "List-Unsubscribe",
  "List-Unsubscribe-Post",
  "List-Post",
]
  .map((header) => `metadataHeaders=${header}`)
  .join("&");

/** A message's text as Gmail's `raw` carries it. */
const raw = ({ text }: { text: string }): string => Buffer.from(text, "utf8").toString("base64url");

/** The real Gmail seam over the guarded SDK, judging under `home`, sending into a counting transport. */
function guardedApi({
  home,
  transport,
}: {
  home: string;
  transport: ReturnType<typeof countingGmailTransport>["transport"];
}): GmailApi {
  const auth = new OAuth2Client({ clientId: "client-id", clientSecret: "client-secret" });
  auth.setCredentials({ access_token: "at-fixture", expiry_date: 4_102_444_800_000 });
  return makeGmailApi({
    account: "owner@acme.test",
    client: guardedGmailSdk({ account: "owner@acme.test", auth, home, transport }),
  });
}

/** Every route that reached the transport, in order. */
const routes = ({ sent }: { sent: readonly SentGmailRequest[] }): readonly string[] => sent.map((one) => one.route);

/** Drive every read the door makes. */
async function everyRead({ api }: { api: GmailApi }): Promise<readonly boolean[]> {
  return [
    (await api.listMessageIds({ labelIds: ["INBOX"], limit: 5, pageToken: "p", query: "is:unread" })).isOk(),
    (await api.getMessage({ format: "metadata", id: "m1" })).isOk(),
    (await api.getMessage({ format: "full", id: "m1" })).isOk(),
    (await api.getAttachment({ attachmentId: "a1", messageId: "m1" })).isOk(),
    (await api.getThread({ format: "metadata", id: "t1" })).isOk(),
    (await api.listLabels()).isOk(),
    (await api.getProfile()).isOk(),
    (await api.listHistory({ pageToken: "q", startHistoryId: "5" })).isOk(),
    (await api.getDraft({ id: "d1" })).isOk(),
  ];
}

describe("the routes the pinned SDK emits", () => {
  it("sends every read with no private-terms file at all, so no read ever loads the policy", async () => {
    const { sent, transport } = countingGmailTransport();
    const api = guardedApi({ home: homeWith({ rows: undefined }), transport });
    expect(await everyRead({ api })).toEqual([true, true, true, true, true, true, true, true, true]);
    expect(routes({ sent })).toEqual([
      `GET ${HOST}/messages?maxResults=5&labelIds=INBOX&q=is%3Aunread&pageToken=p`,
      `GET ${HOST}/messages/m1?format=metadata&${METADATA}`,
      `GET ${HOST}/messages/m1?format=full`,
      `GET ${HOST}/messages/m1/attachments/a1`,
      `GET ${HOST}/threads/t1?format=metadata&${METADATA}`,
      `GET ${HOST}/labels`,
      `GET ${HOST}/profile`,
      `GET ${HOST}/history?historyTypes=messageAdded&startHistoryId=5&pageToken=q`,
      `GET ${HOST}/drafts/d1?format=full`,
    ]);
  });

  it("sends every write on exactly these routes once judged, the send after its raw re-read", async () => {
    const { sent, transport } = countingGmailTransport();
    const api = guardedApi({ home: homeWith({ rows: PERSON }), transport });
    const change = { addLabelIds: ["STARRED"], id: "m1", removeLabelIds: ["UNREAD"] };
    expect((await api.modifyMessage(change)).isOk()).toBe(true);
    expect((await api.modifyThread({ ...change, id: "t1" })).isOk()).toBe(true);
    expect((await api.createDraft({ raw: raw({ text: "Subject: hi\r\n\r\nclean\r\n" }) })).isOk()).toBe(true);
    expect((await api.sendDraft({ id: "d1" })).isOk()).toBe(true);
    expect(routes({ sent })).toEqual([
      `POST ${HOST}/messages/m1/modify`,
      `POST ${HOST}/threads/t1/modify`,
      `POST ${HOST}/drafts`,
      `GET ${HOST}/drafts/d1?format=raw`,
      `POST ${HOST}/drafts/send`,
    ]);
    expect(sent[3]!.authorization).toBe("Bearer at-fixture");
    expect(sent[4]!.body).toBe('{"id":"d1"}');
  });
});

describe("a refused write sends nothing", () => {
  it("refuses a draft whose decoded subject carries a private term, naming locus and class only", async () => {
    const { sent, transport } = countingGmailTransport();
    const api = guardedApi({ home: homeWith({ rows: PERSON }), transport });
    const result = await api.createDraft({ raw: raw({ text: "Subject: =?utf-8?q?for_Quillfeather?=\r\n\r\nb\r\n" }) });
    const error = unwrapErr(result);
    expect(error.message).toContain(
      "gmail drafts.create message.raw subject line 1: a private person term (redacted here)",
    );
    expect(error.message).not.toMatch(/quillfeather/iu);
    expect(refusedBeforeGmailWire({ error })).toBe(true);
    expect(sent).toEqual([]);
  });

  it("refuses a label change and a thread change when the home holds no private-terms file", async () => {
    const { sent, transport } = countingGmailTransport();
    const api = guardedApi({ home: homeWith({ rows: undefined }), transport });
    const change = { addLabelIds: ["STARRED"], id: "m1", removeLabelIds: [] };
    expect(unwrapErr(await api.modifyMessage(change)).message).toContain("does not exist");
    expect(unwrapErr(await api.modifyThread(change)).message).toContain("gmail threads.modify refused before sending");
    expect(sent).toEqual([]);
  });

  it("refuses a dead Datadog host in a draft body first, even with no private-terms file", async () => {
    const { sent, transport } = countingGmailTransport();
    const api = guardedApi({ home: homeWith({ rows: undefined }), transport });
    const text = "Subject: monitor\r\n\r\nsee https://app.ap1.datadoghq.com/monitors/1000001\r\n";
    const error = unwrapErr(await api.createDraft({ raw: raw({ text }) }));
    expect(error.message).toContain("blocked because");
    expect(error.message).not.toContain("does not exist");
    expect(refusedBeforeGmailWire({ error })).toBe(true);
    expect(sent).toEqual([]);
  });

  it("refuses a byte, Blob or Request body that is not valid UTF-8 rather than judging a replacement", async () => {
    const { sent, transport } = countingGmailTransport();
    const guarded = guardedGmailFetch({
      fetch: transport,
      privacy: gmailWritePrivacy({ home: homeWith({ rows: PERSON }) }),
    });
    const bytes = Uint8Array.from([...Buffer.from('{"addLabelIds":["', "utf8"), 0xff, ...Buffer.from('"]}', "utf8")]);
    const url = `https://${HOST}/messages/m1/modify`;
    const why = "a request body that is not valid UTF-8";
    await expect(guarded(url, { body: bytes, method: "POST" })).rejects.toThrow(why);
    await expect(guarded(url, { body: new Blob([bytes]), method: "POST" })).rejects.toThrow(why);
    await expect(guarded(new Request(url, { body: bytes, method: "POST" }))).rejects.toThrow(why);
    expect(sent).toEqual([]);
  });

  it("refuses a later write once the private-terms file is gone, never reusing an earlier load", async () => {
    const home = homeWith({ rows: PERSON });
    const { sent, transport } = countingGmailTransport();
    const api = guardedApi({ home, transport });
    const change = { addLabelIds: ["STARRED"], id: "m1", removeLabelIds: [] };
    expect((await api.modifyMessage(change)).isOk()).toBe(true);
    rmSync(join(home, "private-terms.tsv"), { force: true });
    writePrivateTerms({ home, rows: ["person\ti\tstarred\tsynthetic"] });
    expect(unwrapErr(await api.modifyMessage(change)).message).toContain("a private person term");
    expect(routes({ sent })).toEqual([`POST ${HOST}/messages/m1/modify`]);
  });
});

describe("a send is judged on the draft Gmail holds", () => {
  it("re-reads the draft and sends nothing when it now carries a private term", async () => {
    const { sent, transport } = countingGmailTransport({ draftText: "Subject: hi\r\n\r\nedited for quillfeather\r\n" });
    const api = guardedApi({ home: homeWith({ rows: PERSON }), transport });
    const error = unwrapErr(await api.sendDraft({ id: "d1" }));
    expect(error.message).toContain("gmail drafts.send draft.raw text line 1: a private person term");
    expect(refusedBeforeGmailWire({ error })).toBe(true);
    expect(routes({ sent })).toEqual([`GET ${HOST}/drafts/d1?format=raw`]);
  });

  it("sends nothing when the re-read fails, answers no raw, a malformed one, or a shape the SDK does not declare", async () => {
    for (const [fixture, why] of [
      [{ reReadStatus: 404 }, "Gmail answered HTTP 404"],
      [{ rawAnswer: null }, "the draft re-read before sending carried no message.raw"],
      [{ rawAnswer: "not+base64url" }, "a raw message that is not base64url"],
      [
        { reReadBody: { id: "d1", message: { id: "m1", payload: {}, raw: "aGk" } } },
        "GET gmail users.drafts.get format=raw answered a shape this version does not read",
      ],
    ] as const) {
      const { sent, transport } = countingGmailTransport(fixture);
      const api = guardedApi({ home: homeWith({ rows: PERSON }), transport });
      const error = unwrapErr(await api.sendDraft({ id: "d1" }));
      expect(error.message).toContain(why);
      expect(routes({ sent })).toEqual([`GET ${HOST}/drafts/d1?format=raw`]);
    }
  });
});

describe("what the guard lets through untouched", () => {
  it("passes OAuth, Docs and other non-Gmail traffic, a private term in it or not, without a policy", async () => {
    const { sent, transport } = countingGmailTransport();
    const guarded = guardedGmailFetch({
      fetch: transport,
      privacy: gmailWritePrivacy({ home: homeWith({ rows: undefined }) }),
    });
    await guarded(new URL("https://oauth2.googleapis.com/token"), { body: "quillfeather", method: "POST" });
    await guarded("https://docs.googleapis.com/v1/documents/d1", { method: "GET" });
    expect(routes({ sent })).toEqual(["POST oauth2.googleapis.com/token", "GET docs.googleapis.com/v1/documents/d1"]);
  });

  it("takes a Gmail GET nobody listed as a read down the write path", async () => {
    const { sent, transport } = countingGmailTransport();
    const guarded = guardedGmailFetch({
      fetch: transport,
      privacy: gmailWritePrivacy({ home: homeWith({ rows: undefined }) }),
    });
    await expect(guarded(`https://${HOST}/settings/filters`, { method: "GET" })).rejects.toThrow(
      "gmail GET /gmail/v1/users/me/settings/filters refused before sending",
    );
    expect(sent).toEqual([]);
  });

  it("never judges a response, so a read answering with a private term still reads", async () => {
    const { transport } = countingGmailTransport();
    const api = guardedApi({ home: homeWith({ rows: PERSON }), transport });
    expect(unwrap(await api.getProfile()).emailAddress).toBe("owner@acme.test");
  });
});
