/**
 * The SHIPPED `bin/slopweaver outlook …` verbs, end to end, against a loopback stand-in for Microsoft's token
 * endpoint and Graph (`fakeGraphServer.ts`). There is no Outlook account on this machine, so this is the proof
 * the door works as a whole: the real MSAL and Graph SDK, the real loopback consent, the real grant file and
 * door ledger, with only `fetch`'s destination changed by a preload in the spawned process.
 *
 * One home is connected once — through the consent round trip a person would make, the browser step answered
 * by this test — and every later case runs a verb against it. Each later verb therefore buys its token by
 * REFRESHING (the fake issues tokens under MSAL's refresh offset), which is what makes rotation observable.
 * Every value is synthetic; nothing here can reach a Microsoft host, because the preload refuses any host it
 * does not rewrite.
 *
 * Every write records its decision in the door ledger, a store table, so a case whose write the door admits
 * NEEDS a migrated store and fails, naming the variable, without one — never skips. CI's `subprocess` job runs a
 * Postgres service and migrates it with `store push` (`.github/workflows/ci.yml`); locally, point it at the same
 * throwaway proof database `integration/doorLedgerStore.test.ts` names. A refusal the door never reaches, every
 * read, and the consent round trip need no store:
 *
 *   DOOR_LEDGER_STORE_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/door_ledger_proof \
 *     yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/live/outlook/outlookCli.test.ts
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PREFER_READ, searchQuoted } from "../../../../live/outlook/apiCore.js";
import { UNREAD_NEWEST_FIRST } from "../../../../live/outlook/apiPaged.js";
import { outlookGrantPath } from "../../../../secrets/outlookGrant.js";
import { refuseLiveStore } from "../../../proofStoreUrl.js";
import { fetchRedirectSource } from "./fakeFetchRedirect.js";
import { ATTACHMENT_TEXT } from "./fakeGraphData.js";
import { type FakeGraphOptions, type FakeGraphServer, startFakeGraphServer } from "./fakeGraphServer.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const BIN = join(repoRoot, "bin", "slopweaver");
/** The throwaway proof store a door-admitted write records into; absent, those cases fail by name. */
const PROOF_URL = process.env["DOOR_LEDGER_STORE_PROOF_URL"];

/** Fail a door-admitted write case up front, naming what is missing, rather than as a door refusal mid-run. */
function requireProofStore(): void {
  if (PROOF_URL === undefined) {
    throw new Error(
      "DOOR_LEDGER_STORE_PROOF_URL is unset: this case's write is recorded in the door ledger, a store table, so it needs a migrated store (see this file's header)",
    );
  }
}

