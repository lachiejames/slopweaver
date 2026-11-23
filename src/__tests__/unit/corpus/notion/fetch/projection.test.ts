/*
 * The pure projections from a raw Notion object to a shaped item: a database summary, a data-source row, a
 * comment and its author, and the progress previews built from a shaped page or database.
 */
import { describe, expect, it } from "vitest";
import {
  lastEditedOf,
  notionDatabasePreview,
  notionPagePreview,
  projectCommentItem,
  projectDatabaseItem,
  projectRowItem,
} from "../../../../../corpus/notion/fetch.js";

describe("projection cores (pure)", () => {
  it("projects a database summary hit (title from properties, url, no cutoff drop)", () => {
    const raw = { id: "db1", last_edited_time: "2026-05-01T00:00:00.000Z", title: [{ plain_text: "Tasks" }], url: "u" };
    expect(lastEditedOf({ raw })).toBe("2026-05-01T00:00:00.000Z");
    const item = projectDatabaseItem({ id: "db1", lastEdited: lastEditedOf({ raw }), raw });
    expect(item.id).toBe("db1");
    expect(item.title).toBe("Tasks");
    expect(item.url).toBe("u");
  });

  it("projects a data-source ROW into a page item (title property + parent + chunks)", () => {
    const raw = {
      id: "row1",
      properties: {
        Name: { title: [{ plain_text: "A task" }], type: "title" },
        Status: { select: { name: "Done" }, type: "select" },
      },
      url: "u",
    };
    const item = projectRowItem({ dataSourceId: "db1", id: "row1", lastEdited: "2026-05-01T00:00:00.000Z", raw });
    expect(item.id).toBe("row1");
    expect(item.parent).toBe("db1");
    expect(item.title).toBe("A task");
    expect(item.chunks.join("\n")).toContain("Status: Done");
  });

  it("shapes a comment and drops an id-less one", () => {
    const comment = projectCommentItem({
      raw: { created_time: "2026-05-02T00:00:00.000Z", id: "c1", rich_text: [{ plain_text: "hi" }] },
    })!;
    expect(comment.id).toBe("c1");
    expect(comment.body).toBe("hi");
    expect(projectCommentItem({ raw: { rich_text: [] } })).toBeUndefined();
  });

  it("captures a row's relation targets + file property refs (ref-only) on the shaped item", () => {
    const raw = {
      id: "row1",
      properties: {
        "Blocked by": { relation: [{ id: "other" }], type: "relation" },
        Docs: { files: [{ external: { url: "https://cdn/s.pdf" }, name: "s.pdf", type: "external" }], type: "files" },
        Name: { title: [{ plain_text: "A task" }], type: "title" },
      },
      url: "u",
    };
    const item = projectRowItem({ dataSourceId: "db1", id: "row1", lastEdited: "2026-05-01T00:00:00.000Z", raw });
    expect(item.relationTargets).toEqual(["notion:page:other"]);
    expect(item.fileRefs).toEqual(["file: s.pdf (https://cdn/s.pdf)"]);
  });

  it("carries row comments through to the shaped item (no longer hard-coded empty)", () => {
    const raw = { id: "row1", properties: { Name: { title: [{ plain_text: "A task" }], type: "title" } }, url: "u" };
    const comments = [{ body: "decision made", id: "c1", tsIso: "2026-05-02T00:00:00.000Z" }];
    const item = projectRowItem({
      comments,
      dataSourceId: "db1",
      id: "row1",
      lastEdited: "2026-05-01T00:00:00.000Z",
      raw,
    });
    expect(item.comments).toEqual(comments);
  });
});

describe("notion progress helpers (pure)", () => {
  it("builds a page preview from its title + first chunk", () => {
    expect(
      notionPagePreview({
        page: { chunks: ["the roadmap for Q3"], comments: [], id: "pg1", title: "Roadmap", tsIso: "", url: "u" },
      }),
    ).toEqual({
      lane: "content_preview",
      phase: "pages",
      preview: { snippet: "the roadmap for Q3", sourceContentId: "pg1", subject: "Roadmap" },
      source: "notion",
    });
  });

  it("previews a page that rendered to no chunk by its title", () => {
    expect(
      notionPagePreview({ page: { chunks: [], comments: [], id: "pg2", title: "Empty", tsIso: "", url: "u" } }),
    ).toEqual({
      lane: "content_preview",
      phase: "pages",
      preview: { snippet: "Empty", sourceContentId: "pg2", subject: "Empty" },
      source: "notion",
    });
  });

  it("builds a database preview from its title", () => {
    expect(
      notionDatabasePreview({ database: { description: "", id: "db1", title: "Registry", tsIso: "", url: "u" } }),
    ).toEqual({
      lane: "content_preview",
      phase: "databases",
      preview: { snippet: "Registry", sourceContentId: "db1", subject: "Registry" },
      source: "notion",
    });
  });
});

describe("projectCommentItem captures the author", () => {
  it("files the created_by user id, so a discussion is attributable", () => {
    const comment = projectCommentItem({
      raw: {
        created_by: { id: "u-42", object: "user" },
        created_time: "2026-05-02T10:00:00.000Z",
        id: "c1",
        rich_text: [{ plain_text: "we accepted this risk" }],
      },
    });
    expect(comment!.author).toBe("u-42");
    expect(comment!.body).toBe("we accepted this risk");
  });

  it("omits the author entirely when created_by carries no id — never a synthesised one", () => {
    const comment = projectCommentItem({
      raw: { created_by: {}, created_time: "2026-05-02T10:00:00.000Z", id: "c1", rich_text: [] },
    });
    expect(comment!.author).toBeUndefined();
  });
});
