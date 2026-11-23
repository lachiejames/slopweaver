/**
 * Unit: the plan/apply split. The seam is a plain object of functions — no vi.fn anywhere — and the calls
 * each fake records are what proves the split holds: a plan that reached `modifyMessage` would show up here
 * as a recorded call rather than as a passing test.
 */

import { describe, expect, it } from "vitest";
import { absentAsEmpty } from "#lib/absent.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi } from "../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import type { GmailLabel } from "../../../../live/gmail/labels.js";
import { applyGmailLabelChange, type GmailModifyPlan, planGmailLabelChange } from "../../../../live/gmail/modify.js";
import type { GmailMessage } from "../../../../live/gmail/parse.js";

const LABELS: readonly GmailLabel[] = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "UNREAD", name: "UNREAD", type: "system" },
  { id: "Label_7", name: "Waiting on", type: "user" },
];

/** Every mutating call a fake seam saw, so a test can assert that none happened. */
interface SeamCalls {
  readonly modifyMessage: { id: string; addLabelIds: readonly string[]; removeLabelIds: readonly string[] }[];
  readonly modifyThread: { id: string; addLabelIds: readonly string[]; removeLabelIds: readonly string[] }[];
}

/** A fake seam over fixed label state, recording every mutation it is asked to perform. */
function fakeApi({
  message = [],
  thread = [],
  labels = LABELS,
  labelsFail = false,
  modifyFails = false,
  afterLabels,
}: {
  message?: readonly string[];
  thread?: readonly (readonly string[])[];
  labels?: readonly GmailLabel[];
  labelsFail?: boolean;
  modifyFails?: boolean;
  afterLabels?: readonly string[];
}): { api: GmailApi; calls: SeamCalls } {
  const calls: SeamCalls = { modifyMessage: [], modifyThread: [] };
  const asMessage = ({ id, labelIds }: { id: string; labelIds: readonly string[] }): GmailMessage => ({
    id,
    labelIds: [...labelIds],
    threadId: "t-1",
  });
  const notForLabels = async (): Promise<never> => {
    throw new Error("a label change must never ask the mailbox for its profile or history");
  };
  const api: GmailApi = {
    getMessage: async ({ id }) => ok(asMessage({ id, labelIds: message })),
    getProfile: notForLabels,
    getThread: async () => ok(thread.map((labelIds, index) => asMessage({ id: `m-${String(index)}`, labelIds }))),
    listHistory: notForLabels,
    createDraft: notForLabels,
    getAttachment: notForLabels,
    getDraft: notForLabels,
    sendDraft: notForLabels,
    listLabels: async () => (labelsFail ? err(GmailErrors.apiFailed({ message: "labels unavailable" })) : ok(labels)),
    listMessageIds: async () => ok({ ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] }),
    modifyMessage: async ({ id, addLabelIds, removeLabelIds }) => {
      calls.modifyMessage.push({ addLabelIds, id, removeLabelIds });
      return modifyFails
        ? err(GmailErrors.apiFailed({ message: "modify refused" }))
        : ok(asMessage({ id, labelIds: absentAsEmpty({ value: afterLabels }) }));
    },
    modifyThread: async ({ id, addLabelIds, removeLabelIds }) => {
      calls.modifyThread.push({ addLabelIds, id, removeLabelIds });
      return modifyFails
        ? err(GmailErrors.apiFailed({ message: "modify refused" }))
        : ok([asMessage({ id: "m-0", labelIds: absentAsEmpty({ value: afterLabels }) })]);
    },
  };
  return { api, calls };
}

/** The arguments a message-scoped archive plan takes, so each test states only what it varies. */
function archiveOf({ api }: { api: GmailApi }): ReturnType<typeof planGmailLabelChange> {
  return planGmailLabelChange({
    account: "owner@example.test",
    addRefs: [],
    address: "m-1",
    api,
    intent: "archive",
    removeRefs: ["INBOX"],
    scope: "message",
  });
}

