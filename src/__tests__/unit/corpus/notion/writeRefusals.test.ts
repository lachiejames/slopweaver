import { describe, expect, it } from "vitest";

import { insertedBlockId, uploadConfirmed } from "../../../../corpus/notion/mediaApi.js";
import { botUserIdOf, writtenPageOf } from "../../../../corpus/notion/writeApi.js";
import { NotionWriteErrors } from "../../../../corpus/notion/writeErrors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("writtenPageOf", () => {
  it("confirms a page carrying an id and a url", () => {
    const page = unwrap(writtenPageOf({ value: { id: "pg1", url: "https://www.notion.so/pg1" } }));
    expect(page.id).toBe("pg1");
    expect(page.url).toBe("https://www.notion.so/pg1");
  });

  it("refuses a response that is not a page object", () => {
    const refused = unwrapErr(writtenPageOf({ value: "not a page" }));
    expect(refused).toEqual(NotionWriteErrors.notAPage());
    expect(refused.message).toBe(
      "Notion returned something that is not a page object, so the write cannot be confirmed",
    );
  });

  it("refuses a page object with no url", () => {
    const refused = unwrapErr(writtenPageOf({ value: { id: "pg1" } }));
    expect(refused).toEqual(NotionWriteErrors.pageUnidentified());
    expect(refused.message).toBe("Notion returned a page object with no id or url, so the write cannot be confirmed");
  });
});

describe("botUserIdOf", () => {
  it("reads the bot id off a users.me response", () => {
    expect(unwrap(botUserIdOf({ value: { id: "bot-1" } }))).toBe("bot-1");
  });

  it("refuses a response carrying no id", () => {
    const refused = unwrapErr(botUserIdOf({ value: {} }));
    expect(refused).toEqual(NotionWriteErrors.botUserIdMissing());
    expect(refused.message).toBe("Notion returned no bot user id, so authorship cannot be checked");
  });
});

describe("uploadConfirmed", () => {
  it("answers the upload id once Notion reports it uploaded", () => {
    expect(unwrap(uploadConfirmed({ filename: "a.png", status: "uploaded", uploadId: "up-1" }))).toBe("up-1");
  });

  it("refuses an upload left pending, naming the status", () => {
    const refused = unwrapErr(uploadConfirmed({ filename: "a.png", status: "pending", uploadId: "up-1" }));
    expect(refused).toEqual(
      NotionWriteErrors.uploadUnfinished({ filename: "a.png", status: "pending", uploadId: "up-1" }),
    );
    expect(refused.message).toBe('Notion left upload up-1 for a.png in status "pending" rather than "uploaded"');
  });
});

describe("insertedBlockId", () => {
  it("reads the first result's id", () => {
    expect(unwrap(insertedBlockId({ results: [{ id: "blk-1" }] }))).toBe("blk-1");
  });

  it("refuses an append that returned no block", () => {
    const refused = unwrapErr(insertedBlockId({ results: [] }));
    expect(refused).toEqual(NotionWriteErrors.blockIdMissing());
    expect(refused.message).toBe("Notion appended the block but returned no block id, so it cannot be recorded");
  });
});
