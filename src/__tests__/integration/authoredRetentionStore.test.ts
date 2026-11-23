/**
 * The retention reconciliation's witness against a REAL store: call-thread rows leave it with their absent rows, a
 * call version carrying a tool answer is rewritten at its own path and mtime, a vanished call keeps its absent row, a
 * body another location still names survives, and a second run changes nothing.
 *
 * OPT-IN, and never in CI: it needs a real, migrated local store, and there is none in any lane. It reconciles the
 * WHOLE authored table, so point it only at a THROWAWAY database in the running stack — never `postgres`:
 *
 *   createdb -h 127.0.0.1 -p 55322 -U postgres authored_retention_proof
 *   SLOPWEAVER_STORE_URL=postgresql://postgres:postgres@127.0.0.1:55322/authored_retention_proof slopweaver store push
 *   AUTHORED_RETENTION_PROOF_URL=postgresql://postgres:postgres@127.0.0.1:55322/authored_retention_proof \
 *     yarn vitest run --config config/vitest/integration.ts src/__tests__/integration/authoredRetentionStore.test.ts
 */
import { createHash } from "node:crypto";

import { asc } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { unwrap } from "../../lib/result.js";
import { openStore, type StoreClient } from "../../store/client.js";
import { reconcileAuthoredRetention } from "../../store/fleet/authoredRetentionStore.js";
import { authoredAbsentTable, authoredBodyTable, authoredFileTable } from "../../store/schema/authored.js";

const PROOF_URL = process.env["AUTHORED_RETENTION_PROOF_URL"];

const WHEN = new Date("2026-11-03T09:56:33.697Z");
const EARLIER = new Date("2026-11-03T08:00:00.000Z");
const TOOL = '{"kind":"tool","name":"board_read","detail":"d","refused":false,"answer":"masked rows"}';
// The same tool line with its key spelled through a JSON escape, which the raw `"answer"` token alone never finds.
const TOOL_ESCAPED = '{"kind":"tool","name":"board_read","detail":"d","refused":false,"\\u0061nswer":"masked rows"}';
const TOOL_STRIPPED = '{"kind":"tool","name":"board_read","detail":"d","refused":false}';
const SEGMENT = '{"kind":"segment","text":"spoken words","who":"voice"}';
const SHARED = "the same bytes at a thread path and a brief\n";

const sha = ({ text }: { text: string }): string =>
  createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

/** Insert one body and one location naming it. */
async function seed({
  client,
  path,
  text,
  at = WHEN,
}: {
  client: StoreClient;
  path: string;
  text: string;
  at?: Date;
}): Promise<void> {
  const body = Buffer.from(text, "utf8");
  await client.db
    .insert(authoredBodyTable)
    .values({ body, bodySha256: sha({ text }), byteLength: body.length })
    .onConflictDoNothing();
  await client.db
    .insert(authoredFileTable)
    .values({ bodySha256: sha({ text }), directory: path.split("/")[0]!, fileModifiedAt: at, relativePath: path });
}

