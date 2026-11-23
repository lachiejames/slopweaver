/**
 * The Claude fallback record read back through the REAL store-backed port over an in-memory store: a request
 * and receipt written as text, read as a review or a plan, and folded into the scan the landing floor reads.
 *
 * A row a test edits in place stands for a stored text that changed after its receipt bound to it — no verb
 * can produce one, which is the shape under test.
 */
import { describe, expect, it } from "vitest";

import { CodexErrors, codexErrorLines } from "../../../codex/errors.js";
import { type ClaudeFallbackPlanRequest, validateFallbackPlan } from "../../../codex/fallbackPlan.js";
import type { FallbackRegisterPort } from "../../../codex/fallbackPort.js";
import {
  fallbackReceiptText,
  fallbackRequestText,
  storedPlanRequest,
  storedReviewRequest,
} from "../../../codex/fallbackRequestRead.js";
import {
  type ClaudeFallbackReviewReceipt,
  type ClaudeFallbackReviewRequest,
  validateFallbackReview,
} from "../../../codex/fallbackReview.js";
import { treeFingerprint } from "../../../codex/fingerprint.js";
import { incompleteScanReason } from "../../../codex/scanReasons.js";
import { unwrap } from "../../../lib/result.js";
import {
  type MemoryFallbackStore,
  memoryFallbackRegisterPort,
  memoryFallbackStore,
} from "../../fallbackRegisterFixture.js";

/** A pass-record scan that skipped nothing, so only the fallback receipts can make a read incomplete. */
const CLEAN_RECORDS = { withoutSidecar: 0, records: [], unreadable: 0 };
/** A branch ledger that skipped nothing, for the same reason. */
const CLEAN_LEDGER = { entries: [], unattributed: 0, unknowable: 0, unplaceable: [] };
/** The branch and checkout every request below names, judged. */
const JUDGED = { branch: "feature", repoRoots: new Set(["/w/repo"]) };

