/**
 * Folders and the measurement built on them: the visible hierarchy, resolving a typed reference to exactly one
 * folder, and counters summed with a coverage line that says what they are not.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  isWellKnownFolder,
  type OutlookFolder,
  pickFolder,
  resolveFolderId,
  toOutlookFolder,
  walkFolders,
} from "../../../../live/outlook/folders.js";
import { measureFolders, measureOutlook, OUTLOOK_MEASURE_COVERAGE } from "../../../../live/outlook/measure.js";
import { fakeMailbox, fakeOutlookApi, wireFolder } from "../../../fakeOutlookMailbox.js";

/** A mailbox with a nested folder, a hidden folder and two same-named folders at different depths. */
function nestedMailbox() {
  const mailbox = fakeMailbox();
  mailbox.folders.length = 0;
  mailbox.folders.push(
    wireFolder({
      id: "folder-inbox",
      over: { childFolderCount: 2, displayName: "Inbox", totalItemCount: 3, unreadItemCount: 2 },
    }),
    wireFolder({ id: "folder-archive", over: { displayName: "Archive", totalItemCount: 5 } }),
    wireFolder({ id: "folder-hidden", over: { displayName: "Secret", isHidden: true, totalItemCount: 99 } }),
    wireFolder({
      id: "folder-receipts",
      over: { displayName: "Receipts", parentFolderId: "folder-inbox", totalItemCount: 4, unreadItemCount: 1 },
    }),
    wireFolder({ id: "folder-top-twin", over: { displayName: "Twin", totalItemCount: 1 } }),
    wireFolder({ id: "folder-deep-twin", over: { displayName: "twin", parentFolderId: "folder-inbox" } }),
  );
  return mailbox;
}

/** A walked folder for the pure picks. */
function folder({ id, name, path }: { id: string; name: string; path: readonly string[] }): OutlookFolder {
  return {
    childFolderCount: 0,
    displayName: name,
    id,
    parentFolderId: null,
    path,
    totalItemCount: 1,
    unreadItemCount: 0,
  };
}

describe("isWellKnownFolder", () => {
  it("recognises Graph's names case-insensitively", () => {
    expect(isWellKnownFolder({ reference: "Inbox" })).toBe(true);
    expect(isWellKnownFolder({ reference: "SentItems" })).toBe(true);
  });

  it("does not treat a display name as well known", () => {
    expect(isWellKnownFolder({ reference: "Receipts" })).toBe(false);
  });
});

describe("toOutlookFolder", () => {
  it("builds the path from the parents above plus its own name", () => {
    const mapped = unwrap(
      toOutlookFolder({ folder: wireFolder({ id: "f1", over: { displayName: "Kid" } }), path: ["Inbox"] }),
    );

    expect(mapped.path).toEqual(["Inbox", "Kid"]);
  });

  it("refuses a folder with no display name", () => {
    const refused = toOutlookFolder({ folder: wireFolder({ id: "f1", over: { displayName: null } }), path: [] });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
    expect(unwrapErr(refused).message).toContain("displayName");
  });

  it("refuses a folder with no counters", () => {
    const refused = toOutlookFolder({
      folder: wireFolder({ id: "f1", over: { totalItemCount: undefined } }),
      path: [],
    });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
    expect(unwrapErr(refused).message).toContain("item counts");
  });
});

describe("walkFolders", () => {
  it("walks top level then children, leaving hidden folders out", async () => {
    const walk = unwrap(await walkFolders({ api: fakeOutlookApi({ mailbox: nestedMailbox() }) }));

    expect(walk.truncated).toBe(false);
    expect(walk.folders.map((entry) => entry.path.join("/"))).toEqual([
      "Inbox",
      "Archive",
      "Twin",
      "Inbox/Receipts",
      "Inbox/twin",
    ]);
  });

  it("refuses a folder missing a counter", async () => {
    const mailbox = fakeMailbox();
    mailbox.folders[0] = wireFolder({ id: "folder-inbox", over: { unreadItemCount: undefined } });

    const refused = await walkFolders({ api: fakeOutlookApi({ mailbox }) });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
  });
});

