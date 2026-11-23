/**
 * The outbound privacy check at the Slack write transport, through the real guarded `WebClient` and a real
 * private-terms file under a throwaway home. The client's own `fetch` option is a counting seam rather than a mock,
 * so a refused write is seen to send nothing and a clean one to send exactly once.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { WebClientOptions } from "@slack/web-api";
import { afterEach, describe, expect, it } from "vitest";

import { GuardedWebClient } from "../../../../corpus/slack/guardedWebClient.js";
import { PRIVATE_TERMS_HEADER_V2 } from "../../../../hygiene/privateTerms.js";
import { classifySendFailure } from "../../../../outbound/slack/sendFailure.js";
import { SlackPrivacyRefusedError, slackWritePrivacy } from "../../../../outbound/slack/writePrivacy.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { writePrivateTerms } from "../../../privateTermsFixture.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** A throwaway home, its private-terms file holding `rows`, or absent when `rows` is undefined. */
function homeWith({ rows }: { rows: readonly string[] | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "slack-write-privacy-"));
  homes.push(home);
  if (rows !== undefined) {
    writePrivateTerms({ home, rows });
  }
  return home;
}

/** A guarded client over one home whose every request goes to a fetch that answers `ok` and counts. */
function countingClient({ home, token = "xoxb-not-a-real-token" }: { home: string; token?: string }): {
  readonly client: GuardedWebClient;
  readonly calls: () => number;
} {
  let calls = 0;
  const fetch: NonNullable<WebClientOptions["fetch"]> = async () => {
    calls += 1;
    return new Response(JSON.stringify({ channel: "C0FIXTURE", ok: true, ts: "1700000000.000100" }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };
  const client = new GuardedWebClient({
    options: { fetch, retryConfig: { retries: 0 } },
    privacy: slackWritePrivacy({ home }),
    token,
  });
  return { calls: () => calls, client };
}

const PERSON = ["person\ti\tquillfeather\tsynthetic"];

describe("the Slack write transport's privacy guard", () => {
  it("refuses a message whose block text carries a private term before any request, naming field and class only", async () => {
    const { calls, client } = countingClient({ home: homeWith({ rows: PERSON }) });
    const sent = client.chat.postMessage({
      blocks: [{ text: { text: "ok\nthanks Quillfeather", type: "mrkdwn" }, type: "section" }],
      channel: "C0FIXTURE",
      text: "ok",
    });
    await expect(sent).rejects.toThrow(SlackPrivacyRefusedError);
    await expect(sent).rejects.toThrow(
      "slack chat.postMessage blocks[0].text.text line 2: a private person term (redacted here)",
    );
    await expect(sent).rejects.not.toThrow(/quillfeather/iu);
    expect(calls()).toBe(0);
  });

  it("is read as refused before the wire, so a send reservation is released", async () => {
    const { client } = countingClient({ home: homeWith({ rows: PERSON }) });
    const thrown = await client.chat
      .postMessage({ channel: "C0FIXTURE", text: "for quillfeather" })
      .catch((error: unknown) => error);
    expect(classifySendFailure({ error: thrown })).toEqual({ kind: "refused-before-wire" });
  });

  it("sends a clean message exactly once", async () => {
    const { calls, client } = countingClient({ home: homeWith({ rows: PERSON }) });
    const sent = await client.chat.postMessage({ channel: "C0FIXTURE", text: "the build is green" });
    expect(sent.ts).toBe("1700000000.000100");
    expect(calls()).toBe(1);
  });

  it("judges a method nobody listed as a read, so a new write cannot slip past", async () => {
    const { calls, client } = countingClient({ home: homeWith({ rows: PERSON }) });
    await expect(client.apiCall("acme.future.write", { note: "for quillfeather" })).rejects.toThrow(
      "slack acme.future.write note line 1: a private person term",
    );
    expect(calls()).toBe(0);
  });

  it("refuses a text upload whose bytes carry a term before asking Slack for an upload address", async () => {
    const { calls, client } = countingClient({ home: homeWith({ rows: PERSON }) });
    const sent = client.filesUploadV2({
      channel_id: "C0FIXTURE",
      file: Buffer.from("notes for quillfeather"),
      filename: "notes.txt",
    });
    await expect(sent).rejects.toThrow("slack files.uploadV2 file line 1: a private person term");
    expect(calls()).toBe(0);
  });

  it("refuses every write when the private-terms file is absent, and still sends a read", async () => {
    const { calls, client } = countingClient({ home: homeWith({ rows: undefined }) });
    await expect(client.chat.postMessage({ channel: "C0FIXTURE", text: "clean" })).rejects.toThrow(
      "does not exist, so no outbound write is checked for them",
    );
    await client.conversations.info({ channel: "C0FIXTURE" });
    expect(calls()).toBe(1);
  });

  it("holds the same message to the same channel id under another hold for a token of another workspace", async () => {
    const home = homeWith({ rows: undefined });
    mkdirSync(dirname(stateHomePaths({ home }).privateTerms), { recursive: true });
    writeFileSync(
      stateHomePaths({ home }).privateTerms,
      `${PRIVATE_TERMS_HEADER_V2}\npt-00000000000a\tperson\ti\tquillfeather\ta synthetic colleague\t\trelay:acme-row\n`,
      { mode: 0o600 },
    );
    const heldAs = async ({ token }: { token: string }) => {
      const { calls, client } = countingClient({ home, token });
      const thrown = await client.chat
        .postMessage({ channel: "C0FIXTURE", text: "for quillfeather" })
        .catch((error: unknown) => error);
      expect(calls()).toBe(0);
      expect(thrown).toBeInstanceOf(SlackPrivacyRefusedError);
      return (thrown as SlackPrivacyRefusedError).message;
    };
    const first = await heldAs({ token: "xoxb-not-a-real-token-a" });
    const again = await heldAs({ token: "xoxb-not-a-real-token-a" });
    const other = await heldAs({ token: "xoxb-not-a-real-token-b" });
    expect(first).toContain("held");
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("refuses a later write once the private-terms file is gone, never reusing an earlier load", async () => {
    const home = homeWith({ rows: PERSON });
    const { calls, client } = countingClient({ home });
    await client.chat.postMessage({ channel: "C0FIXTURE", text: "clean" });
    rmSync(join(home, "hygiene", "private-terms.tsv"));
    await expect(client.chat.postMessage({ channel: "C0FIXTURE", text: "clean" })).rejects.toThrow(
      "does not exist, so no outbound write is checked for them",
    );
    expect(calls()).toBe(1);
  });
});
