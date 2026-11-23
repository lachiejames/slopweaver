/**
 * Reading a stored row back as a corpus record, and the ROUND TRIP that keeps a citation honest.
 *
 * The sharp case is GitHub. Its stored `source_id` is qualified with the repository
 * (`acme/acme-admin#N`) where bronze wrote `#N`, because `#n` is unique only inside a
 * repository. `citeToken` re-qualifies a GitHub id from its container, so a reader that handed back the
 * already-qualified id would either double-qualify it or produce a record whose identity no longer matches
 * the one a brief pinned. The witness for "these two paths agree" is not an eyeball — it is
 * `projectRecord(recordFromStoreRow(row)).content.sourceId === row.source_id`, asserted below per source.
 *
 * The lossiness is asserted too, deliberately. `raw` must come back ABSENT rather than empty, because
 * "the store does not carry this" and "the payload was empty" are different claims and only one of them
 * is true.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { citeToken } from "../../../retrieval/citeToken.js";
import { projectRecord } from "../../../store/project.js";
import { recordFromStoreRow } from "../../../store/record.js";
import type { ContentRow } from "../../../store/schema/content.js";

const row = ({
  source,
  sourceId,
  metadata = {},
  title = null,
}: {
  source: ContentRow["source"];
  sourceId: string;
  metadata?: Record<string, unknown>;
  title?: string | null;
}): ContentRow => ({
  authorId: null,
  authorIsBot: false,
  authorNativeId: null,
  body: "the pool exhausted at noon",
  containerId: null,
  createdAt: new Date("2026-09-08T00:00:00.000Z"),
  dataClass: null,
  id: "a0000075-0000-4000-8000-000000000081",
  kind: "message",
  metadata,
  occurredAt: new Date("2026-09-08T04:05:06.000Z"),
  parentId: null,
  parentSourceId: null,
  source,
  sourceId,
  searchable: null,
  title,
  url: "https://example.invalid/x",
  visibility: "public",
});

describe("recordFromStoreRow", () => {
  it("un-qualifies a GitHub id, so the record carries the id bronze wrote", () => {
    const record = recordFromStoreRow({
      author: null,
      container: "acme/acme-admin",
      row: row({ source: "github", sourceId: "acme/acme-admin#13783" }),
    });
    expect(record.sourceId).toBe("#13783");
    expect(record.container).toBe("acme/acme-admin");
  });

  it("computes the SAME citation token the stored id already is, for GitHub", () => {
    const stored = row({ source: "github", sourceId: "acme/acme-admin#13783" });
    const record = recordFromStoreRow({ author: null, container: "acme/acme-admin", row: stored });
    expect(citeToken({ record })).toBe(stored.sourceId);
  });

  it("leaves every other source's id exactly as stored", () => {
    const stored = row({ source: "slack", sourceId: "C0PROOF:1788690617.460499" });
    const record = recordFromStoreRow({ author: null, container: "slack/C0PROOF", row: stored });
    expect(record.sourceId).toBe("C0PROOF:1788690617.460499");
    expect(citeToken({ record })).toBe("C0PROOF:1788690617.460499");
  });

  it("round-trips back to the SAME stored id through the projection, for github", () => {
    const stored = row({ source: "github", sourceId: "acme/acme-admin#13783" });
    const record = recordFromStoreRow({ author: null, container: "acme/acme-admin", row: stored });
    expect(unwrap(projectRecord({ record })).content.sourceId).toBe(stored.sourceId);
  });

  it("round-trips back to the SAME stored id through the projection, for slack", () => {
    const stored = row({ source: "slack", sourceId: "C0PROOF:1788690617.460499" });
    const record = recordFromStoreRow({ author: null, container: "slack/C0PROOF", row: stored });
    expect(unwrap(projectRecord({ record })).content.sourceId).toBe(stored.sourceId);
  });

  it("carries the refs the projection stored, and no others", () => {
    const record = recordFromStoreRow({
      author: null,
      container: "slack/C0PROOF",
      row: row({ metadata: { refs: ["#42", "@seth", 7] }, source: "slack", sourceId: "C0PROOF:1.2" }),
    });
    expect(record.refs).toStrictEqual(["#42", "@seth"]);
  });

  it("carries the unclaimed attributes back, and drops a value no attribute may hold", () => {
    const record = recordFromStoreRow({
      author: null,
      container: "slack/C0PROOF",
      row: row({
        metadata: { attrs: { count: 3, nested: { no: true }, tags: ["a", "b"], via: "socket" }, refs: [] },
        source: "slack",
        sourceId: "C0PROOF:1.2",
      }),
    });
    expect(record.attrs).toStrictEqual({ count: 3, tags: ["a", "b"], via: "socket" });
  });

  it("leaves raw ABSENT rather than empty, because the store carries none of it", () => {
    const record = recordFromStoreRow({
      author: null,
      container: "slack/C0PROOF",
      row: row({ source: "slack", sourceId: "C0PROOF:1.2" }),
    });
    expect("raw" in record).toBe(false);
  });

  it("leaves an empty title and an empty author ABSENT rather than as empty strings", () => {
    const record = recordFromStoreRow({
      author: "",
      container: "slack/C0PROOF",
      row: row({ source: "slack", sourceId: "C0PROOF:1.2", title: "" }),
    });
    expect("title" in record).toBe(false);
    expect("author" in record).toBe(false);
  });

  it("reads the timestamp back as the instant the row stored", () => {
    const record = recordFromStoreRow({
      author: "calvin.tate",
      container: "slack/C0PROOF",
      row: row({ source: "slack", sourceId: "C0PROOF:1.2" }),
    });
    expect(record.tsIso).toBe("2026-09-08T04:05:06.000Z");
    expect(record.author).toBe("calvin.tate");
  });
});
