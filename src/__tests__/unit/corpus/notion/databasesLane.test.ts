import { describe, expect, it } from "vitest";
import { databaseSearchHit, rowQueryBounds } from "../../../../corpus/notion/liveApiDatabases.js";

const DATA_SOURCE = "0e2f4a1b-1111-4222-8333-444455556661";
const CUTOFF = Date.parse("2026-05-01T00:00:00.000Z");

const hit = ({ id, at }: { id: string; at: string }): Record<string, unknown> => ({
  id,
  last_edited_time: at,
  object: "data_source",
});

describe("databaseSearchHit", () => {
  it("still queries a data source whose OWN timestamp is years before the cutoff", () => {
    const raw = hit({ at: "2024-02-03T00:00:00.000Z", id: DATA_SOURCE });
    expect(databaseSearchHit({ raw })).toEqual({ id: DATA_SOURCE, lastEdited: "2024-02-03T00:00:00.000Z", raw });
  });

  it("narrows an in-window data source the same way, so enumeration has one rule", () => {
    const raw = hit({ at: "2026-05-10T00:00:00.000Z", id: DATA_SOURCE });
    expect(databaseSearchHit({ raw })).toEqual({ id: DATA_SOURCE, lastEdited: "2026-05-10T00:00:00.000Z", raw });
  });

  it("skips an id-less hit", () => {
    expect(databaseSearchHit({ raw: { object: "data_source" } })).toBe("skip");
  });

  it("skips a hit that is not an object at all", () => {
    expect(databaseSearchHit({ raw: "data_source" })).toBe("skip");
  });

  it("reports an empty lastEdited when the field is absent, rather than dropping the data source", () => {
    const raw = { id: DATA_SOURCE, object: "data_source" };
    expect(databaseSearchHit({ raw })).toEqual({ id: DATA_SOURCE, lastEdited: "", raw });
  });
});

describe("rowQueryBounds", () => {
  it("sends the window as a server-side filter, so unconditional enumeration stays affordable", () => {
    expect(rowQueryBounds({ cutoff: CUTOFF })).toEqual({
      filter: { last_edited_time: { on_or_after: "2026-05-01T00:00:00.000Z" }, timestamp: "last_edited_time" },
      sorts: [{ direction: "descending", timestamp: "last_edited_time" }],
    });
  });

  it("sends NO filter under --all, so a whole re-pull still reaches every row", () => {
    expect(rowQueryBounds({ cutoff: undefined })).toEqual({
      sorts: [{ direction: "descending", timestamp: "last_edited_time" }],
    });
  });
});