/** One spawned CLI run's outcome. */
interface CliRun {
  /** The exit code, or `null` when a signal ended the child, which every exact-code assertion then fails on. */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

let root: string;
let home: string;
let server: FakeGraphServer;
let preload: string;
let fakeBin: string;

/** The fake's behaviour, held by reference: a case flips one field around its own run and restores it. */
const options: FakeGraphOptions = {
  driftPatch: false,
  failSend: false,
  hasArchive: true,
  refuseThreadFilter: false,
  tokenDelayMs: 0,
};

/**
 * Run the shipped binary against the fake. `onOutput` sees everything printed so far on either stream, so a
 * test can answer a prompt (the consent URL) while the process is still running.
 */
function runCli({
  args,
  stdin = "",
  onOutput,
  hatches = {},
}: {
  args: readonly string[];
  stdin?: string;
  onOutput?: (args: { text: string }) => void;
  /** Escape hatches this one run opens, on top of the fixed environment. */
  hatches?: Readonly<Record<string, string>>;
}): Promise<CliRun> {
  const tmp = process.env["TMPDIR"];
  const child = spawn(BIN, [...args, "--home", home], {
    cwd: root,
    env: {
      HOME: root,
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      OUTLOOK_CLIENT_ID: "client-synthetic",
      PATH: `${fakeBin}:${process.env["PATH"]!}`,
      SLOPWEAVER_LAUNCHER_QUIET: "1",
      ...(PROOF_URL !== undefined ? { SLOPWEAVER_STORE_URL: PROOF_URL } : {}),
      ...(tmp !== undefined ? { TMPDIR: tmp } : {}),
      ...hatches,
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    onOutput?.({ text: stdout + stderr });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
    onOutput?.({ text: stdout + stderr });
  });
  child.stdin.end(stdin);
  return new Promise((done) => {
    child.on("close", (code) => {
      done({ code, stderr, stdout });
    });
  });
}

/** Answer the consent the way a browser would: follow the printed URL's redirect with a code and its state. */
function consentAnswerer(): { onOutput: (args: { text: string }) => void; answered: Promise<number> } {
  let resolveAnswered: (status: number) => void = () => undefined;
  const answered = new Promise<number>((resolveIt) => {
    resolveAnswered = resolveIt;
  });
  let sent = false;
  return {
    answered,
    onOutput: ({ text }) => {
      const printed = /https:\/\/login\.microsoftonline\.com\/\S+/u.exec(text);
      if (sent || printed === null) {
        return;
      }
      sent = true;
      const consent = new URL(printed[0]);
      const callback = new URL(consent.searchParams.get("redirect_uri")!);
      callback.searchParams.set("code", "code-synthetic");
      callback.searchParams.set("state", consent.searchParams.get("state")!);
      const clientInfo = { uid: "00000000-0000-0000-0000-00000000a11c", utid: "9188040d-6c67-4c5b-b112-36a304b66dad" };
      callback.searchParams.set("client_info", Buffer.from(JSON.stringify(clientInfo)).toString("base64url"));
      void fetch(callback).then((response) => {
        resolveAnswered(response.status);
        return undefined;
      });
    },
  };
}

/** The requests the fake saw after `from`, so a case asserts only what its own run sent. */
function requestsSince({ from }: { from: number }): FakeGraphServer["requests"] {
  return server.requests.slice(from);
}

/**
 * Bring the proof store to this checkout's schema through the shipped `store push`, so CI's fresh service and a
 * seat's reused database both hold every table the door records into. `--no-generate` because a test never
 * writes a migration; the unlanded-migration hatch because a branch's own migration is not on `main` yet. The
 * live fleet's `postgres` database is refused outright: this pushes a branch's schema into whatever it is given.
 */
async function migrateProofStore(): Promise<void> {
  if (PROOF_URL === undefined) {
    return;
  }
  refuseLiveStore({ url: PROOF_URL, variable: "DOOR_LEDGER_STORE_PROOF_URL" });
  const migrated = await runCli({
    args: ["store", "push", "--no-generate"],
    hatches: { SLOPWEAVER_ALLOW_UNLANDED_MIGRATION: "1" },
  });
  if (migrated.code !== 0) {
    throw new Error(`store push into the proof store failed (exit ${String(migrated.code)}):\n${migrated.stderr}`);
  }
}

let connectRun: CliRun;
let consentStatus: number;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "sw-outlook-cli-"));
  home = join(root, "home");
  fakeBin = join(root, "bin");
  mkdirSync(home);
  mkdirSync(fakeBin);
  // The consent tries to open a browser; on this lane that must fail, never open the real one.
  for (const opener of ["open", "xdg-open"]) {
    writeFileSync(join(fakeBin, opener), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  }
  server = await startFakeGraphServer({ options });
  preload = join(root, "fetch-redirect.mjs");
  writeFileSync(preload, fetchRedirectSource({ origin: server.origin }));
  await migrateProofStore();
  const answerer = consentAnswerer();
  connectRun = await runCli({ args: ["outlook", "connect"], onOutput: answerer.onOutput });
  consentStatus = await answerer.answered;
}, 60_000);

afterAll(async () => {
  await server.close();
  rmSync(root, { force: true, recursive: true });
});