describe("pickFolder", () => {
  const folders = [
    folder({ id: "f-a", name: "Receipts", path: ["Inbox", "Receipts"] }),
    folder({ id: "f-b", name: "Twin", path: ["Twin"] }),
    folder({ id: "f-c", name: "twin", path: ["Inbox", "twin"] }),
  ];

  it("picks by id", () => {
    expect(unwrap(pickFolder({ folders, reference: "f-b" })).id).toBe("f-b");
  });

  it("picks a unique display name case-insensitively", () => {
    expect(unwrap(pickFolder({ folders, reference: "RECEIPTS" })).id).toBe("f-a");
  });

  it("refuses a name matching two folders, naming each id", () => {
    const refused = pickFolder({ folders, reference: "twin" });

    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
    expect(unwrapErr(refused).message).toContain("Twin (f-b)");
    expect(unwrapErr(refused).message).toContain("Inbox/twin (f-c)");
  });

  it("refuses a name matching nothing", () => {
    const refused = pickFolder({ folders, reference: "nothing" });

    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
    expect(unwrapErr(refused).message).toContain('no folder matches "nothing"');
  });
});

describe("resolveFolderId", () => {
  it("answers a well-known name as itself, lower-cased, without walking", async () => {
    const mailbox = nestedMailbox();
    mailbox.folders.length = 0;

    expect(unwrap(await resolveFolderId({ api: fakeOutlookApi({ mailbox }), reference: "Archive" }))).toBe("archive");
  });

  it("resolves a display name through the walk", async () => {
    const id = await resolveFolderId({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), reference: "receipts" });

    expect(unwrap(id)).toBe("folder-receipts");
  });

  it("refuses an ambiguous display name", async () => {
    const refused = await resolveFolderId({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), reference: "twin" });

    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
  });
});

describe("measureFolders", () => {
  it("sums the counters and carries the not-exact coverage line", () => {
    const measure = measureFolders({
      folders: [
        { ...folder({ id: "a", name: "A", path: ["A"] }), totalItemCount: 3, unreadItemCount: 2 },
        { ...folder({ id: "b", name: "B", path: ["A", "B"] }), totalItemCount: 4, unreadItemCount: 1 },
      ],
      truncated: false,
    });

    expect(measure).toEqual({
      coverage: OUTLOOK_MEASURE_COVERAGE,
      exact: false,
      folders: [
        { id: "a", path: "A", totalItemCount: 3, unreadItemCount: 2 },
        { id: "b", path: "A/B", totalItemCount: 4, unreadItemCount: 1 },
      ],
      totalItemCount: 7,
      truncated: false,
      unreadItemCount: 3,
    });
  });

  it("sums nothing for no folders", () => {
    const measure = measureFolders({ folders: [], truncated: true });

    expect(measure.totalItemCount).toBe(0);
    expect(measure.truncated).toBe(true);
  });
});

describe("measureOutlook", () => {
  it("measures every visible folder", async () => {
    const measure = unwrap(
      await measureOutlook({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), folder: undefined }),
    );

    expect(measure.folders.map((row) => row.path)).toEqual([
      "Inbox",
      "Archive",
      "Twin",
      "Inbox/Receipts",
      "Inbox/twin",
    ]);
    expect(measure.totalItemCount).toBe(3 + 5 + 1 + 4 + 0);
    expect(measure.unreadItemCount).toBe(3);
  });

  it("measures one folder by display name", async () => {
    const measure = unwrap(
      await measureOutlook({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), folder: "Receipts" }),
    );

    expect(measure.folders).toEqual([
      { id: "folder-receipts", path: "Inbox/Receipts", totalItemCount: 4, unreadItemCount: 1 },
    ]);
    expect(measure.truncated).toBe(false);
  });

  it("resolves a well-known name through Graph before picking", async () => {
    const measure = unwrap(
      await measureOutlook({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), folder: "Archive" }),
    );

    expect(measure.folders.map((row) => row.id)).toEqual(["folder-archive"]);
  });

  it("refuses a well-known name the mailbox does not have", async () => {
    const refused = await measureOutlook({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), folder: "drafts" });

    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
  });

  it("refuses an unknown display name", async () => {
    const refused = await measureOutlook({ api: fakeOutlookApi({ mailbox: nestedMailbox() }), folder: "Nowhere" });

    expect(unwrapErr(refused).code).toBe("REFERENCE_UNRESOLVED");
    expect(unwrapErr(refused).message).toContain('"Nowhere"');
  });
});
