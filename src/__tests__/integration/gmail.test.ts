/**
 * INTEGRATION test: the Gmail door against the REAL Gmail API, recorded + replayed via a Polly cassette
 * (see `setup-polly.ts` + `cassetteRedact.ts`). One `describe` per door verb.
 *
 * ## Why this replays at all, which is not obvious
 *
 * `@googleapis/gmail` issues its calls through `gaxios`, which by default uses its own bundled `node-fetch`
 * rather than the global `fetch` Polly patches — so a naively-built client hits the real network in replay
 * and the cassette is never consulted. `makeGoogleAuthClient` points the auth client's transport at a
 * late-binding `globalThis.fetch` precisely so this lane works; the measurement behind that is in
 * `src/live/google/authClient.ts`'s header. If this suite ever starts reaching the network in replay, that is the
 * line that regressed.
 *
 * ## Recording
 *
 * Recorded against a REAL mailbox, so EVERY assertion here is STRUCTURAL — never content, which the
 * allowlist redactor blanks (header values → `[REDACTED]`, body `data` dropped, ids → `id_N`). Recording
 * needs a Google Desktop-app OAuth client and one consent click, neither of which a session can perform on
 * the owner's behalf:
 *
 *   slopweaver secrets set google-client-id           # once, in Google Cloud, then here
 *   slopweaver secrets set google-client-secret
 *   slopweaver gmail connect --grant read            # opens the consent screen; any wider grant also works
 *   POLLY_MODE=record SLOPWEAVER_HOME=… yarn test:integration
 *
 * The record lane reads the STORED GRANT out of that `SLOPWEAVER_HOME` rather than taking tokens from the
 * environment. That is deliberate and it is a safety property, not a convenience: five
 * `SLOPWEAVER_RECORD_GMAIL_*` variables would mean a refresh token pasted into a shell — visible in the
 * process list, kept in shell history, and easy to leave exported. The credential is already on disk at
 * `0600`; this reads it from there and nothing has to hold it.
 *
 * Until a recording exists the suite reports itself as UNRECORDED and skips, printing the reason — a silent
 * skip would read exactly like a passing suite, which is the failure mode this repo names in
 * `a-gate-that-always-refuses-is-not-a-gate`. It is a stated gap, not a green claim.
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { gmail_v1 } from "@googleapis/gmail";
import { afterAll, describe, expect, it } from "vitest";
import { unwrap } from "../../lib/result.js";
import { makeGmailApi } from "../../live/gmail/api.js";
import { guardedGmailSdk } from "../../live/gmail/client.js";
import { applyGmailLabelChange, type GmailModifyPlan, planGmailLabelChange } from "../../live/gmail/modify.js";
import { applyGmailDraft, applyGmailSend, planGmailDraft, planGmailSend } from "../../live/gmail/outbox.js";
import { readGmailLabels, readGmailListing, readGmailMessage } from "../../live/gmail/read.js";
import { makeGoogleAuthClient } from "../../live/google/authClient.js";
import { type GmailGrant, gmailGrantStore } from "../../secrets/gmailGrant.js";
import { googleClientId, googleClientSecret } from "../../secrets/googleClients.js";
import { homeDeclaringNoPrivateTerms } from "../privateTermsFixture.js";
import { realAmbientHome } from "../realAmbientHome.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** Where `setup-polly.ts` persists this file's recordings. */
const RECORDINGS_DIR = join(dirname(new URL(import.meta.url).pathname), "__recordings__");

/**
 * Whether a recording for this suite exists — the replay lane cannot run without one.
 *
 * Matched by PREFIX, not by exact name: Polly appends a hash of the suite title to the directory it
 * persists under (`…-via-Polly-cassette_3465997150`), so an exact-name check can never match and this
 * suite would stay silently skipped forever after being recorded — the failure this whole guard exists to
 * avoid, reintroduced one level down.
 */
const RECORDING_PREFIX = "gmail-door-integration";
const RECORDED = existsSync(RECORDINGS_DIR)
  ? readdirSync(RECORDINGS_DIR).some((entry) => entry.startsWith(RECORDING_PREFIX))
  : false;