describe("bin/slopweaver outlook connect — the consent round trip", () => {
  it("redeems the code, stores an owner-only grant naming the account, and never opened a browser", () => {
    expect(connectRun.code).toBe(0);
    expect(consentStatus).toBe(200);
    expect(connectRun.stdout + connectRun.stderr).toContain("could not open a browser for you");
    const grantPath = outlookGrantPath({ home });
    expect(statSync(grantPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(grantPath, "utf8")).account).toBe("owner@example.test");
    const redeem = server.requests.find((request) => request.path.endsWith("/oauth2/v2.0/token"))!;
    const form = new URLSearchParams(redeem.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-synthetic");
    expect(form.get("code_verifier")!.length).toBeGreaterThan(0);
    const me = server.requests.find((request) => request.path === "/v1.0/me")!;
    expect(me.authorization).toBe("Bearer at-1");
  });
});

describe("bin/slopweaver outlook — reads", () => {
  it("lists one page, newest first, and says more remain rather than reading them", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "list", "--json"] });
    expect(run.code).toBe(0);
    const listing = JSON.parse(run.stdout) as { messages: { id: string }[]; more: boolean };
    expect(listing.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
    expect(listing.more).toBe(true);
    const pages = requestsSince({ from }).filter((request) => request.path === "/v1.0/me/mailFolders/inbox/messages");
    expect(pages.map((page) => page.query.get("$orderby"))).toEqual(["receivedDateTime desc"]);
    expect(pages.map((page) => page.prefer)).toEqual([PREFER_READ]);
  });

  it("asks Graph for unread mail in its filter-first form, so the newest-first order survives the filter", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "list", "--unread", "--json"] });
    expect(run.code).toBe(0);
    const listing = JSON.parse(run.stdout) as { messages: { id: string }[]; unreadFilteredLocally: boolean };
    expect(listing.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
    expect(listing.unreadFilteredLocally).toBe(false);
    const page = requestsSince({ from }).find((request) => request.path === "/v1.0/me/mailFolders/inbox/messages");
    expect(page!.query.get("$filter")).toBe(UNREAD_NEWEST_FIRST);
    expect(page!.query.get("$orderby")).toBe("receivedDateTime desc");
  });

  it("follows the master category list onto its second page, so a name there is found", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "categories", "--json"] });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('"Waiting on"');
    expect(run.stdout).toContain('"Done"');
    const pages = requestsSince({ from }).filter((request) => request.path === "/v1.0/me/outlook/masterCategories");
    expect(pages.map((page) => page.query.get("$skiptoken"))).toEqual([null, "categories-2"]);
  });

  it("reads one message whole, as text, by its id", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "read", "m-2"] });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("subject: Synthetic subject m-2");
    expect(run.stdout).toContain("synthetic body of m-2");
    const reads = requestsSince({ from }).filter((request) => request.path === "/v1.0/me/messages/m-2");
    expect(reads.map((read) => read.prefer)).toEqual([PREFER_READ]);
  });

  it("reads a whole conversation oldest first, through the conversation filter", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "read", "m-1", "--thread"] });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("--- 1 of 2 ---");
    expect(run.stdout.indexOf("synthetic body of m-2")).toBeLessThan(run.stdout.indexOf("synthetic body of m-1"));
    const filtered = requestsSince({ from }).find((request) => request.path === "/v1.0/me/messages");
    expect(filtered!.query.get("$filter")).toBe("conversationId eq 'conv-a'");
  });

  it("walks every folder page and level, leaving a hidden folder out", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "folders"] });
    expect(run.code).toBe(0);
    expect(run.stdout.split("\n")).toEqual([
      "Inbox  3 total, 2 unread  id: folder-inbox",
      "Sent Items  4 total, 0 unread  id: folder-sent",
      "Archive  5 total, 0 unread  id: folder-archive",
      "Inbox/Receipts  1 total, 0 unread  id: folder-receipts",
      "",
    ]);
    const paths = requestsSince({ from })
      .filter((request) => request.path.startsWith("/v1.0/me/mailFolders"))
      .map((request) => `${request.path}?${String(request.query.get("$skiptoken"))}`);
    expect(paths).toEqual([
      "/v1.0/me/mailFolders?null",
      "/v1.0/me/mailFolders?folders-2",
      "/v1.0/me/mailFolders/folder-inbox/childFolders?null",
    ]);
  });

  it("measures one well-known folder from Graph's own counts", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "measure", "--folder", "Inbox"] });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("total: 3 messages, 2 unread");
    expect(requestsSince({ from }).some((request) => request.path === "/v1.0/me/mailFolders/inbox")).toBe(true);
  });

  it("groups the inbox by sender", async () => {
    const run = await runCli({ args: ["outlook", "triage"] });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("from 1 sender(s)");
    expect(run.stdout).toContain("Sender One <sender@example.test>");
  });

  it("lists a message's attachments on read, by the name the attachment verb then saves owner-only", async () => {
    const from = server.requests.length;
    const listed = await runCli({ args: ["outlook", "read", "m-3"] });
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("attachment: notes.txt (text/plain, 22 bytes, not downloaded)  id: att-1");
    expect(listed.stdout).toContain("save one: `slopweaver outlook attachment m-3 --name <file>`");
    const name = /attachment: (\S+) \(/u.exec(listed.stdout)![1]!;
    const run = await runCli({ args: ["outlook", "attachment", "m-3", "--name", name] });
    expect(run.code).toBe(0);
    const saved = /READ THIS: (\S+)/u.exec(run.stdout)![1]!;
    expect(readFileSync(saved, "utf8")).toBe(ATTACHMENT_TEXT);
    expect(statSync(saved).mode & 0o777).toBe(0o600);
    expect(requestsSince({ from }).map((request) => request.path)).toContain(
      "/v1.0/me/messages/m-3/attachments/att-1/$value",
    );
  });

  it("follows a search's nextLink when filtering unread, and sends the Prefer header on EVERY page", async () => {
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "list", "--query", "synthetic", "--unread", "--json"] });
    expect(run.code).toBe(0);
    const listing = JSON.parse(run.stdout) as { messages: { id: string }[] };
    expect(listing.messages.map((message) => message.id)).toEqual(["m-1", "m-2", "m-3"]);
    const pages = requestsSince({ from }).filter((request) => request.path === "/v1.0/me/mailFolders/inbox/messages");
    expect(pages.map((page) => page.query.get("$skiptoken"))).toEqual([null, "page-2"]);
    expect(pages.map((page) => page.prefer)).toEqual([PREFER_READ, PREFER_READ]);
  });

  it("sends a search as Graph's quoted $search, with no $filter or $orderby beside it", async () => {
    const from = server.requests.length;
    const query = 'from:sender@example.test "quarterly plan"';
    const run = await runCli({ args: ["outlook", "list", "--query", query] });
    expect(run.code).toBe(0);
    const search = requestsSince({ from }).find((request) => request.query.has("$search"));
    expect(search!.query.get("$search")).toBe(searchQuoted({ query }));
    expect(search!.query.has("$filter")).toBe(false);
    expect(search!.query.has("$orderby")).toBe(false);
  });

  it("reports a conversation filter Graph refuses as InefficientFilter, and tries no weaker query", async () => {
    const from = server.requests.length;
    options.refuseThreadFilter = true;
    const run = await runCli({ args: ["outlook", "read", "m-1", "--thread"] });
    options.refuseThreadFilter = false;
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("(InefficientFilter); nothing was read, and no weaker query was tried");
    expect(requestsSince({ from }).filter((request) => request.query.has("$filter")).length).toBe(1);
  });
});

