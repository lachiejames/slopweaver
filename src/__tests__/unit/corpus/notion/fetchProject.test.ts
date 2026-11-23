/**
 * The Notion fetch edge's pure readers and projectors: title precedence, block readers, the `since` cutoff and
 * its inclusive edge, and the database, page, row, user and comment projections, each compared whole.
 */
import { describe, expect, it } from "vitest";

import {
  blockBorrowsContent,
  blockChildId,
  blockMentions,
  blockTextLine,
  cutoffMs,
  lastEditedOf,
  notionNextCursor,
  projectCommentItem,
  projectDatabaseItem,
  projectNotionUser,
  projectPageItem,
  projectRowItem,
  titleFrom,
  withinCutoff,
} from "../../../../corpus/notion/fetchProject.js";

const FETCHED_AT = "2026-10-13T09:00:00.000Z";
/** The first of September, midnight UTC, in epoch milliseconds. */
const SEPT_FIRST_MS = 1_788_220_800_000;

/** One plain rich-text span. */
function span({ text }: { text: string }): Record<string, unknown> {
  return { plain_text: text, type: "text" };
}

describe("titleFrom", () => {
  it("renders a top-level title array", () => {
    expect(titleFrom({ raw: { title: [span({ text: "Road" }), span({ text: "map" })] } })).toBe("Roadmap");
  });

  it("reads the first title-typed property when there is no top-level title array", () => {
    const raw = {
      properties: {
        Notes: { rich_text: [span({ text: "ignored" })], type: "rich_text" },
        Name: { title: [span({ text: "Row title" })], type: "title" },
      },
    };

    expect(titleFrom({ raw })).toBe("Row title");
  });

  it("renders a present top-level title array even when empty, without consulting the properties", () => {
    const raw = { properties: { Name: { title: [span({ text: "Masked" })], type: "title" } }, title: [] };

    expect(titleFrom({ raw })).toBe("");
  });

  it("answers (untitled) when neither shape is present, and empty for a present but empty title property", () => {
    expect(titleFrom({ raw: { properties: { Notes: { rich_text: [], type: "rich_text" } } } })).toBe("(untitled)");
    expect(titleFrom({ raw: {} })).toBe("(untitled)");
    expect(titleFrom({ raw: { properties: { Name: { title: [], type: "title" } } } })).toBe("");
  });
});

describe("block readers", () => {
  it("renders a paragraph's rich text and an empty line for a divider", () => {
    expect(blockTextLine({ block: { paragraph: { rich_text: [span({ text: "Hello" })] }, type: "paragraph" } })).toBe(
      "Hello",
    );
    expect(blockTextLine({ block: { divider: {}, type: "divider" } })).toBe("");
  });

  it("lists explicit page, database and user mentions in span order and ignores a date mention", () => {
    const block = {
      paragraph: {
        rich_text: [
          { mention: { type: "user", user: { id: "u-1" } }, type: "mention" },
          span({ text: "plain prose mentioning page p-9" }),
          { mention: { page: { id: "p-1" }, type: "page" }, type: "mention" },
          { mention: { date: { start: "2026-09-01" }, type: "date" }, type: "mention" },
          { mention: { database: { id: "d-1" }, type: "database" }, type: "mention" },
        ],
      },
      type: "paragraph",
    };

    expect(blockMentions({ block })).toEqual(["notion:user:u-1", "notion:page:p-1", "notion:database:d-1"]);
    expect(blockMentions({ block: { type: "paragraph" } })).toEqual([]);
  });

  it("marks the three borrowed-content block types and not a near neighbour", () => {
    const borrowed = ["child_page", "child_database", "synced_block"].map((type) =>
      blockBorrowsContent({ block: { type } }),
    );

    expect(borrowed).toEqual([true, true, true]);
    expect(blockBorrowsContent({ block: { type: "link_to_page" } })).toBe(false);
    expect(blockBorrowsContent({ block: {} })).toBe(false);
  });

  it("names a child id only for has_children true with a string id", () => {
    expect(blockChildId({ block: { has_children: true, id: "b-1" } })).toBe("b-1");
    expect(blockChildId({ block: { has_children: false, id: "b-1" } })).toBe(undefined);
    expect(blockChildId({ block: { has_children: "true", id: "b-1" } })).toBe(undefined);
    expect(blockChildId({ block: { has_children: true, id: 42 } })).toBe(undefined);
  });
});