/**
 * The mutation suite is guarded SEPARATELY, and that separation is the point rather than tidiness.
 *
 * Every other recording here is a read. Recording THIS one performs a REAL label change on the mailbox the
 * grant is bound to: it stars one message in the inbox. That is a side effect on someone's actual mail, so
 * it is not something a recording run of the read suite should perform on the way past — hence its own
 * prefix, which lets the read cassettes be re-recorded without touching it.
 *
 * **Recorded with the owner's explicit yes, and the mailbox restored in the same session** —
 * the star was removed through `slopweaver gmail label <id> --remove STARRED` immediately afterwards and
 * the message's label set was confirmed identical to what it was before. Anyone RE-recording this owes the
 * same restore; it is one command, and skipping it leaves a stranger's mail flagged for no reason. Replay
 * touches no mailbox at all, so only a `POLLY_MODE=record` run ever has this cost.
 */
const MUTATION_RECORDING_PREFIX = "gmail-mutations-integration";
const MUTATIONS_RECORDED = existsSync(RECORDINGS_DIR)
  ? readdirSync(RECORDINGS_DIR).some((entry) => entry.startsWith(MUTATION_RECORDING_PREFIX))
  : false;

/**
 * The draft suite is guarded separately again, for a REASON THAT IS NOT THE MUTATION SUITE'S.
 *
 * Recording this one writes a real draft into the bound mailbox. That is a far smaller cost than the star —
 * a draft reaches nobody, is visible only to the mailbox's owner, and is deleted from Gmail's own interface
 * — so it does not need the standing owner ruling the mutation cassette needed. It gets its own prefix
 * anyway, so the read cassettes can be re-recorded without leaving a stray draft behind each time. Anyone
 * re-recording should delete the draft afterwards; there is deliberately no `gmail` verb that deletes one.
 *
 * **There is no SEND cassette, and its absence is a decision rather than a gap.** `drafts.send` is the one
 * call in this integration that cannot be undone — it puts mail in front of a person, and no cleanup step
 * exists for that. Recording one is the owner's call to make and the owner has not made it, so `applyGmailSend`
 * reaching the real endpoint is NOT proven here and this file will not pretend otherwise. What IS proven is
 * everything up to it: the composed bytes round-trip through Gmail's own storage, and the digest a send is
 * gated on is computed from what the server actually holds.
 */
const DRAFT_RECORDING_PREFIX = "gmail-drafts-integration";
const DRAFTS_RECORDED = existsSync(RECORDINGS_DIR)
  ? readdirSync(RECORDINGS_DIR).some((entry) => entry.startsWith(DRAFT_RECORDING_PREFIX))
  : false;

/**
 * The send suite is guarded separately from the draft suite, and this is the guard that matters most here.
 *
 * Recording it performs a REAL SEND. It is addressed to the bound mailbox itself, so it reaches nobody else
 * and lands in the owner's own inbox — but unlike the star and unlike the draft, **there is no undo**. Mail
 * that has been accepted by a mail server has been accepted; Gmail's own undo window lives in its interface
 * and not in its API, and no `gmail` verb recalls a message.
 *
 * **Recorded with the owner's explicit yes, self-addressed.** Anyone re-recording is performing
 * a fresh irreversible act and owes a fresh yes — this is not a cassette to refresh on the way past. It is
 * deliberately SELF-ADDRESSED and should stay that way: a second recipient is a second mailbox nothing here
 * can clean up, and a real address is exactly what the no-private-identifiers rule keeps out of a committed
 * file. Nothing in this suite needs one — `drafts.send` is exercised completely by a send to oneself.
 */
const SEND_RECORDING_PREFIX = "gmail-send-integration";
const SEND_RECORDED = existsSync(RECORDINGS_DIR)
  ? readdirSync(RECORDINGS_DIR).some((entry) => entry.startsWith(SEND_RECORDING_PREFIX))
  : false;

if (!(RECORD || SEND_RECORDED)) {
  process.stdout.write(
    "gmail send integration: UNRECORDED — the cassette is missing, so `drafts.send` reaching the real " +
      "endpoint is NOT proven here (the unit lane still covers the shell, the gate and the seam against " +
      "fakes). Re-recording SENDS A REAL MESSAGE and cannot be undone; see this file's header.\n",
  );
}

if (!(RECORD || DRAFTS_RECORDED)) {
  process.stdout.write(
    "gmail drafts integration: UNRECORDED — the cassette is missing, so `drafts.create` and `drafts.get` " +
      "reaching the real endpoint is NOT proven here (the unit lane still covers both halves against " +
      "fakes). Re-recording writes one real draft into the bound mailbox; delete it afterwards.\n",
  );
}

