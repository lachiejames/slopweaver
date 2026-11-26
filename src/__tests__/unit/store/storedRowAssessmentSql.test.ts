/**
 * The two hand-written SQL fragments behind the stored-row assessment, rendered by drizzle's own pure `PgDialect`,
 * which holds no connection and reaches nothing: the one digest of a `content` row's words, and the keyset predicate
 * a newest-first walk resumes from. What the digest EQUALS over real rows is a database fact, not this lane's.
 */
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { contentAssessmentDigest } from "../../../store/storedRowAssessmentRead.js";
import { newestFirstAfter } from "../../../store/storedRowAssessmentSlice.js";

const dialect = new PgDialect();

describe("contentAssessmentDigest", () => {
  it("hashes the versioned title-and-body array, every function named in pg_catalog", () => {
    expect(dialect.sqlToQuery(contentAssessmentDigest).sql).toBe(
      "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(1, " +
        '"content"."title", "content"."body")::pg_catalog.text, \'UTF8\')), \'hex\')',
    );
  });

  it("binds no parameter, so no value can reach it", () => {
    expect(dialect.sqlToQuery(contentAssessmentDigest).params).toEqual([]);
  });
});

describe("newestFirstAfter", () => {
  const columns = { cast: sql`pg_catalog.uuid`, key: sql`"id"`, orderAt: sql`"occurred_at"` };

  it("reads from the start with no predicate", () => {
    expect(newestFirstAfter({ ...columns, after: null })).toBeUndefined();
  });

  it("resumes strictly past the cursor, the instant and key compared as one row value and bound as parameters", () => {
    const after = { orderAtIso: "2026-11-20T10:00:00.123456+00:00", rowId: "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9" };
    const query = dialect.sqlToQuery(newestFirstAfter({ ...columns, after })!);
    expect(query.sql).toBe('("occurred_at", "id") < ($1::pg_catalog.timestamptz, $2::pg_catalog.uuid)');
    expect(query.params).toEqual([after.orderAtIso, after.rowId]);
  });
});