describe("bin/slopweaver outlook — writes", () => {
  it("refuses to archive in a mailbox with no Archive folder, and moves nothing", async () => {
    options.hasArchive = false;
    const from = server.requests.length;
    const run = await runCli({ args: ["outlook", "archive", "m-3"] });
    options.hasArchive = true;
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('no folder matches "archive"');
    expect(requestsSince({ from }).some((request) => request.path.endsWith("/move"))).toBe(false);
    expect(server.messages.get("m-3")!.parentFolderId).toBe("folder-inbox");
  });

  it("archives a message, then restores it to the Inbox", async () => {
    requireProofStore();
    const from = server.requests.length;
    const archived = await runCli({ args: ["outlook", "archive", "m-3"] });
    expect(archived.code).toBe(0);
    expect(server.messages.get("m-3")!.parentFolderId).toBe("folder-archive");
    const restored = await runCli({ args: ["outlook", "archive", "m-3", "--restore"] });
    expect(restored.code).toBe(0);
    expect(server.messages.get("m-3")!.parentFolderId).toBe("folder-inbox");
    const moves = requestsSince({ from }).filter((request) => request.path.endsWith("/move"));
    expect(moves.map((request) => JSON.parse(request.body))).toEqual([
      { destinationId: "folder-archive" },
      { destinationId: "folder-inbox" },
    ]);
  });

  it("writes each rotated refresh token back, so the next process presents the NEW one", async () => {
    requireProofStore();
    const issuedBefore = server.tokensIssued();
    const presentedBefore = server.refreshTokensPresented.length;
    expect((await runCli({ args: ["outlook", "mark", "m-1", "--read"] })).code).toBe(0);
    expect((await runCli({ args: ["outlook", "mark", "m-2", "--read"] })).code).toBe(0);
    expect(server.refreshTokensPresented.slice(presentedBefore)).toEqual([
      `rt-${String(issuedBefore)}`,
      `rt-${String(issuedBefore + 1)}`,
    ]);
    expect(server.messages.get("m-1")!.isRead).toBe(true);
    expect(server.messages.get("m-2")!.isRead).toBe(true);
  });

  it("serialises two verbs refreshing at once, so the second presents the token the first rotated in", async () => {
    const issuedBefore = server.tokensIssued();
    const presentedBefore = server.refreshTokensPresented.length;
    // Each refresh is held long enough that two unlocked processes would both present the same token.
    options.tokenDelayMs = 3000;
    const runs = await Promise.all([
      runCli({ args: ["outlook", "list", "--json"] }),
      runCli({ args: ["outlook", "list", "--json"] }),
    ]).finally(() => {
      options.tokenDelayMs = 0;
    });
    expect(runs.map((run) => run.code)).toEqual([0, 0]);
    expect(server.refreshTokensPresented.slice(presentedBefore)).toEqual([
      `rt-${String(issuedBefore)}`,
      `rt-${String(issuedBefore + 1)}`,
    ]);
  });

  it("says a mark Graph accepted but answered in an undeclared shape may have happened, never that it failed", async () => {
    requireProofStore();
    options.driftPatch = true;
    const run = await runCli({ args: ["outlook", "mark", "m-3", "--read"] });
    options.driftPatch = false;
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("FAILED: m-3 — outlook.messages.patch did not report back cleanly");
    expect(run.stdout).toContain("Graph accepted it, then answered in a shape this door does not declare");
    expect(run.stdout).toContain("so it may have happened — check the message in Outlook");
    expect(server.messages.get("m-3")!.isRead).toBe(true);
  });

  it("drafts under the default grant, which cannot send; then, granted full, sends only once approved", async () => {
    requireProofStore();
    const form = JSON.stringify({
      body: "A synthetic paragraph.",
      subject: "Synthetic hello",
      to: ["two@example.test"],
    });
    const drafted = await runCli({ args: ["outlook", "draft", "--form", "-"], stdin: form });
    expect(drafted.code).toBe(0);
    const draftId = /outlook send (draft-\d+)/u.exec(drafted.stdout)![1]!;
    const unscoped = await runCli({ args: ["outlook", "send", draftId] });
    expect(unscoped.code).toBe(1);
    expect(unscoped.stderr).toContain("missing Mail.Send — re-run `slopweaver outlook connect --grant full`");
    const answerer = consentAnswerer();
    const widened = await runCli({ args: ["outlook", "connect", "--grant", "full"], onOutput: answerer.onOutput });
    expect(await answerer.answered).toBe(200);
    expect(widened.code).toBe(0);
    const preview = await runCli({ args: ["outlook", "send", draftId] });
    expect(preview.code).not.toBe(0);
    // The fake's draft names a sender other than the bound mailbox, so this reads which one is approved.
    expect(preview.stdout).toContain("from: Sender One <sender@example.test>");
    expect(server.requests.some((request) => request.path.endsWith("/send"))).toBe(false);
    const digest = /--approve ([0-9a-f]+)/u.exec(preview.stdout)![1]!;
    const sent = await runCli({ args: ["outlook", "send", draftId, "--approve", digest] });
    expect(sent.code).toBe(0);
    const sends = server.requests.filter((request) => request.path === `/v1.0/me/messages/${draftId}/send`);
    expect(sends.map((request) => request.body)).toEqual([""]);
  });

  it("drafts a reply in the parent's conversation: a bodiless createReply, then the form's fields patched on", async () => {
    requireProofStore();
    const from = server.requests.length;
    const form = JSON.stringify({
      body: "A synthetic reply.",
      subject: "RE: Synthetic",
      to: ["sender@example.test"],
    });
    const drafted = await runCli({ args: ["outlook", "draft", "--form", "-", "--reply-to", "m-3"], stdin: form });
    expect(drafted.code).toBe(0);
    expect(drafted.stdout).toContain("DRAFT STORED (reply)");
    expect(drafted.stdout).toContain("conversation: conv-b");
    const draftId = /outlook send (draft-\d+)/u.exec(drafted.stdout)![1]!;
    const writes = requestsSince({ from }).filter(
      (request) => request.method !== "GET" && request.host === "graph.microsoft.com",
    );
    expect(writes.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v1.0/me/messages/m-3/createReply",
      `PATCH /v1.0/me/messages/${draftId}`,
    ]);
    expect(writes[0]!.body).toBe("");
    expect(server.messages.get(draftId)!.conversationId).toBe("conv-b");
  });

  it("adds a category whose name sits on the list's second page", async () => {
    requireProofStore();
    const run = await runCli({ args: ["outlook", "category", "m-3", "--add", "Done"] });
    expect(run.code).toBe(0);
    expect(server.messages.get("m-3")!.categories).toEqual(["Done"]);
  });

  it("names Sent Items when a send fails with no clear answer, and never sends twice", async () => {
    requireProofStore();
    const form = JSON.stringify({
      body: "Another synthetic line.",
      subject: "Synthetic retry",
      to: ["two@example.test"],
    });
    const drafted = await runCli({ args: ["outlook", "draft", "--form", "-"], stdin: form });
    const draftId = /outlook send (draft-\d+)/u.exec(drafted.stdout)![1]!;
    const preview = await runCli({ args: ["outlook", "send", draftId] });
    const digest = /--approve ([0-9a-f]+)/u.exec(preview.stdout)![1]!;
    options.failSend = true;
    const sent = await runCli({ args: ["outlook", "send", draftId, "--approve", digest] });
    options.failSend = false;
    expect(sent.code).toBe(1);
    expect(sent.stderr).toContain("check your Sent Items folder before running it again");
    expect(server.requests.filter((request) => request.path === `/v1.0/me/messages/${draftId}/send`).length).toBe(1);
  });
});