if (!(RECORD || MUTATIONS_RECORDED)) {
  process.stdout.write(
    "gmail mutations integration: UNRECORDED — the cassette is missing, so `messages.modify` reaching the " +
      "real endpoint is NOT proven here (the unit lane still covers the planner and both seams against " +
      "fakes). Re-recording STARS ONE REAL MESSAGE in the bound mailbox and you must unstar it afterwards; " +
      "see this file's header.\n",
  );
}

if (!(RECORD || RECORDED)) {
  // Printed, not swallowed: the reason a suite did not run belongs in the run's own output.
  process.stdout.write(
    "gmail integration: UNRECORDED — no cassette yet. Recording needs a Google Desktop-app OAuth client and " +
      "one consent click on the target mailbox; see this file's header for the exact commands.\n",
  );
}

/** A placeholder grant for the replay lane, which authenticates against the cassette rather than Google. */
const REPLAY_GRANT: GmailGrant = {
  account: "replay@example.invalid",
  accessToken: "dummy-replay-value-not-real",
  // Far in the future, so replay never triggers a refresh the cassette has no entry for.
  expiryMs: 4_102_444_800_000,
  grantedAtIso: "2026-08-27T00:00:00.000Z",
  refreshToken: "dummy-replay-value-not-real",
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
};

/**
 * The state home the record lane reads the real grant and client credentials out of.
 *
 * {@link realAmbientHome}, not a `process.env["SLOPWEAVER_HOME"]` read, and that is a live defect rather
 * than tidiness: `setup-ambient-home.ts` repoints the variable at a per-file sandbox in `beforeAll`, so this
 * function returned the SANDBOX from every caller that runs at test time — `boundClient()` does — and
 * recording died on "set google-client-id and google-client-secret in this home" against a directory that
 * has never held a credential. The capture is taken before the sandbox exists, so both callers agree.
 */
function recordHome(): string {
  return realAmbientHome();
}

/** The real grant, read from disk. Only ever called on the record path. */
function storedGrant(): GmailGrant {
  const stored = gmailGrantStore.read({ home: recordHome() });
  if (stored.isErr()) {
    throw new Error(`could not read the stored Gmail grant: ${stored.error.join("; ")}`);
  }
  if (stored.value === undefined) {
    throw new Error("no Gmail grant stored — run `slopweaver gmail connect` before recording this cassette");
  }
  return stored.value;
}

/** The OAuth client credentials, read from the same home. Only ever called on the record path. */
function clientCredentials(): { clientId: string; clientSecret: string } {
  const home = recordHome();
  const clientId = googleClientId({ home });
  const clientSecret = googleClientSecret({ home });
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error("set google-client-id and google-client-secret in this home before recording this cassette");
  }
  return { clientId, clientSecret };
}

/**
 * Where a mid-recording token refresh is allowed to land: outside the repo, and thrown away. It is also the home the
 * write guard judges under, so its private-terms file declares none.
 */
const TOKEN_SINK = homeDeclaringNoPrivateTerms({ prefix: "slopweaver-gmail-cassette-" });

afterAll(() => {
  rmSync(TOKEN_SINK, { force: true, recursive: true });
});

/**
 * How long the freshly-refreshed token is treated as valid. Google issues roughly an hour; a recording runs
 * in seconds, so half an hour is far past any run while staying honest about not being indefinite.
 */
const REFRESHED_TOKEN_EXPIRY_MS = Date.now() + 30 * 60 * 1000;

/**
 * The grant the record lane actually uses, with its access token ALREADY REFRESHED.
 *
 * This is resolved at module scope, which is the whole point: Polly is installed in `beforeEach`, so a
 * refresh that happens inside a test gets recorded — and worse, the request that TRIGGERS it is a 401 that
 * gets recorded too. Path matching is lenient, so on replay that recorded 401 is what comes back for the
 * very first call, and every test fails against a cassette that looks complete. Measured: the first three
 * recordings all failed this way in CI.
 *
 * Refreshing before Polly exists means the recording contains exactly the calls the test makes, and no
 * token exchange at all. The replay lane never reaches this — it has no network and needs no token.
 */
const RECORD_GRANT: GmailGrant = RECORD ? await refreshedGrant() : REPLAY_GRANT;