describe("cutoffMs", () => {
  it("means no cutoff at the epoch date and before it, and a real cutoff the day after", () => {
    expect(cutoffMs({ since: "1969-12-31" })).toBe(undefined);
    expect(cutoffMs({ since: "1970-01-01" })).toBe(undefined);
    expect(cutoffMs({ since: "1970-01-02" })).toBe(86_400_000);
  });

  it("yields the UTC-midnight millisecond value of a real date", () => {
    expect(cutoffMs({ since: "2026-09-01" })).toBe(1_788_220_800_000);
  });
});

describe("withinCutoff", () => {
  it("accepts a timestamp exactly at the cutoff and refuses one a millisecond before it", () => {
    expect(withinCutoff({ cutoff: SEPT_FIRST_MS, lastEdited: "2026-09-01T00:00:00.000Z" })).toBe(true);
    expect(withinCutoff({ cutoff: SEPT_FIRST_MS, lastEdited: "2026-08-31T23:59:59.999Z" })).toBe(false);
  });

  it("keeps an empty or unparseable timestamp, and keeps everything with no cutoff", () => {
    expect(withinCutoff({ cutoff: SEPT_FIRST_MS, lastEdited: "" })).toBe(true);
    expect(withinCutoff({ cutoff: SEPT_FIRST_MS, lastEdited: "not a date" })).toBe(true);
    expect(withinCutoff({ cutoff: undefined, lastEdited: "2001-01-01T00:00:00.000Z" })).toBe(true);
  });
});

describe("notionNextCursor and lastEditedOf", () => {
  it("reads a non-empty cursor and nothing for an empty or absent one", () => {
    expect(notionNextCursor({ value: "cur-1" })).toBe("cur-1");
    expect(notionNextCursor({ value: "" })).toBe(undefined);
    expect(notionNextCursor({ value: null })).toBe(undefined);
  });

  it("reads a string last_edited_time and empty for a missing or non-string one", () => {
    expect(lastEditedOf({ raw: { last_edited_time: "2026-09-02T00:00:00.000Z" } })).toBe("2026-09-02T00:00:00.000Z");
    expect(lastEditedOf({ raw: {} })).toBe("");
    expect(lastEditedOf({ raw: { last_edited_time: 5 } })).toBe("");
  });
});

describe("projectDatabaseItem", () => {
  it("projects a data-source hit with its title, url and an empty description", () => {
    const raw = { title: [span({ text: "Tasks" })], url: "https://notion.so/tasks" };

    expect(projectDatabaseItem({ id: "ds-1", lastEdited: "2026-09-02T00:00:00.000Z", raw })).toEqual({
      description: "",
      id: "ds-1",
      raw,
      title: "Tasks",
      tsIso: "2026-09-02T00:00:00.000Z",
      url: "https://notion.so/tasks",
    });
  });
});

describe("projectPageItem", () => {
  const COMMENT = { body: "looks good", id: "c-1", tsIso: "2026-09-03T00:00:00.000Z" };

  it("carries chunks, comments, relation, mention and file refs, partial and the body digest", () => {
    const raw = {
      properties: {
        Related: { relation: [{ id: "p-2" }, { id: "p-3" }], type: "relation" },
        Title: { title: [span({ text: "Design doc" })], type: "title" },
      },
      url: "https://notion.so/design",
    };

    expect(
      projectPageItem({
        bodyDigest: "abc123",
        comments: [COMMENT],
        fileRefs: ["file: spec.pdf"],
        id: "p-1",
        lastEdited: "2026-09-02T00:00:00.000Z",
        mentionTargets: ["notion:user:u-1"],
        partial: true,
        raw,
        text: "First section.\n\nSecond section.",
      }),
    ).toEqual({
      bodyDigest: "abc123",
      chunks: ["First section.\n\nSecond section."],
      comments: [COMMENT],
      fileRefs: ["file: spec.pdf"],
      id: "p-1",
      mentionTargets: ["notion:user:u-1"],
      partial: true,
      raw,
      relationTargets: ["notion:page:p-2", "notion:page:p-3"],
      title: "Design doc",
      tsIso: "2026-09-02T00:00:00.000Z",
      url: "https://notion.so/design",
    });
  });

  it("omits every optional key when its list is empty, partial is false and no digest is given", () => {
    const raw = { title: [span({ text: "Bare" })] };

    expect(
      projectPageItem({
        comments: [],
        fileRefs: [],
        id: "p-4",
        lastEdited: "2026-09-02T00:00:00.000Z",
        mentionTargets: [],
        partial: false,
        raw,
        text: "",
      }),
    ).toEqual({ chunks: [], comments: [], id: "p-4", raw, title: "Bare", tsIso: "2026-09-02T00:00:00.000Z", url: "" });
  });
});

