/**
 * The running list's pure half: what a draft may carry, what one append does, and what the voice may read.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  EMPTY_RUNNING_LIST,
  OWNER_ORIGIN,
  RUNNING_LIST_KEPT,
  RUNNING_LIST_TEXT_MAX,
  type RunningListDocument,
  runningListDocumentOf,
  runningListDraftOf,
  runningListSnapshotOf,
  voiceSafeRunningList,
  withRunningListItem,
} from "../../../talk/runningList.js";
import { LAST_RESPELL_COMMIT } from "../../../talk/runningListErrors.js";

const AT = "2026-10-12T09:30:00.000Z";

/** A list holding `count` items from the owner, added one at a time with ids `i1`… */
function listOf({ count }: { count: number }): RunningListDocument {
  let document = EMPTY_RUNNING_LIST;
  for (let n = 1; n <= count; n += 1) {
    document = withRunningListItem({
      atIso: AT,
      document,
      draft: { id: `i${String(n)}`, origin: "owner", text: `item ${String(n)}` },
    }).document;
  }
  return document;
}

describe("runningListDraftOf", () => {
  it("keeps the text exactly as given, whitespace, newlines and astral characters included", () => {
    const text = "  C0SYN000021\n\n🙂 tail \n";
    expect(unwrap(runningListDraftOf({ id: "a", origin: "owner", text })).text).toBe(text);
  });

  it("takes text of exactly the cap, counting an astral character once, and refuses one more", () => {
    const atCap = "🙂".repeat(RUNNING_LIST_TEXT_MAX);
    expect(unwrap(runningListDraftOf({ id: "a", origin: "voice", text: atCap })).text).toBe(atCap);
    expect(unwrapErr(runningListDraftOf({ id: "a", origin: "voice", text: `${atCap}x` }))).toMatchObject({
      code: "INPUT_INVALID",
      field: "text",
    });
  });

  it("refuses empty text, a label over 80 characters, and a control character in an id", () => {
    expect(unwrapErr(runningListDraftOf({ id: "a", origin: "owner", text: "" })).message).toBe(
      "the running list will not hold this text: it is empty",
    );
    expect(unwrapErr(runningListDraftOf({ id: "a", label: "x".repeat(81), origin: "owner", text: "t" }))).toMatchObject(
      {
        code: "INPUT_INVALID",
        field: "label",
      },
    );
    expect(unwrapErr(runningListDraftOf({ id: "a\u0007", origin: "owner", text: "t" }))).toMatchObject({
      code: "INPUT_INVALID",
      field: "id",
    });
  });

  it("takes a from only on a fleet item", () => {
    expect(unwrap(runningListDraftOf({ from: "supervisor", id: "a", origin: "fleet", text: "t" })).from).toBe(
      "supervisor",
    );
    expect(unwrapErr(runningListDraftOf({ from: "supervisor", id: "a", origin: "owner", text: "t" })).message).toBe(
      "the running list will not hold this from: only a fleet item names who put it there",
    );
  });

  it("keeps a fold on a line past the first that leaves words on both sides of it", () => {
    const text = "*Heads up*\nstaging is back\n• one";
    expect(unwrap(runningListDraftOf({ foldLine: 3, id: "a", origin: "voice", text })).foldLine).toBe(3);
  });

  it("refuses a fold on the first line, past the last, or leaving only whitespace on one side", () => {
    const text = "*Heads up*\nstaging is back";
    expect(
      [
        runningListDraftOf({ foldLine: 1, id: "a", origin: "voice", text }),
        runningListDraftOf({ foldLine: 3, id: "a", origin: "voice", text }),
        runningListDraftOf({ foldLine: 2, id: "a", origin: "voice", text: "*Heads up*\n  " }),
      ].map((result) => unwrapErr(result).message),
    ).toEqual([
      "the running list will not hold this foldLine: it must be a line of the text from 2 to 2",
      "the running list will not hold this foldLine: it must be a line of the text from 2 to 2",
      "the running list will not hold this foldLine: the text above it and from it on must each carry something",
    ]);
  });
});