describe.skipIf(PROOF_URL === undefined)("authored retention reconciliation (live store)", () => {
  let client: StoreClient;

  beforeAll(async () => {
    client = openStore({ url: PROOF_URL! });
    await client.db.delete(authoredAbsentTable);
    await client.db.delete(authoredBodyTable);
    await seed({ client, path: "talk/threads/abc.jsonl", text: "thread base\n" });
    await seed({ client, path: "talk/threads/abc.part-000001.jsonl", text: SHARED });
    await seed({ client, path: "briefs/kept.md", text: SHARED });
    await seed({ client, path: "talk/calls/present.jsonl", text: `${SEGMENT}\n${TOOL}\n` });
    await seed({ client, path: "talk/calls/vanished.jsonl", text: `${TOOL}\n` });
    await seed({ client, path: "talk/calls/escaped.jsonl", text: `${SEGMENT}\n${TOOL_ESCAPED}\n` });
    await seed({ client, path: "talk/calls/clean.jsonl", text: `${SEGMENT}\n` });
    // An older version whose bytes equal the newer one's once its answer is stripped.
    await seed({ at: EARLIER, client, path: "talk/calls/collide.jsonl", text: `${TOOL_STRIPPED}\n` });
    await seed({ client, path: "talk/calls/collide.jsonl", text: `${TOOL}\n` });
    await client.db.insert(authoredAbsentTable).values([
      { relativePath: "talk/threads/abc.jsonl" },
      // An absent row whose path has no stored location left at all.
      { relativePath: "talk/threads/ghost.jsonl" },
      { relativePath: "talk/calls/vanished.jsonl" },
    ]);
  });

  afterAll(async () => {
    await client.db.delete(authoredAbsentTable);
    await client.db.delete(authoredBodyTable);
    await client.close();
  });

  it("removes the threads, rewrites the calls, keeps what another path names, and converges", async () => {
    const first = unwrap(await reconcileAuthoredRetention({ client }));
    expect(first).toEqual({
      absentRowsDeleted: 2,
      callVersionsRewritten: 4,
      orphanBodiesDeleted: 4,
      rowsInserted: 5,
      scratchLocationsDeleted: 2,
    });

    const locations = await client.db
      .select({
        bodySha256: authoredFileTable.bodySha256,
        fileModifiedAt: authoredFileTable.fileModifiedAt,
        relativePath: authoredFileTable.relativePath,
      })
      .from(authoredFileTable)
      .orderBy(asc(authoredFileTable.relativePath));
    expect(locations).toEqual([
      { bodySha256: sha({ text: SHARED }), fileModifiedAt: WHEN, relativePath: "briefs/kept.md" },
      { bodySha256: sha({ text: `${SEGMENT}\n` }), fileModifiedAt: WHEN, relativePath: "talk/calls/clean.jsonl" },
      // The older row now stands for the newer version too, at the newer version's instant.
      {
        bodySha256: sha({ text: `${TOOL_STRIPPED}\n` }),
        fileModifiedAt: WHEN,
        relativePath: "talk/calls/collide.jsonl",
      },
      {
        bodySha256: sha({ text: `${SEGMENT}\n${TOOL_STRIPPED}\n` }),
        fileModifiedAt: WHEN,
        relativePath: "talk/calls/escaped.jsonl",
      },
      {
        bodySha256: sha({ text: `${SEGMENT}\n${TOOL_STRIPPED}\n` }),
        fileModifiedAt: WHEN,
        relativePath: "talk/calls/present.jsonl",
      },
      {
        bodySha256: sha({ text: `${TOOL_STRIPPED}\n` }),
        fileModifiedAt: WHEN,
        relativePath: "talk/calls/vanished.jsonl",
      },
    ]);
    const absent = await client.db.select({ path: authoredAbsentTable.relativePath }).from(authoredAbsentTable);
    expect(absent.map((row) => row.path)).toEqual(["talk/calls/vanished.jsonl"]);
    const bodies = await client.db
      .select({ sha: authoredBodyTable.bodySha256 })
      .from(authoredBodyTable)
      .orderBy(asc(authoredBodyTable.bodySha256));
    expect(bodies.map((row) => row.sha)).toEqual(
      [
        sha({ text: SHARED }),
        sha({ text: `${SEGMENT}\n` }),
        sha({ text: `${SEGMENT}\n${TOOL_STRIPPED}\n` }),
        sha({ text: `${TOOL_STRIPPED}\n` }),
      ].toSorted(),
    );

    expect(unwrap(await reconcileAuthoredRetention({ client }))).toEqual({
      absentRowsDeleted: 0,
      callVersionsRewritten: 0,
      orphanBodiesDeleted: 0,
      rowsInserted: 0,
      scratchLocationsDeleted: 0,
    });
  });
});