/** Force a token refresh outside the recorded window, and return a grant carrying the fresh token. */
async function refreshedGrant(): Promise<GmailGrant> {
  const grant = storedGrant();
  // `expiryMs: 1` — an instant long past — so the client MUST mint a new token rather than hand back the
  // cached one. Trusting the stored expiry is what made the previous attempt record three 401s: the grant
  // said the token was still valid, Google disagreed, and `getAccessToken()` never asked.
  const auth = makeGoogleAuthClient({
    ...clientCredentials(),
    grant: { ...grant, expiryMs: 1 },
    persist: ({ grant: refreshed }) => gmailGrantStore.write({ grant: refreshed, home: TOKEN_SINK }),
  });
  const token = await auth.getAccessToken();
  if (typeof token.token !== "string") {
    throw new Error("could not refresh the stored Gmail grant before recording");
  }
  return { ...grant, accessToken: token.token, expiryMs: REFRESHED_TOKEN_EXPIRY_MS };
}

/** The bound client both lanes use: the refreshed stored grant when recording, a placeholder when replaying. */
function boundClient(): { client: gmail_v1.Gmail; account: string } {
  const grant = RECORD_GRANT;
  const credentials = RECORD ? clientCredentials() : { clientId: "replay", clientSecret: "replay" };
  const auth = makeGoogleAuthClient({
    ...credentials,
    grant,
    // A throwaway temp home, and this is a SECURITY choice rather than tidiness. The auth client persists
    // every refreshed access token through this seam: the real home would mean a test writing over the
    // owner's own grant, and a path inside the repository would mean a live Google credential landing in
    // the working tree, one `git add -A` from being committed. Neither is acceptable, so it goes outside
    // the repo, under a directory the OS will reclaim.
    persist: ({ grant: refreshed }) => gmailGrantStore.write({ grant: refreshed, home: TOKEN_SINK }),
  });
  // Built through the one guarded constructor, judging writes under the same throwaway home, whose private-terms
  // file declares none. A recording of `drafts.send` therefore carries the guard's `format=raw` re-read before it.
  return { account: grant.account, client: guardedGmailSdk({ account: grant.account, auth, home: TOKEN_SINK }) };
}

const NOW = "2026-08-27T00:00:00.000Z";

/**
 * ONE message per test, and the reason is the cassette rather than the coverage.
 *
 * Every id-bearing Gmail route collapses to the same redacted path, because a real message id must not
 * survive into a committed recording. Two id-bearing calls in one test would therefore share a match key,
 * and Polly's default lenient matching would serve the first recording for both — assertions passing on a
 * response they did not make, which is a green test proving less than it claims. Ordered matching can force
 * the issue, but it also makes the cassette depend on the exact call sequence at RECORD time, including a
 * token refresh that fires only when the stored grant happens to be stale. Keeping each recording's paths
 * distinct is the property that does not depend on when it was recorded.
 *
 * Multi-entry listing behaviour is covered exhaustively in the unit lane against fakes. What only a real
 * mailbox can prove — that the seam reaches Gmail and that the MIME walk survives real mail — needs one
 * message, not three.
 */
const MAX_ITEMS = 1;