describe("projectRowItem", () => {
  it("flattens a row's properties into its title and text, with its parent, relations and file refs", () => {
    const raw = {
      properties: {
        Attachment: { files: [{ external: { url: "https://cdn.example/a.png" }, name: "a.png" }], type: "files" },
        Name: { title: [span({ text: "Ship it" })], type: "title" },
        Owner: { relation: [{ id: "p-9" }], type: "relation" },
        Status: { status: { name: "Done" }, type: "status" },
      },
      url: "https://notion.so/row-1",
    };

    expect(projectRowItem({ dataSourceId: "ds-1", id: "row-1", lastEdited: "2026-09-02T00:00:00.000Z", raw })).toEqual({
      chunks: ["Name: Ship it\nOwner: 1 linked\nStatus: Done"],
      comments: [],
      fileRefs: ["file: a.png (https://cdn.example/a.png)"],
      id: "row-1",
      parent: "ds-1",
      raw,
      relationTargets: ["notion:page:p-9"],
      title: "Ship it",
      tsIso: "2026-09-02T00:00:00.000Z",
      url: "https://notion.so/row-1",
    });
  });

  it("titles a row whose properties render no title as (row), and records partial", () => {
    const raw = { properties: { Name: { title: [], type: "title" } } };

    expect(projectRowItem({ dataSourceId: "ds-1", id: "row-2", lastEdited: "", partial: true, raw })).toEqual({
      chunks: [],
      comments: [],
      id: "row-2",
      parent: "ds-1",
      partial: true,
      raw,
      title: "(row)",
      tsIso: "",
      url: "",
    });
  });
});

describe("projectNotionUser", () => {
  it("captures a person's email and avatar into the whole member row", () => {
    const raw = {
      avatar_url: "https://img/u.png",
      id: "u-1",
      name: "Ada",
      person: { email: "ada@example.com" },
      type: "person",
    };

    expect(projectNotionUser({ fetchedAtIso: FETCHED_AT, raw })).toEqual({
      fetchedAtIso: FETCHED_AT,
      identity: {
        email: "ada@example.com",
        emailNormalised: "ada@example.com",
        emailTrust: "trusted",
        name: "Ada",
        nativeId: "u-1",
        source: "notion",
      },
      profile: { avatarUrl: "https://img/u.png", bot: false },
      provenance: ["notion.users.list"],
      raw,
      source: "notion",
      sourceId: "u-1",
      version: 1,
      warnings: [],
    });
  });

  it("warns with the literal capability message for a person with no email, and never for a bot", () => {
    const person = projectNotionUser({ fetchedAtIso: FETCHED_AT, raw: { id: "u-2", person: {}, type: "person" } });
    const bot = projectNotionUser({
      fetchedAtIso: FETCHED_AT,
      raw: { bot: {}, id: "b-1", name: "Integration", person: { email: "bot@example.com" }, type: "bot" },
    });

    expect(person!.warnings).toEqual(["no email — the Notion integration lacks the read-user-email capability"]);
    expect(person!.identity.emailTrust).toBe("missing");
    expect(bot!.warnings).toEqual([]);
    expect(bot!.identity).toEqual({ emailTrust: "missing", name: "Integration", nativeId: "b-1", source: "notion" });
    expect(bot!.profile).toEqual({ bot: true });
  });

  it("drops an id-less user and a non-record", () => {
    expect(projectNotionUser({ fetchedAtIso: FETCHED_AT, raw: { name: "No id", type: "person" } })).toBe(undefined);
    expect(projectNotionUser({ fetchedAtIso: FETCHED_AT, raw: "u-3" })).toBe(undefined);
  });
});

describe("projectCommentItem", () => {
  it("renders the comment's rich text and keeps its explicit author id", () => {
    const raw = {
      created_by: { id: "u-1", object: "user" },
      created_time: "2026-09-03T00:00:00.000Z",
      id: "c-1",
      rich_text: [span({ text: "see " }), { href: "https://x.example", plain_text: "this" }],
    };

    expect(projectCommentItem({ raw })).toEqual({
      author: "u-1",
      body: "see this (https://x.example)",
      id: "c-1",
      raw,
      tsIso: "2026-09-03T00:00:00.000Z",
    });
  });

  it("leaves author off when created_by carries no id, and refuses an id-less comment", () => {
    const raw = { created_by: {}, id: "c-2", rich_text: [] };

    expect(projectCommentItem({ raw })).toEqual({ body: "", id: "c-2", raw, tsIso: "" });
    expect(projectCommentItem({ raw: { rich_text: [span({ text: "orphan" })] } })).toBe(undefined);
  });
});
