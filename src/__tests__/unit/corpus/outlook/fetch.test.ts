/**
 * Unit: which Outlook folders a pass reads, and where each one's round starts. Drafts, Outbox, Junk Email and
 * Deleted Items are left out WITH every folder under them; a folder with no stored link, or any folder under an
 * explicit window, is read whole from an initial round.
 */
import { describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "#lib/result.js";
import {
  deltaStartFor,
  discoverOutlookMailFolders,
  excludedTree,
  firstOfEachFolder,
  outlookMailReadCap,
} from "../../../../corpus/outlook/fetch.js";
import type { OutlookApi } from "../../../../live/outlook/apiCore.js";
import { OutlookErrors } from "../../../../live/outlook/errors.js";
import type { OutlookFolder } from "../../../../live/outlook/folders.js";
import { fakeMailbox, fakeOutlookApi, wireFolder } from "../../../fakeOutlookMailbox.js";

const ANCHOR = {
  deltaLink: "https://graph.microsoft.com/v1.0/fake-delta/folder-inbox",
  recordedAtIso: "2026-10-02T00:00:00.000Z",
  version: 1,
} as const;

/** A mailbox with Deleted Items holding a user-made subfolder, and that subfolder a child of its own. */
function mailboxWithDeletedTree(): ReturnType<typeof fakeMailbox> {
  const mailbox = fakeMailbox();
  mailbox.folders.push(
    wireFolder({ id: "folder-deleted", over: { childFolderCount: 1, displayName: "Deleted Items" } }),
    wireFolder({
      id: "folder-old",
      over: { childFolderCount: 1, displayName: "Old", parentFolderId: "folder-deleted" },
    }),
    wireFolder({ id: "folder-older", over: { displayName: "Older", parentFolderId: "folder-old" } }),
  );
  mailbox.wellKnown["deleteditems"] = "folder-deleted";
  return mailbox;
}

/** One walked folder. */
function folder({ id, parentFolderId }: { id: string; parentFolderId: string | null }): OutlookFolder {
  return {
    childFolderCount: 0,
    displayName: id,
    id,
    parentFolderId,
    path: [id],
    totalItemCount: 0,
    unreadItemCount: 0,
  };
}

describe("outlookMailReadCap", () => {
  it("takes the tighter of the two caps, and none when neither was given", () => {
    expect(outlookMailReadCap({ fetchCap: 5, sample: 3 })).toEqual({ maxMessages: 3 });
    expect(outlookMailReadCap({ fetchCap: 2, sample: undefined })).toEqual({ maxMessages: 2 });
    expect(outlookMailReadCap({ fetchCap: undefined, sample: undefined })).toBeUndefined();
  });
});

describe("excludedTree", () => {
  it("takes every folder under an excluded root, whatever order the walk listed them in", () => {
    const folders = [
      folder({ id: "grandchild", parentFolderId: "child" }),
      folder({ id: "child", parentFolderId: "root-x" }),
      folder({ id: "root-x", parentFolderId: null }),
      folder({ id: "kept", parentFolderId: null }),
    ];
    expect([...excludedTree({ folders, roots: new Set(["root-x"]) })].toSorted()).toEqual([
      "child",
      "grandchild",
      "root-x",
    ]);
  });

  it("excludes nothing when there is no excluded root", () => {
    expect([...excludedTree({ folders: [folder({ id: "kept", parentFolderId: null })], roots: new Set() })]).toEqual(
      [],
    );
  });
});

describe("firstOfEachFolder", () => {
  it("keeps each folder id once, at its first appearance, so no folder is read twice in a pass", () => {
    const folders = [
      folder({ id: "folder-a", parentFolderId: null }),
      folder({ id: "folder-b", parentFolderId: null }),
      { ...folder({ id: "folder-a", parentFolderId: null }), displayName: "second listing" },
    ];
    expect(firstOfEachFolder({ folders }).map((kept) => [kept.id, kept.displayName])).toEqual([
      ["folder-a", "folder-a"],
      ["folder-b", "folder-b"],
    ]);
  });

  it("answers an empty walk with no folders", () => {
    expect(firstOfEachFolder({ folders: [] })).toEqual([]);
  });
});

describe("discoverOutlookMailFolders", () => {
  it("reads every visible folder bar an excluded tree, and notes a well-known folder the mailbox lacks", async () => {
    const discovered = unwrap(
      await discoverOutlookMailFolders({ api: fakeOutlookApi({ mailbox: mailboxWithDeletedTree() }) }),
    );
    expect(discovered.folders.map((read) => read.id)).toEqual(["folder-inbox", "folder-archive"]);
    expect(discovered.excluded).toBe(3);
    expect(discovered.truncated).toBe(false);
    expect(discovered.notes).toEqual([
      "this mailbox has no drafts folder, so there is nothing of it to leave out",
      "this mailbox has no outbox folder, so there is nothing of it to leave out",
      "this mailbox has no junkemail folder, so there is nothing of it to leave out",
    ]);
  });

  it("fails rather than reading on when an exclusion cannot be resolved for any reason but absence", async () => {
    const api: OutlookApi = {
      ...fakeOutlookApi({ mailbox: fakeMailbox() }),
      getFolder: async () => err(OutlookErrors.apiFailed({ message: "429 throttled" })),
    };
    expect(unwrapErr(await discoverOutlookMailFolders({ api })).message).toContain("429 throttled");
  });
});

describe("deltaStartFor", () => {
  it("reads a folder with no stored link from an initial round", () => {
    expect(deltaStartFor({ anchors: {}, cursorOverridden: false, folderId: "folder-inbox" })).toStrictEqual({
      first: { folderId: "folder-inbox" },
    });
  });

  it("resumes a folder from its stored link", () => {
    expect(
      deltaStartFor({ anchors: { "folder-inbox": ANCHOR }, cursorOverridden: false, folderId: "folder-inbox" }),
    ).toStrictEqual({ link: ANCHOR.deltaLink });
  });

  it("reads a folder whole under an explicit window, whatever link it holds", () => {
    expect(
      deltaStartFor({ anchors: { "folder-inbox": ANCHOR }, cursorOverridden: true, folderId: "folder-inbox" }),
    ).toStrictEqual({ first: { folderId: "folder-inbox" } });
  });
});