describe("planGmailLabelChange", () => {
  it("resolves a display name to its id and sends nothing", async () => {
    const { api, calls } = fakeApi({ message: ["INBOX"] });
    const plan = unwrap(
      await planGmailLabelChange({
        account: "owner@example.test",
        addRefs: ["Waiting on"],
        address: "m-1",
        api,
        intent: "label",
        removeRefs: [],
        scope: "message",
      }),
    );
    expect(plan.plan.addLabelIds).toStrictEqual(["Label_7"]);
    expect(calls.modifyMessage).toStrictEqual([]);
    expect(calls.modifyThread).toStrictEqual([]);
  });

  it("carries a display name for every id it mentions, so a report never shows a bare Label_7", async () => {
    const { api } = fakeApi({ message: [] });
    const plan = unwrap(
      await planGmailLabelChange({
        account: "owner@example.test",
        addRefs: ["Label_7"],
        address: "m-1",
        api,
        intent: "label",
        removeRefs: [],
        scope: "message",
      }),
    );
    expect(plan.labelNames["Label_7"]).toBe("Waiting on");
  });

  it("narrows a message-scope plan against the one message state it read", async () => {
    const { api } = fakeApi({ message: ["INBOX"] });
    const plan = unwrap(
      await planGmailLabelChange({
        account: "owner@example.test",
        addRefs: ["INBOX"],
        address: "m-1",
        api,
        intent: "label",
        removeRefs: [],
        scope: "message",
      }),
    );
    expect(plan.before).toStrictEqual([{ id: "m-1", labelIds: ["INBOX"] }]);
    expect(plan.plan.noop).toBe(true);
  });

  it("narrows an archive that has already happened to a noop", async () => {
    const { api } = fakeApi({ message: ["UNREAD"] });
    const plan = unwrap(await archiveOf({ api }));
    expect(plan.plan.noop).toBe(true);
    expect(plan.plan.removeLabelIds).toStrictEqual([]);
  });

  it("plans a real archive when the message is in the inbox", async () => {
    const { api } = fakeApi({ message: ["INBOX", "UNREAD"] });
    const plan = unwrap(await archiveOf({ api }));
    expect(plan.plan.removeLabelIds).toStrictEqual(["INBOX"]);
    expect(plan.before).toStrictEqual([{ id: "m-1", labelIds: ["INBOX", "UNREAD"] }]);
  });

  it("reads every message in a thread and does not narrow against the first", async () => {
    const { api } = fakeApi({ thread: [["INBOX"], ["INBOX", "UNREAD"]] });
    const plan = unwrap(
      await planGmailLabelChange({
        account: "owner@example.test",
        addRefs: [],
        address: "t-1",
        api,
        intent: "mark read",
        removeRefs: ["UNREAD"],
        scope: "thread",
      }),
    );
    expect(plan.plan.removeLabelIds).toStrictEqual(["UNREAD"]);
    expect(plan.before.length).toBe(2);
  });

  it("refuses adding TRASH before it reads any message state", async () => {
    const { api, calls } = fakeApi({ message: ["INBOX"], labels: [{ id: "TRASH", name: "TRASH", type: "system" }] });
    const failed = await planGmailLabelChange({
      account: "owner@example.test",
      addRefs: ["TRASH"],
      address: "m-1",
      api,
      intent: "label",
      removeRefs: [],
      scope: "message",
    });
    expect(failed.isErr()).toBe(true);
    expect(unwrapErr(failed).code).toBe("INVALID_ADDRESS");
    expect(calls.modifyMessage).toStrictEqual([]);
  });

  it("allows REMOVING spam — the rail is one-directional, so mail can be rescued from it", async () => {
    const { api } = fakeApi({
      labels: [{ id: "SPAM", name: "SPAM", type: "system" }],
      message: ["SPAM"],
    });
    const plan = unwrap(
      await planGmailLabelChange({
        account: "owner@example.test",
        addRefs: [],
        address: "m-1",
        api,
        intent: "label",
        removeRefs: ["SPAM"],
        scope: "message",
      }),
    );
    expect(plan.plan.removeLabelIds).toStrictEqual(["SPAM"]);
  });

  it("surfaces an unresolvable label as the typed address failure", async () => {
    const { api } = fakeApi({ message: ["INBOX"] });
    const failed = await planGmailLabelChange({
      account: "owner@example.test",
      addRefs: ["Nope"],
      address: "m-1",
      api,
      intent: "label",
      removeRefs: [],
      scope: "message",
    });
    expect(unwrapErr(failed).code).toBe("INVALID_ADDRESS");
  });

  it("surfaces a label-list failure rather than planning against an empty vocabulary", async () => {
    const { api } = fakeApi({ labelsFail: true, message: ["INBOX"] });
    const failed = await archiveOf({ api });
    expect(unwrapErr(failed).code).toBe("API_FAILED");
  });
});