const HOME = "/h/unused-by-the-memory-store";
const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const NOW = treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` });

function request({
  requestId,
}: {
  requestId: string;
}): Extract<ClaudeFallbackReviewRequest, { readonly capEvidence: unknown }> {
  return {
    baseRef: "origin/main",
    baseSha: "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90",
    capEvidence: {
      blockedBy: "Codex reported workspace_member_usage_limit_reached at 2026-09-13T14:49:01.803Z",
      limitId: "premium",
      observedAtIso: "2026-09-13T14:49:01.803Z",
      reachedType: "workspace_member_usage_limit_reached",
    },
    createdAtIso: "2026-09-14T01:00:00.000Z",
    diffBytes: 12,
    diffSha256: "d".repeat(64),
    headSha: HEAD,
    pass: "r1",
    property: { id: "r1-01", statement: "the store round-trips" },
    repoRoot: "/w/repo",
    requestId,
    schemaVersion: 1,
    tree: { branch: "feature", dirtyBytes: 0, fingerprint: NOW.digest, headSha: HEAD, treeSha: NOW.treeSha },
  };
}

function planRequest(): ClaudeFallbackPlanRequest {
  const { capEvidence, repoRoot, tree } = request({ requestId: "unused" });
  return {
    capEvidence,
    createdAtIso: "2026-09-15T16:00:00.000Z",
    mode: "plan",
    pass: "p1",
    promptBytes: 1,
    promptSha256: "a".repeat(64),
    repoRoot,
    requestId: "plan-a",
    schemaVersion: 1,
    taskSha256: "b".repeat(64),
    tree,
  };
}

const ANSWER = JSON.stringify({
  counterexample: "",
  evidence: "e",
  propertyId: "r1-01",
  summary: "s",
  verdict: "CLEAN",
});
const PLAN_ANSWER = JSON.stringify({ blockers: [], bodyMarkdown: "plan", summary: "s", verdict: "READY" });

/** A port over a store the test can reach into. */
function harness(): { readonly port: FallbackRegisterPort; readonly store: MemoryFallbackStore } {
  const store = memoryFallbackStore();
  return { port: memoryFallbackRegisterPort({ store }), store };
}

/** Seed a row by hand: a request text (and optionally a receipt text) no verb here could have written. */
function seed({
  store,
  requestId,
  requestText,
  receiptText,
}: {
  store: MemoryFallbackStore;
  requestId: string;
  requestText: string;
  receiptText: string | null;
}): void {
  store.rows.set(requestId, { receiptText, requestId, requestText });
}

/** Write a review request through the port, read it back, and answer it CLEAN through the port. */
async function answeredReview({ port, requestId }: { port: FallbackRegisterPort; requestId: string }): Promise<{
  readonly receipt: ClaudeFallbackReviewReceipt;
  readonly bytes: string;
}> {
  unwrap(
    await port.writeRequest({
      home: HOME,
      requestId,
      requestText: fallbackRequestText({ request: request({ requestId }) }),
    }),
  );
  const read = unwrap(storedReviewRequest({ stored: unwrap(await port.readRequest({ home: HOME, requestId })) }));
  const receipt = unwrap(
    validateFallbackReview({
      answer: ANSWER,
      completedAtIso: "2026-09-14T01:30:00.000Z",
      now: NOW,
      receiptId: `rcpt-${requestId}`,
      request: read.request,
      requestBytes: read.bytes,
      reviewer: { host: "claude-code", model: null, workspace: null },
    }),
  );
  unwrap(await port.writeReceipt({ home: HOME, receiptText: fallbackReceiptText({ receipt }), requestId }));
  return { bytes: read.bytes, receipt };
}

describe("the fallback record over the store", () => {
  it("round-trips a review request and reads it unanswered", async () => {
    const { port } = harness();
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "req-a",
        requestText: fallbackRequestText({ request: request({ requestId: "req-a" }) }),
      }),
    );
    const read = unwrap(
      storedReviewRequest({ stored: unwrap(await port.readRequest({ home: HOME, requestId: "req-a" })) }),
    );
    expect(read.request).toEqual(request({ requestId: "req-a" }));
    expect(read.answered).toBe(false);
  });

  it("binds a recorded receipt, reads the request answered, and scans it as a bound review", async () => {
    const { port } = harness();
    const { receipt } = await answeredReview({ port, requestId: "req-b" });
    expect(unwrap(await port.readRequest({ home: HOME, requestId: "req-b" })).receiptRecorded).toBe(true);
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.receipts).toEqual([receipt]);
    expect(scan.unreadable).toBe(0);
    expect(scan.pending).toBe(0);
  });

  it("counts a prepared-but-unanswered request as pending, not as evidence", async () => {
    const { port } = harness();
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "req-c",
        requestText: fallbackRequestText({ request: request({ requestId: "req-c" }) }),
      }),
    );
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.receipts).toEqual([]);
    expect(scan.pending).toBe(1);
  });

  it("places a receipt whose stored request text changed afterwards as UNBOUND on its branch, never as a row", async () => {
    const { port, store } = harness();
    const { bytes } = await answeredReview({ port, requestId: "req-d" });
    const row = store.rows.get("req-d")!;
    store.rows.set("req-d", { ...row, requestText: `${bytes}\n// edited after the fact\n` });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.receipts).toEqual([]);
    expect(scan.unreadable).toBe(0);
    expect(scan.unboundReceipts).toEqual([
      {
        branch: "feature",
        problem:
          "store codex_fallback_receipt req-d: receipt rcpt-req-d binds to request bytes that no longer match req-d",
        repoRoot: "/w/repo",
        requestId: "req-d",
      },
    ]);
    expect(incompleteScanReason({ ledger: CLEAN_LEDGER, receipts: scan, scan: CLEAN_RECORDS, ...JUDGED })).toBe(
      "1 Claude fallback receipt(s) on feature no longer bind to their request, so the review floor for this " +
        "branch cannot be judged: store codex_fallback_receipt req-d: receipt rcpt-req-d binds to request bytes " +
        "that no longer match req-d",
    );
  });

  it("an unbound receipt says nothing about a branch neither of its documents names", async () => {
    const { port, store } = harness();
    const { bytes } = await answeredReview({ port, requestId: "req-o" });
    const row = store.rows.get("req-o")!;
    store.rows.set("req-o", { ...row, requestText: `${bytes}\n// edited after the fact\n` });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(
      incompleteScanReason({ ledger: CLEAN_LEDGER, receipts: scan, scan: CLEAN_RECORDS, ...JUDGED, branch: "other" }),
    ).toBeUndefined();
    expect(
      incompleteScanReason({
        ledger: CLEAN_LEDGER,
        receipts: scan,
        scan: CLEAN_RECORDS,
        ...JUDGED,
        repoRoots: new Set(["/w/elsewhere"]),
      }),
    ).toBeUndefined();
  });

  it("a request rewritten to name another branch still refuses the branch its receipt's own copy answered", async () => {
    const { port, store } = harness();
    await answeredReview({ port, requestId: "req-p" });
    const row = store.rows.get("req-p")!;
    const moved = request({ requestId: "req-p" });
    store.rows.set("req-p", {
      ...row,
      requestText: fallbackRequestText({ request: { ...moved, tree: { ...moved.tree, branch: "elsewhere" } } }),
    });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.unboundReceipts.map((one) => one.branch).toSorted()).toEqual(["elsewhere", "feature"]);
    expect(incompleteScanReason({ ledger: CLEAN_LEDGER, receipts: scan, scan: CLEAN_RECORDS, ...JUDGED })).toContain(
      "1 Claude fallback receipt(s) on feature no longer bind to their request",
    );
  });

  it("an unbound receipt naming no checkout or branch at all still fails every branch closed", async () => {
    const { port, store } = harness();
    await answeredReview({ port, requestId: "req-r" });
    const row = store.rows.get("req-r")!;
    const receipt = JSON.parse(row.receiptText!) as { request: { tree: { branch: string | null } } };
    const detached = { ...receipt, request: { ...receipt.request, tree: { ...receipt.request.tree, branch: null } } };
    store.rows.set("req-r", { ...row, receiptText: JSON.stringify(detached), requestText: "{}" });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.unboundReceipts).toEqual([]);
    expect(scan.unreadable).toBe(1);
    expect(scan.problems[0]).toContain("receipt rcpt-req-r binds to request bytes that no longer match req-r");
  });

  it("reports a receipt that is not JSON as unreadable, naming the stored row", async () => {
    const { port, store } = harness();
    seed({
      receiptText: "{ not json",
      requestId: "req-e",
      requestText: fallbackRequestText({ request: request({ requestId: "req-e" }) }),
      store,
    });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.unreadable).toBe(1);
    expect(scan.problems[0]).toContain("not JSON");
    expect(scan.problems[0]).toContain("store codex_fallback_receipt req-e");
  });

  it("a PLAN request scans as a pending plan, then binds as a plan receipt", async () => {
    const { port } = harness();
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "plan-a",
        requestText: fallbackRequestText({ request: planRequest() }),
      }),
    );
    expect(unwrap(await port.scan({ home: HOME }))).toMatchObject({ pending: 0, pendingPlans: 1 });
    const read = unwrap(
      storedPlanRequest({ stored: unwrap(await port.readRequest({ home: HOME, requestId: "plan-a" })) }),
    );
    const receipt = unwrap(
      validateFallbackPlan({
        answer: PLAN_ANSWER,
        completedAtIso: "2026-09-15T16:05:00.000Z",
        now: NOW,
        planner: { host: "claude-code", model: null, workspace: null },
        receiptId: "plan-rcpt-a",
        request: read.request,
        requestBytes: read.bytes,
      }),
    );
    unwrap(await port.writeReceipt({ home: HOME, receiptText: fallbackReceiptText({ receipt }), requestId: "plan-a" }));
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.planReceipts).toEqual([receipt]);
    expect(scan.receipts).toEqual([]);
    expect(scan.pendingPlans).toBe(0);
    expect(scan.unreadable).toBe(0);
  });

  it("refuses to read a REVIEW request as a plan, naming the field that differs", async () => {
    const { port } = harness();
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "req-f",
        requestText: fallbackRequestText({ request: request({ requestId: "req-f" }) }),
      }),
    );
    const read = storedPlanRequest({ stored: unwrap(await port.readRequest({ home: HOME, requestId: "req-f" })) });
    expect(codexErrorLines({ error: read._unsafeUnwrapErr() })).toContain(
      'fallback plan request req-f: schemaVersion must be 1 and mode must be "plan" or "plan-codex-provider-unregistered"',
    );
  });

  it("an empty store is an empty scan, not an error", async () => {
    const { port } = harness();
    expect(unwrap(await port.scan({ home: HOME }))).toEqual({
      foreign: 0,
      foreignModes: [],
      foreignReceipts: [],
      unboundReceipts: [],
      pending: 0,
      pendingPlans: 0,
      planReceipts: [],
      problems: [],
      receipts: [],
      unreadable: 0,
    });
  });

  it("a request declaring a kind this build cannot read is FOREIGN, not unreadable", async () => {
    const { port, store } = harness();
    seed({ receiptText: "{ not json", requestId: "req-g", requestText: JSON.stringify({ mode: "triage" }), store });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.foreign).toBe(1);
    expect(scan.foreignModes).toEqual(["triage"]);
    expect(scan.unreadable).toBe(0);
    expect(scan.problems).toEqual([]);
  });

  it("the SAME receipt text beside a request declaring no kind IS unreadable — the control", async () => {
    const { port, store } = harness();
    seed({
      receiptText: "{ not json",
      requestId: "req-h",
      requestText: fallbackRequestText({ request: request({ requestId: "req-h" }) }),
      store,
    });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.unreadable).toBe(1);
    expect(scan.foreign).toBe(0);
  });

  it("two foreign kinds report each mode once, sorted, and neither is pending", async () => {
    const { port, store } = harness();
    seed({ receiptText: null, requestId: "req-j", requestText: JSON.stringify({ mode: "triage" }), store });
    seed({ receiptText: null, requestId: "req-k", requestText: JSON.stringify({ mode: "triage" }), store });
    seed({ receiptText: null, requestId: "req-l", requestText: JSON.stringify({ mode: "audit" }), store });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.foreign).toBe(3);
    expect(scan.foreignModes).toEqual(["audit", "triage"]);
    expect(scan.pending).toBe(0);
    expect(scan.pendingPlans).toBe(0);
  });

  it("an explicit mode of review, or a mode that is not a string, stays on the review reader", async () => {
    const { port, store } = harness();
    seed({ receiptText: "{ not json", requestId: "req-q", requestText: JSON.stringify({ mode: "review" }), store });
    seed({ receiptText: "{ not json", requestId: "req-m", requestText: JSON.stringify({ mode: 7 }), store });
    const scan = unwrap(await port.scan({ home: HOME }));
    expect(scan.foreign).toBe(0);
    expect(scan.unreadable).toBe(2);
  });

  it("reading a foreign request by id names the kind, as a review and as a plan", async () => {
    const { port, store } = harness();
    seed({ receiptText: null, requestId: "req-n", requestText: JSON.stringify({ mode: "triage" }), store });
    const stored = unwrap(await port.readRequest({ home: HOME, requestId: "req-n" }));
    expect(storedReviewRequest({ stored })._unsafeUnwrapErr()).toEqual(
      CodexErrors.requestKindMismatch({ declared: "triage", requestId: "req-n", wanted: "review" }),
    );
    expect(storedPlanRequest({ stored })._unsafeUnwrapErr()).toEqual(
      CodexErrors.requestKindMismatch({ declared: "triage", requestId: "req-n", wanted: "plan" }),
    );
  });

  it("reading a PLAN request as a review names the kind", async () => {
    const { port } = harness();
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "plan-a",
        requestText: fallbackRequestText({ request: planRequest() }),
      }),
    );
    const refused = storedReviewRequest({
      stored: unwrap(await port.readRequest({ home: HOME, requestId: "plan-a" })),
    });
    expect(refused._unsafeUnwrapErr().message).toBe("fallback request plan-a is a plan request, not a review one");
  });
});

describe("incompleteScanReason over a foreign kind", () => {
  it("a foreign request does not fail the landing gate closed, while an unreadable one does", async () => {
    const { port, store } = harness();
    seed({ receiptText: "{ not json", requestId: "req-o", requestText: JSON.stringify({ mode: "triage" }), store });
    const foreignScan = unwrap(await port.scan({ home: HOME }));
    expect(foreignScan.foreign).toBe(1);
    expect(
      incompleteScanReason({ ...JUDGED, ledger: CLEAN_LEDGER, receipts: foreignScan, scan: CLEAN_RECORDS }),
    ).toBeUndefined();

    seed({
      receiptText: "{ not json",
      requestId: "req-p",
      requestText: fallbackRequestText({ request: request({ requestId: "req-p" }) }),
      store,
    });
    const mixedScan = unwrap(await port.scan({ home: HOME }));
    expect(mixedScan.unreadable).toBe(1);
    expect(
      incompleteScanReason({ ...JUDGED, ledger: CLEAN_LEDGER, receipts: mixedScan, scan: CLEAN_RECORDS }),
    ).toContain("could not be read or no longer bind");
  });
});