describe.skipIf(!(RECORD || RECORDED))("gmail door (integration — real Gmail via Polly cassette)", () => {
  it("lists a capped page of message ids and shapes each one from its metadata", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });
    const result = unwrap(
      await readGmailListing({
        account: bound.account,
        api,
        labelIds: ["INBOX"],
        limit: MAX_ITEMS,
        nowIso: () => NOW,
        query: undefined,
      }),
    );

    expect(result.listing.entries.length).toBeGreaterThan(0);
    expect(result.listing.entries.length).toBeLessThanOrEqual(MAX_ITEMS);
    // Structural only: ids survive redaction as synthetic `id_N`, content does not.
    expect(result.listing.entries.every((entry) => entry.id.length > 0)).toBe(true);
    expect(result.listing.entries.every((entry) => entry.threadId.length > 0)).toBe(true);
    expect(result.document.source).toBe("gmail");
    expect(result.document.coverage.kind).toBe("bounded");
    // The residue every listing owes, asserted at the REAL seam rather than only over a fake.
    expect(result.document.coverage.residue.some((line) => line.includes("bodies and attachments"))).toBe(true);
  });

  it("reads one message in full, and the MIME walk finds a body in the real payload", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });
    const page = unwrap(await api.listMessageIds({ labelIds: ["INBOX"], limit: 1, query: undefined }));
    const first = page.ids[0]!;

    const result = unwrap(
      await readGmailMessage({ account: bound.account, address: first, api, nowIso: () => NOW, thread: false }),
    );
    expect(result.payload.messages.length).toBe(1);
    const message = result.payload.messages[0]!;
    expect(message.id.length).toBeGreaterThan(0);
    expect(message.threadId.length).toBeGreaterThan(0);
    // The parser reached a decision about the body representation on real MIME — which is the whole point of
    // running this against a recording rather than only against a synthetic fixture.
    expect(["text", "html", "none"]).toContain(message.bodyFormat);
    expect(result.document.target.kind).toBe("message");
  });

  it("plans a label change against the real vocabulary without sending anything", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });
    // ONE id-bearing call in this test, and it is the planner's own `getMessage`. `labels.list` and
    // `messages.list` both keep their real paths (every segment is route-shaped), so they cannot collide
    // with it — see MAX_ITEMS above for why that constraint governs the shape of every test here.
    const page = unwrap(await api.listMessageIds({ labelIds: ["INBOX"], limit: 1, query: undefined }));
    const first = page.ids[0]!;

    const plan = unwrap(
      await planGmailLabelChange({
        account: bound.account,
        addRefs: [],
        address: first,
        api,
        intent: "archive",
        // Resolved against the REAL label vocabulary the mailbox returned, which is what this test adds
        // over the unit lane: `INBOX` has to actually be in `labels.list` for this to resolve at all.
        removeRefs: ["INBOX"],
        scope: "message",
      }),
    );
    // The message came out of an INBOX-filtered listing, so the planned removal is real rather than narrowed
    // away — which is also the assertion that the planner read live label state rather than assuming it.
    expect(plan.plan.removeLabelIds).toStrictEqual(["INBOX"]);
    expect(plan.plan.noop).toBe(false);
    expect(plan.labelNames["INBOX"]).toBe("INBOX");
    expect(plan.before.length).toBe(1);
  });

  it("reads the label vocabulary and finds the system labels every mutation verb depends on", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });
    const result = unwrap(await readGmailLabels({ account: bound.account, api, nowIso: () => NOW }));
    const ids = result.vocabulary.labels.map((label) => label.id);
    // Structural: these four are Google's own, present in every mailbox, and are the ids `archive`, `mark`
    // and the TRASH/SPAM rail are written in terms of. A user label's name is content and is not asserted.
    expect(ids).toContain("INBOX");
    expect(ids).toContain("UNREAD");
    expect(ids).toContain("TRASH");
    expect(ids).toContain("SPAM");
    expect(result.vocabulary.labels.every((label) => label.id.length > 0)).toBe(true);
    expect(result.document.target.kind).toBe("labels");
  });

  it("reads a whole thread through the threads endpoint", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });
    // The thread id comes from the LIST response, which Gmail returns alongside each message id. Fetching
    // the message first would only be a second id-bearing call sharing this one's redacted path.
    const page = unwrap(await api.listMessageIds({ labelIds: ["INBOX"], limit: 1, query: undefined }));
    const threadId = page.threadIds[0]!;

    const result = unwrap(
      await readGmailMessage({ account: bound.account, address: threadId, api, nowIso: () => NOW, thread: true }),
    );
    expect(result.payload.messages.length).toBeGreaterThan(0);
    expect(result.document.target.kind).toBe("thread");
    // A thread read never suggests re-reading itself as a thread.
    expect(result.document.coverage.residue.some((line) => line.includes("--thread"))).toBe(false);
  });
});

describe.skipIf(!(RECORD || MUTATIONS_RECORDED))(
  "gmail mutations (integration — real Gmail via Polly cassette)",
  () => {
    it("stars one real message through the modify seam and reads the new label set back", async () => {
      const bound = boundClient();
      const api = makeGmailApi({ account: bound.account, client: bound.client });
      // `messages.list` keeps its real path; `messages/<id>/modify` collapses whole. That is ONE id-bearing
      // call, which is the constraint every test in this file is shaped by.
      const page = unwrap(await api.listMessageIds({ labelIds: ["INBOX"], limit: 1, query: undefined }));
      const first = page.ids[0]!;

      // The plan is BUILT HERE rather than planned through `planGmailLabelChange`, and not for convenience:
      // planning calls `getMessage`, whose redacted path is identical to `modify`'s, so the two would share a
      // match key and the cassette would serve one recording for both. `planGmailLabelChange` is covered
      // against the real API by its own test above, which makes no mutation.
      const plan: GmailModifyPlan = {
        account: bound.account,
        address: first,
        before: [{ id: first, labelIds: [] }],
        intent: "label",
        labelNames: { STARRED: "STARRED" },
        // STARRED is the least invasive real change available: it moves no mail, changes no read state, is
        // visible in Gmail, and is undone by clicking the star. Archiving or marking read would look, to
        // whoever owns this mailbox, exactly like mail going missing.
        plan: { addLabelIds: ["STARRED"], noop: false, removeLabelIds: [] },
        scope: "message",
      };
      const outcome = unwrap(await applyGmailLabelChange({ api, plan }));

      expect(outcome.after.length).toBe(1);
      // What only the real endpoint can prove: `modify` returns the message with its NEW label set, which is
      // what lets the verb report state read back rather than state it asked for.
      expect(outcome.after[0]!.labelIds).toContain("STARRED");
      expect(outcome.residue.some((line) => line.includes("compare-and-set"))).toBe(true);
    });
  },
);