/** Resolve once `predicate` holds, checking every 50ms, or reject after `withinMs`. */
async function until({ predicate, withinMs }: { predicate: () => boolean; withinMs: number }): Promise<void> {
  const deadline = Date.now() + withinMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${String(withinMs)}ms`);
    }
    await new Promise((resolveTick) => {
      setTimeout(resolveTick, 50);
    });
  }
}

describe("bin/slopweaver outlook connect --disconnect — last, because it removes the shared grant", () => {
  it("waits out a refresh in flight, so that refresh cannot write the removed grant back", async () => {
    const tokenRequests = (): number =>
      server.requests.filter((request) => request.path.endsWith("/oauth2/v2.0/token")).length;
    const before = tokenRequests();
    options.tokenDelayMs = 3000;
    const refreshing = runCli({ args: ["outlook", "list", "--json"] });
    await until({ predicate: () => tokenRequests() > before, withinMs: 20_000 });
    const disconnected = await runCli({ args: ["outlook", "connect", "--disconnect"] }).finally(() => {
      options.tokenDelayMs = 0;
    });
    const listed = await refreshing;
    expect(listed.code).toBe(0);
    expect(disconnected.code).toBe(0);
    expect(disconnected.stdout).toContain("removed the local grant");
    expect(existsSync(outlookGrantPath({ home }))).toBe(false);
  });
});
