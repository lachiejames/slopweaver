/**
 * A content row's data class and its stored container are one container's, or the batch is not written.
 *
 * The counterexample is Codex's third review of the rule sorter: a container id filed under the wrong key let a row
 * classed on a PUBLIC channel's rule be stored against a PRIVATE channel. The id map is now filled only from rows
 * the database returns, each under that row's own `(source, native_id)`, so the misfile is spelled here as the
 * database answering the public channel's upsert with the private channel's row: the public key stays unresolved,
 * and the write refuses inside its transaction before any content row is sent. Over a scripted client
 * (`../../scriptedStoreClient.ts`), which runs the real query builder against no database.
 */
import { describe, expect, it } from "vitest";

import type { DataClassRule } from "../../../store/dataClassRules.js";
import { writeBatch } from "../../../store/ingest.js";
import { ContainerIds, type IdCache } from "../../../store/ingestIds.js";
import type { ProjectedRecord } from "../../../store/project.js";
import { type ScriptedStatement, scriptedStoreClient } from "../../scriptedStoreClient.js";

/** The installation rule the counterexample rides: the public channel's rows are `internal`. */
const RULES: readonly DataClassRule[] = [
  { action: "internal", id: "fixture:public-channel", match: { container: ["slack/C0PUBFIXTURE"] } },
];

/** A projected Slack message in the public fixture channel. */
const inPublicChannel = ({ sourceId }: { sourceId: string }): ProjectedRecord => ({
  author: null,
  container: { kind: "channel", name: "slack/C0PUBFIXTURE", nativeId: "slack/C0PUBFIXTURE", source: "slack" },
  content: {
    authorIsBot: false,
    body: "the deploy rolled back",
    kind: "message",
    metadata: {},
    occurredAt: new Date("2026-10-01T09:00:00.000Z"),
    parentSourceId: null,
    source: "slack",
    sourceId,
    title: null,
    url: "https://example.test/1",
    visibility: "public",
  },
  sourceRow: null,
});

/** A cache with no container resolved and nobody in the directory. */
const freshCache = (): IdCache => ({
  containers: new ContainerIds(),
  people: new Map<string, string>(),
  resolved: new Set<string>(),
  unresolved: new Set<string>(),
});

/** Whether a statement is the container upsert. */
const isContainerUpsert = (statement: ScriptedStatement): boolean =>
  statement.query.startsWith('insert into "container"');

/** Whether a statement is the content insert. */
const isContentInsert = (statement: ScriptedStatement): boolean => statement.query.startsWith('insert into "content"');

describe("writeBatch's container and data class", () => {
  it("refuses the batch when the public channel's upsert comes back as the private channel's row", async () => {
    const { client, statements } = scriptedStoreClient({
      answer: (statement) => (isContainerUpsert(statement) ? [["id-private", "slack/C0PRIVFIXTURE", "slack"]] : []),
    });
    const cache = freshCache();

    const written = writeBatch({
      batch: [inPublicChannel({ sourceId: "C0PUBFIXTURE:1.1" })],
      cache,
      client,
      dataClassRules: RULES,
    });

    await expect(written).rejects.toThrow(
      "container slack slack/C0PUBFIXTURE did not resolve; refusing to store slack C0PUBFIXTURE:1.1",
    );
    expect(statements().filter(isContentInsert).length).toBe(0);
    expect(cache.containers.idFor({ container: { nativeId: "slack/C0PUBFIXTURE", source: "slack" } })).toBe(undefined);
    expect(cache.containers.idFor({ container: { nativeId: "slack/C0PRIVFIXTURE", source: "slack" } })).toBe(
      "id-private",
    );
  });

  it("stores the row against the container its class was sorted on, reusing that id on a later batch", async () => {
    const { client, statements } = scriptedStoreClient({
      answer: (statement) => (isContainerUpsert(statement) ? [["id-public", "slack/C0PUBFIXTURE", "slack"]] : []),
    });
    const cache = freshCache();

    await writeBatch({
      batch: [inPublicChannel({ sourceId: "C0PUBFIXTURE:1.1" })],
      cache,
      client,
      dataClassRules: RULES,
    });
    await writeBatch({
      batch: [inPublicChannel({ sourceId: "C0PUBFIXTURE:2.2" })],
      cache,
      client,
      dataClassRules: RULES,
    });

    const inserts = statements().filter(isContentInsert);
    expect(statements().filter(isContainerUpsert).length).toBe(1);
    expect(inserts.length).toBe(2);
    expect(inserts[0]!.params).toContain("id-public");
    expect(inserts[0]!.params).toContain("internal");
    expect(inserts[1]!.params).toContain("id-public");
    expect(inserts[1]!.params).toContain("internal");
  });
});