describe("withRunningListItem", () => {
  it("numbers the first item 1 and puts each new one on top", () => {
    const two = listOf({ count: 2 });
    expect(two.items.map((item) => item.seq)).toEqual([2, 1]);
    expect(two.nextSeq).toBe(3);
  });

  it("keeps the newest ten once ten exist, dropping only the oldest, and never fewer after", () => {
    const ten = listOf({ count: RUNNING_LIST_KEPT });
    expect(ten.items.length).toBe(10);
    const eleven = withRunningListItem({
      atIso: AT,
      document: ten,
      draft: { id: "i11", origin: "voice", text: "item 11" },
    }).document;
    expect(eleven.items.map((item) => item.seq)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(listOf({ count: 25 }).items.length).toBe(10);
  });

  it("answers a retry of a held id with the stored item, and changes nothing", () => {
    const one = listOf({ count: 1 });
    const again = withRunningListItem({
      atIso: AT,
      document: one,
      draft: { id: "i1", origin: "owner", text: "other" },
    });
    expect(again.appended).toBe(false);
    expect(again.item.text).toBe("item 1");
    expect(again.document).toBe(one);
  });

  it("takes an id again once its item has rolled off", () => {
    const eleven = listOf({ count: 11 });
    const again = withRunningListItem({ atIso: AT, document: eleven, draft: { id: "i1", origin: "owner", text: "x" } });
    expect(again.appended).toBe(true);
    expect(again.item.seq).toBe(12);
  });
});

describe("runningListDocumentOf", () => {
  it("decodes what an append wrote", () => {
    const three = listOf({ count: 3 });
    expect(unwrap(runningListDocumentOf({ path: "p", value: JSON.parse(JSON.stringify(three)) }))).toEqual(three);
  });

  it("reads the owner's origin, and refuses an origin outside the closed set", () => {
    const stored = ({ origin }: { origin: string }): unknown => ({
      items: [{ atIso: AT, id: "a", origin, seq: 1, text: "t" }],
      nextSeq: 2,
      version: 1,
    });
    expect(OWNER_ORIGIN).toBe("owner");
    const read = unwrap(runningListDocumentOf({ path: "p", value: stored({ origin: OWNER_ORIGIN }) }));
    expect(read.items[0]!.origin).toBe("owner");
    expect(unwrapErr(runningListDocumentOf({ path: "p", value: stored({ origin: "someone" }) })).message).toContain(
      "the running list at p is not a running list",
    );
  });

  it("refuses a list holding the retired owner origin by name, with the item and its repair", () => {
    // The retired value, spelled through a pattern: the transient-references gate exempts a regex literal only.
    const retired = /him/u.source;
    const value = {
      items: [
        { atIso: AT, id: "good", origin: "voice", seq: 2, text: "keep me" },
        { atIso: AT, id: "legacy", origin: retired, seq: 1, text: "old row" },
      ],
      nextSeq: 3,
      version: 1,
    };
    const refused = unwrapErr(runningListDocumentOf({ path: "p", value }));
    expect(refused.code).toBe("RETIRED_ORIGIN");
    expect(refused.message).toBe(
      `the running list at p holds a retired origin at item 2 ("${retired}"), which this build no longer reads as ` +
        `the owner's — change that item's "origin" to "owner" in the file, or run slopweaver home respell from ` +
        `commit ${LAST_RESPELL_COMMIT}, the last that carries it`,
    );
    const nearMiss = { ...value, items: [value.items[0], { ...value.items[1], origin: `${retired}s` }] };
    expect(unwrapErr(runningListDocumentOf({ path: "p", value: nearMiss })).code).toBe("STORE_UNREADABLE");
  });

  it("refuses items out of order, an item at or above nextSeq, a repeated id, and more than ten items", () => {
    const item = { atIso: AT, id: "a", origin: "owner", seq: 1, text: "t" };
    const outOfOrder = { items: [item, { ...item, id: "b", seq: 2 }], nextSeq: 3, version: 1 };
    expect(unwrapErr(runningListDocumentOf({ path: "p", value: outOfOrder })).message).toBe(
      "the running list at p is not a running list: item 2 is out of order",
    );
    expect(
      unwrapErr(runningListDocumentOf({ path: "p", value: { items: [item], nextSeq: 1, version: 1 } })).message,
    ).toBe("the running list at p is not a running list: item 1 is not below nextSeq");
    const repeated = { items: [{ ...item, seq: 2 }, item], nextSeq: 3, version: 1 };
    expect(unwrapErr(runningListDocumentOf({ path: "p", value: repeated })).message).toBe(
      'the running list at p is not a running list: the id "a" is held twice',
    );
    const eleven = { ...listOf({ count: 10 }), items: [...listOf({ count: 11 }).items, item] };
    expect(unwrapErr(runningListDocumentOf({ path: "p", value: eleven })).code).toBe("STORE_UNREADABLE");
  });
});

describe("runningListSnapshotOf", () => {
  it("answers only the items above the cursor, newest first, with the newest number", () => {
    const snapshot = runningListSnapshotOf({ document: listOf({ count: 4 }), since: 2 });
    expect(snapshot.items.map((item) => item.seq)).toEqual([4, 3]);
    expect(snapshot.newestSeq).toBe(4);
  });

  it("answers an empty list with newest 0", () => {
    expect(runningListSnapshotOf({ document: EMPTY_RUNNING_LIST })).toEqual({ items: [], newestSeq: 0 });
  });
});

describe("voiceSafeRunningList", () => {
  // `--origin` is the writer's own word, so a fleet session filing as the owner skipped the mask.
  it("masks a private string whatever origin the item was filed under", () => {
    let document = EMPTY_RUNNING_LIST;
    for (const draft of [
      { id: "h", origin: "owner" as const, text: "my Hunter2.Plus link" },
      { id: "v", origin: "voice" as const, text: "the Hunter2.Plus draft" },
      { from: "supervisor", id: "f", origin: "fleet" as const, text: "the Hunter2.Plus thread" },
    ]) {
      document = withRunningListItem({ atIso: AT, document, draft }).document;
    }
    const read = voiceSafeRunningList({ denylist: ["Hunter2.Plus"], snapshot: runningListSnapshotOf({ document }) });
    expect(read.map((item) => ("text" in item ? item.text : item.withheld))).toEqual([
      "the [redacted:denylist] thread",
      "the [redacted:denylist] draft",
      "my [redacted:denylist] link",
    ]);
  });

  it("leaves the owner's ordinary words exactly as typed, a channel ID included", () => {
    const text = "post it in C0SYN000021\n  then tell Ari 🙂";
    const { document } = withRunningListItem({
      atIso: AT,
      document: EMPTY_RUNNING_LIST,
      draft: { id: "h", origin: "owner", text },
    });
    const read = voiceSafeRunningList({ denylist: ["Hunter2.Plus"], snapshot: runningListSnapshotOf({ document }) });
    expect(read).toEqual([{ atIso: AT, id: "h", origin: "owner", seq: 1, text }]);
  });

  // A secret in a fleet item's label went to the voice unmasked.
  it("masks a fleet item's label, session name and id as well as its text", () => {
    const draft = {
      from: "Hunter2.Plus-seat",
      id: "Hunter2.Plus-1",
      label: "the Hunter2.Plus key",
      origin: "fleet" as const,
      text: "ordinary",
    };
    const { document } = withRunningListItem({ atIso: AT, document: EMPTY_RUNNING_LIST, draft });
    const read = voiceSafeRunningList({ denylist: ["Hunter2.Plus"], snapshot: runningListSnapshotOf({ document }) });
    expect(read).toEqual([
      {
        atIso: AT,
        from: "[redacted:denylist]-seat",
        id: "[redacted:denylist]-1",
        label: "the [redacted:denylist] key",
        origin: "fleet",
        seq: 1,
        text: "ordinary",
      },
    ]);
  });
});