describe.skipIf(!(RECORD || DRAFTS_RECORDED))("gmail drafts (integration — real Gmail via Polly cassette)", () => {
  it("stores a composed message and reads it back, digesting what the server actually holds", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });

    // `drafts.create` posts to a path carrying no id; only `drafts.get` is id-bearing. That is ONE
    // id-bearing call, which is the constraint every test in this file is shaped by — two would collapse to
    // the same `/[REDACTED]` match key and silently share one recording.
    const plan = unwrap(
      await planGmailDraft({
        account: bound.account,
        api,
        form: {
          bcc: [],
          body: "Recorded by the slopweaver integration lane. Nothing was sent.",
          cc: [],
          subject: "slopweaver integration cassette",
          to: [bound.account],
        },
      }),
    );
    const stored = unwrap(await applyGmailDraft({ api, plan }));
    expect(stored.draftId.length).toBeGreaterThan(0);
    // What only the real endpoint proves: Gmail assigns a THREAD to a brand-new draft that is not a reply.
    // Nothing in the unit lane could establish that, because the fake is the one deciding.
    expect(stored.threadId).toBeDefined();

    const send = unwrap(await planGmailSend({ account: bound.account, api, draftId: stored.draftId }));
    // Structural, never content: the redactor blanks every header value on the way into the cassette, so
    // asserting the subject came back would pass live and fail on replay for the wrong reason.
    expect(send.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(send.draftId).toBe(stored.draftId);
    expect(send.threadId.length).toBeGreaterThan(0);
    // The residue a reviewer is shown before approving states the one thing that could invalidate it.
    expect(send.residue.some((line) => line.includes("invalidates the digest"))).toBe(true);
  });
});

describe.skipIf(!(RECORD || SEND_RECORDED))("gmail send (integration — real Gmail via Polly cassette)", () => {
  it("SENDS a real self-addressed draft, and what comes back is a sent message rather than a draft", async () => {
    const bound = boundClient();
    const api = makeGmailApi({ account: bound.account, client: bound.client });

    // Three calls, and only ONE is id-bearing. `drafts.create` posts to `/drafts` and `drafts.send` posts to
    // `/drafts/send` — both route-shaped paths carrying the id in the BODY — so `drafts.get` is the only one
    // that collapses to `/[REDACTED]`. That is what lets a whole compose-review-send round trip live in one
    // recording, which the label mutation could not do.
    const plan = unwrap(
      await planGmailDraft({
        account: bound.account,
        api,
        form: {
          bcc: [],
          body: "Sent by the slopweaver integration lane to record the send cassette. Self-addressed.",
          cc: [],
          subject: "slopweaver send cassette",
          // SELF-ADDRESSED, and this is the safety property rather than a convenience. See the guard above
          // before changing it.
          to: [bound.account],
        },
      }),
    );
    const stored = unwrap(await applyGmailDraft({ api, plan }));
    const send = unwrap(await planGmailSend({ account: bound.account, api, draftId: stored.draftId }));
    const outcome = unwrap(await applyGmailSend({ api, plan: send }));

    expect(outcome.messageId.length).toBeGreaterThan(0);
    // What ONLY the real endpoint can prove, and what no fake could have established: `drafts.send` answers
    // with the MESSAGE — carrying the `SENT` label Gmail itself applied — and not with the draft that was
    // sent. The seam maps the response as a message on that basis, and this is the assertion behind it.
    expect(outcome.labelIds).toContain("SENT");
    expect(outcome.threadId.length).toBeGreaterThan(0);
    // The residue never claims delivery, because an accepted send is not a delivered mail.
    expect(outcome.residue.some((line) => line.includes("cannot be undone"))).toBe(true);
  });
});
