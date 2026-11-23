import { describe, expect, it } from "vitest";

import { readEntryBatches } from "../../../gcpAudit/entries.js";
import { type GcpAuditError, GcpAuditErrors } from "../../../gcpAudit/errors.js";
import type { GcpEntriesWriter } from "../../../gcpAudit/store.js";
import type { GcpAuditRequest } from "../../../gcpAudit/transport.js";
import type { TrimmedGcpAuditEntry } from "../../../gcpAudit/trim.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const SINCE_FILTER = 'timestamp >= "2025-01-01T00:00:00Z"';

/** A writer that keeps what it is handed. */
function memoryWriter(): { writer: GcpEntriesWriter; written: TrimmedGcpAuditEntry[] } {
  const written: TrimmedGcpAuditEntry[] = [];
  return { writer: { append: ({ entry }) => written.push(entry), close: () => undefined, path: "/fake" }, written };
}

/** One audit entry from `project`. */
function rawEntry({ project, insertId }: { project: string; insertId: string }): Record<string, unknown> {
  return {
    insertId,
    logName: `projects/${project}/logs/cloudaudit.googleapis.com%2Factivity`,
    timestamp: "2026-01-01T00:00:00Z",
  };
}

/** A Google whose `projects/locked` logs 403 and whose `projects/p-open` has one entry. */
function entriesGoogle({ calls }: { calls: string[][] }) {
  return ({ request }: { request: GcpAuditRequest }): Promise<Result<unknown, GcpAuditError>> => {
    if (request.kind !== "list-entries") {
      return Promise.resolve(ok({}));
    }
    calls.push([...request.body.resourceNames]);
    if (request.body.resourceNames.includes("projects/locked")) {
      return Promise.resolve(
        err(GcpAuditErrors.transportFailed({ detail: "Permission denied", operation: "op", status: 403 })),
      );
    }
    return Promise.resolve(ok({ entries: [rawEntry({ insertId: "1", project: "p-open" })] }));
  };
}

describe("readEntryBatches", () => {
  it("bisects a refused batch down to the refused container and reads the rest", async () => {
    const calls: string[][] = [];
    const { writer, written } = memoryWriter();
    const read = unwrap(
      await readEntryBatches({
        buckets: [],
        containers: ["projects/p-open", "projects/locked"],
        filter: SINCE_FILTER,
        progress: () => undefined,
        send: entriesGoogle({ calls }),
        writer,
      }),
    );
    expect(calls).toEqual([["projects/p-open", "projects/locked"], ["projects/p-open"], ["projects/locked"]]);
    expect(read.entryRefusals.map((fact) => [fact.what, fact.status])).toEqual([["projects/locked", 403]]);
    expect(read.batches).toEqual([{ entries: 1, pages: 1, resourceCount: 2 }]);
    expect(read.entriesWritten).toBe(1);
    expect(written.map((entry) => entry.origin)).toEqual(["projects/p-open"]);
  });

  it("stops the read on a failure that is not a first-page 403", async () => {
    const failure = GcpAuditErrors.transportFailed({ detail: "unavailable", operation: "op", status: 503 });
    const read = await readEntryBatches({
      buckets: [],
      containers: ["projects/p-open"],
      filter: SINCE_FILTER,
      progress: () => undefined,
      send: () => Promise.resolve(err(failure)),
      writer: memoryWriter().writer,
    });
    expect(unwrapErr(read)).toEqual(failure);
  });

  it("charges each container its buckets' views, so a heavy container starts a new batch", async () => {
    const calls: string[][] = [];
    const heavy = Array.from({ length: 100 }, (_, index) => ({
      analyticsEnabled: null,
      container: "projects/p-open",
      lifecycleState: null,
      locked: null,
      name: `projects/p-open/locations/global/buckets/b${String(index)}`,
      retentionDays: null,
    }));
    const read = unwrap(
      await readEntryBatches({
        buckets: heavy,
        containers: ["organizations/1", "projects/p-open"],
        filter: SINCE_FILTER,
        progress: () => undefined,
        send: entriesGoogle({ calls }),
        writer: memoryWriter().writer,
      }),
    );
    expect(calls).toEqual([["organizations/1"], ["projects/p-open"]]);
    expect(read.batches.map((batch) => batch.resourceCount)).toEqual([1, 1]);
  });
});