describe("applyGmailLabelChange", () => {
  const planFor = ({ noop, scope }: { noop: boolean; scope: "message" | "thread" }): GmailModifyPlan => ({
    account: "owner@example.test",
    address: scope === "thread" ? "t-1" : "m-1",
    before: [{ id: "m-1", labelIds: ["INBOX"] }],
    intent: "archive",
    labelNames: { INBOX: "INBOX" },
    plan: { addLabelIds: [], noop, removeLabelIds: noop ? [] : ["INBOX"] },
    scope,
  });

  it("sends the message mutation and reports the state read back", async () => {
    const { api, calls } = fakeApi({ afterLabels: ["UNREAD"] });
    const outcome = unwrap(await applyGmailLabelChange({ api, plan: planFor({ noop: false, scope: "message" }) }));
    expect(calls.modifyMessage).toStrictEqual([{ addLabelIds: [], id: "m-1", removeLabelIds: ["INBOX"] }]);
    expect(outcome.after).toStrictEqual([{ id: "m-1", labelIds: ["UNREAD"] }]);
  });

  it("sends the thread mutation for a thread-scoped plan", async () => {
    const { api, calls } = fakeApi({ afterLabels: [] });
    await applyGmailLabelChange({ api, plan: planFor({ noop: false, scope: "thread" }) });
    expect(calls.modifyThread).toStrictEqual([{ addLabelIds: [], id: "t-1", removeLabelIds: ["INBOX"] }]);
    expect(calls.modifyMessage).toStrictEqual([]);
  });

  it("sends NOTHING for a noop plan — Gmail would accept it and report success", async () => {
    const { api, calls } = fakeApi({});
    const outcome = unwrap(await applyGmailLabelChange({ api, plan: planFor({ noop: true, scope: "message" }) }));
    expect(calls.modifyMessage).toStrictEqual([]);
    expect(outcome.residue).toStrictEqual(["nothing was sent — the mailbox is already in this state"]);
  });

  it("states in residue that a single-message change left the rest of the thread alone", async () => {
    const { api } = fakeApi({ afterLabels: [] });
    const outcome = unwrap(await applyGmailLabelChange({ api, plan: planFor({ noop: false, scope: "message" }) }));
    expect(outcome.residue.join(" ")).toContain("--thread");
  });

  it("states in residue that the read-before-write is not atomic", async () => {
    const { api } = fakeApi({ afterLabels: [] });
    const outcome = unwrap(await applyGmailLabelChange({ api, plan: planFor({ noop: false, scope: "message" }) }));
    expect(outcome.residue.join(" ")).toContain("compare-and-set");
  });

  it("says the new labels were ASKED for, not read back, when the API returned no state", async () => {
    const { api } = fakeApi({});
    const outcome = unwrap(await applyGmailLabelChange({ api, plan: planFor({ noop: false, scope: "thread" }) }));
    expect(outcome.after).toStrictEqual([{ id: "m-0", labelIds: [] }]);
    expect(outcome.residue.join(" ")).toContain("every message in thread");
  });

  it("keeps a read-back message Gmail named no id for, labelled `(no id)` with its labels as evidence", async () => {
    const { api } = fakeApi({});
    const anonymous: GmailApi = { ...api, modifyMessage: async () => ok({ labelIds: ["UNREAD"], threadId: "t-1" }) };
    const plan = planFor({ noop: false, scope: "message" });
    const outcome = unwrap(await applyGmailLabelChange({ api: anonymous, plan }));
    expect(outcome.after).toStrictEqual([{ id: "(no id)", labelIds: ["UNREAD"] }]);
  });

  it("surfaces a failed mutation as the typed API failure", async () => {
    const { api } = fakeApi({ modifyFails: true });
    const failed = await applyGmailLabelChange({ api, plan: planFor({ noop: false, scope: "message" }) });
    expect(unwrapErr(failed).code).toBe("API_FAILED");
    expect(unwrapErr(failed).message).toBe("modify refused");
  });
});
