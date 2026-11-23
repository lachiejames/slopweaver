/*
 * The per-source side-row writer over a scripted client (`../../scriptedStoreClient.ts`): one insert for the source a
 * batch holds rows for, carrying the content id it was paired with, and no statement at all for an empty batch.
 */
import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { unwrap } from "../../../lib/result.js";
import { writeSourceRows } from "../../../store/ingestSourceRows.js";
import { projectRecord } from "../../../store/project.js";
import { scriptedStoreClient } from "../../scriptedStoreClient.js";

/** A Slack message record the projection stores, with a Slack side row. */
const SLACK: CorpusRecord = {
  container: "slack/c-random",
  kind: "message",
  refs: [],
  source: "slack",
  sourceId: "c-random:1000000000.000001",
  text: "hello",
  tsIso: "2026-09-05T11:59:13.000Z",
  url: "https://example.slack.com/archives/c-random/p1000000000000001",
};

describe("writeSourceRows", () => {
  it("writes a Slack record's side row in one insert into content_slack, under its paired content id", async () => {
    const { client, statements } = scriptedStoreClient({ answer: () => [] });
    const record = unwrap(projectRecord({ record: SLACK }));

    await client.db.transaction(async (writer) => writeSourceRows({ batch: [{ contentId: "c-1", record }], writer }));

    expect(statements().map((statement) => statement.query.split(" (")[0])).toEqual(['insert into "content_slack"']);
    expect(statements()[0]!.params).toContain("c-1");
  });

  it("issues no statement for an empty batch", async () => {
    const { client, statements } = scriptedStoreClient({ answer: () => [] });

    await client.db.transaction(async (writer) => writeSourceRows({ batch: [], writer }));

    expect(statements()).toEqual([]);
  });
});
