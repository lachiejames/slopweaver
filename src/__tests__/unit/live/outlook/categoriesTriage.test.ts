/**
 * Categories (master list, reference resolution, absolute next lists) and triage (inbox grouped by sender).
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  listOutlookCategories,
  nextCategories,
  type OutlookCategory,
  resolveCategoryChange,
} from "../../../../live/outlook/categories.js";
import type { OutlookMessageSummary } from "../../../../live/outlook/messages.js";
import { groupBySender, triageOutlook } from "../../../../live/outlook/triage.js";
import { fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";

const MASTER: readonly OutlookCategory[] = [
  { color: "preset0", displayName: "Waiting on", id: "cat-waiting" },
  { color: null, displayName: "Done", id: "cat-done" },
];

/** A listing row with any field overridden. */
function row({ id, over = {} }: { id: string; over?: Partial<OutlookMessageSummary> }): OutlookMessageSummary {
  return {
    categories: [],
    conversationId: "conv-1",
    folderId: "folder-inbox",
    from: { address: "sender@example.test", name: "Sender One" },
    hasAttachments: false,
    id,
    isRead: false,
    preview: "",
    receivedIso: "2026-10-01T09:00:00Z",
    subject: `Subject ${id}`,
    ...over,
  };
}

describe("listOutlookCategories", () => {
  it("maps the master list, keeping a null colour null", async () => {
    const mailbox = fakeMailbox();
    mailbox.categories.push({ color: null, displayName: "Uncoloured", id: "cat-plain" });

    const categories = unwrap(await listOutlookCategories({ api: fakeOutlookApi({ mailbox }) }));

    expect(categories).toEqual([
      { color: "preset0", displayName: "Waiting on", id: "cat-waiting" },
      { color: "preset1", displayName: "Done", id: "cat-done" },
      { color: null, displayName: "Uncoloured", id: "cat-plain" },
    ]);
  });
});

describe("resolveCategoryChange", () => {
  it("resolves ids and case-insensitive names to display names", () => {
    const change = unwrap(resolveCategoryChange({ add: ["cat-waiting"], master: MASTER, remove: ["DONE"] }));

    expect(change).toEqual({ add: ["Waiting on"], remove: ["Done"] });
  });

  it("collapses a duplicate reference to one name", () => {
    const change = unwrap(resolveCategoryChange({ add: ["done", "cat-done"], master: MASTER, remove: [] }));

    expect(change.add).toEqual(["Done"]);
  });

  it("refuses a name the master list does not hold, rather than minting a category", () => {
    const refused = resolveCategoryChange({ add: ["Dnoe"], master: MASTER, remove: [] });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
    expect(unwrapErr(refused).message).toContain('no category matches "Dnoe"');
  });

  it("refuses an unknown name in remove too", () => {
    const refused = resolveCategoryChange({ add: [], master: MASTER, remove: ["Nope"] });

    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
  });

  it("refuses a category added and removed at once, even by id and by name", () => {
    const refused = resolveCategoryChange({ add: ["cat-done"], master: MASTER, remove: ["done"] });

    expect(unwrapErr(refused).code).toBe("CATEGORY_CONFLICT");
    expect(unwrapErr(refused).message).toContain("Done is both added and removed");
  });
});

describe("nextCategories", () => {
  it("removes, then appends additions not already carried", () => {
    expect(
      nextCategories({ change: { add: ["Done", "New"], remove: ["Old"] }, current: ["Keep", "Old", "Done"] }),
    ).toEqual({
      categories: ["Keep", "Done", "New"],
      changed: true,
    });
  });

  it("reports unchanged when the list would be identical", () => {
    expect(nextCategories({ change: { add: ["Done"], remove: ["Absent"] }, current: ["Done"] })).toEqual({
      categories: ["Done"],
      changed: false,
    });
  });

  it("reports a pure removal as changed", () => {
    expect(nextCategories({ change: { add: [], remove: ["Done"] }, current: ["Done"] })).toEqual({
      categories: [],
      changed: true,
    });
  });
});

describe("groupBySender", () => {
  it("groups case-insensitively by address, newest group first, newest message first within it", () => {
    const groups = groupBySender({
      messages: [
        row({
          id: "a-old",
          over: { from: { address: "Alex@Example.test", name: "Alex" }, receivedIso: "2026-10-01T09:00:00Z" },
        }),
        row({
          id: "b-new",
          over: { from: { address: "bo@example.test", name: "Bo" }, receivedIso: "2026-10-05T09:00:00Z" },
        }),
        row({
          id: "a-new",
          over: {
            from: { address: "alex@example.test", name: "Alex Newer" },
            isRead: true,
            receivedIso: "2026-10-03T09:00:00Z",
          },
        }),
      ],
    });

    expect(groups.map((group) => group.key)).toEqual(["bo@example.test", "alex@example.test"]);
    const alex = groups[1]!;
    expect(alex.count).toBe(2);
    expect(alex.unread).toBe(1);
    expect(alex.name).toBe("Alex Newer");
    expect(alex.newestIso).toBe("2026-10-03T09:00:00Z");
    expect(alex.messages.map((message) => message.id)).toEqual(["a-new", "a-old"]);
  });

  it("keys an address-less sender by name, and one with neither as unknown", () => {
    const groups = groupBySender({
      messages: [
        row({
          id: "named",
          over: { from: { address: null, name: "System Mail" }, receivedIso: "2026-10-03T09:00:00Z" },
        }),
        row({ id: "nobody", over: { from: null, receivedIso: "2026-10-02T09:00:00Z" } }),
      ],
    });

    expect(groups.map((group) => group.key)).toEqual(["name:System Mail", "(unknown sender)"]);
    expect(groups[1]!.address).toBe(null);
    expect(groups[1]!.name).toBe(null);
  });

  it("returns no groups for no messages", () => {
    expect(groupBySender({ messages: [] })).toEqual([]);
  });
});

describe("triageOutlook", () => {
  it("groups the inbox by sender", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "m1", over: { receivedDateTime: "2026-10-01T09:00:00Z" } }),
        wireMessage({
          id: "m2",
          over: {
            from: { emailAddress: { address: "other@example.test", name: "Other" } },
            receivedDateTime: "2026-10-02T09:00:00Z",
          },
        }),
        wireMessage({ id: "m3", over: { receivedDateTime: "2026-10-03T09:00:00Z" } }),
        wireMessage({ id: "elsewhere", over: { parentFolderId: "folder-archive" } }),
      ],
    });

    const triage = unwrap(await triageOutlook({ api: fakeOutlookApi({ mailbox }), limit: 10 }));

    expect(triage.messages).toBe(3);
    expect(triage.more).toBe(false);
    expect(triage.groups.map((group) => [group.key, group.count])).toEqual([
      ["sender@example.test", 2],
      ["other@example.test", 1],
    ]);
  });

  it("refuses an inbox row missing a field", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "bad", over: { hasAttachments: undefined } })] });

    const refused = await triageOutlook({ api: fakeOutlookApi({ mailbox }), limit: 10 });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
  });
});
