import { describe, expect, it } from "vitest";

import { parseAuditLogName, trimAuditEntry } from "../../../gcpAudit/trim.js";
import { LIST_ENTRIES } from "../../../gcpAudit/wire.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One entry as Google answers it unmasked, the request body included — what the trimmer must drop. */
const RAW = {
  insertId: "abc123",
  logName: "projects/acme-local/logs/cloudaudit.googleapis.com%2Fdata_access",
  protoPayload: {
    "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
    authenticationInfo: { principalEmail: "a@x.com", principalSubject: "user:a@x.com" },
    authorizationInfo: [
      {
        granted: true,
        permission: "storage.objects.get",
        permissionType: "DATA_READ",
        resource: "b",
        resourceAttributes: {},
      },
    ],
    methodName: "storage.objects.get",
    request: { secretish: "never kept" },
    requestMetadata: { callerIp: "1.2.3.4", callerSuppliedUserAgent: "gcloud", requestAttributes: {} },
    resourceName: "projects/_/buckets/b/objects/o",
    serviceName: "storage.googleapis.com",
  },
  receiveTimestamp: "2026-10-01T00:00:01Z",
  resource: { labels: { project_id: "acme-local" }, type: "gcs_bucket" },
  severity: "INFO",
  timestamp: "2026-10-01T00:00:00Z",
};

describe("LIST_ENTRIES", () => {
  it("declares every key an unmasked audit entry carries", () => {
    expect(LIST_ENTRIES.parse({ value: { entries: [RAW] } }).isOk()).toBe(true);
  });

  it("names a field Google adds rather than reading it as absence", () => {
    const drift = unwrapErr(LIST_ENTRIES.parse({ value: { entries: [{ ...RAW, brandNew: 1 }] } }));
    expect(drift.message).toContain("brandNew");
  });
});

describe("parseAuditLogName", () => {
  it("reads the origin and stream off the encoded log name", () => {
    expect(unwrap(parseAuditLogName({ logName: "folders/12/logs/cloudaudit.googleapis.com%2Factivity" }))).toEqual({
      logKind: "activity",
      origin: "folders/12",
    });
  });

  it("refuses a billing account's log, which the reader never searches", () => {
    expect(
      unwrapErr(parseAuditLogName({ logName: "billingAccounts/0/logs/cloudaudit.googleapis.com%2Factivity" })).code,
    ).toBe("RESPONSE_CHANGED");
  });

  it("refuses an origin a request could never carry, rather than trusting its prefix", () => {
    expect(
      unwrapErr(parseAuditLogName({ logName: "projects/../logs/cloudaudit.googleapis.com%2Factivity" })).code,
    ).toBe("RESPONSE_CHANGED");
  });

  it("refuses a log that is not an audit log", () => {
    expect(
      unwrapErr(parseAuditLogName({ logName: "projects/p-one/logs/run.googleapis.com%2Fstderr" })).message,
    ).toContain("is not a Cloud Audit Log");
  });
});

describe("trimAuditEntry", () => {
  const wire = unwrap(LIST_ENTRIES.parse({ value: { entries: [RAW] } })).entries![0]!;

  it("keeps the named fields and drops the request body", () => {
    expect(unwrap(trimAuditEntry({ entry: wire }))).toEqual({
      authorization: [{ granted: true, permission: "storage.objects.get", resource: "b" }],
      callerIp: "1.2.3.4",
      eventId: `${RAW.logName}|2026-10-01T00:00:00Z|abc123`,
      eventIdSource: "insert-id",
      logKind: "data_access",
      methodName: "storage.objects.get",
      origin: "projects/acme-local",
      principal: "a@x.com",
      resourceName: "projects/_/buckets/b/objects/o",
      serviceName: "storage.googleapis.com",
      statusCode: null,
      timestamp: "2026-10-01T00:00:00Z",
      userAgent: "gcloud",
    });
  });

  it("derives a digest id when Google sent no insertId, and says so", () => {
    const { insertId: _dropped, ...rest } = wire;
    const trimmed = unwrap(trimAuditEntry({ entry: rest }));
    expect(trimmed.eventIdSource).toBe("derived");
    expect(trimmed.eventId).toMatch(/\|sha256:[0-9a-f]{64}$/);
  });

  it("reads a check with no granted key as denied — proto3 JSON omits a false boolean", () => {
    const denied = unwrap(
      LIST_ENTRIES.parse({
        value: {
          entries: [
            {
              ...RAW,
              protoPayload: { ...RAW.protoPayload, authorizationInfo: [{ permission: "p.q", resource: "r" }] },
            },
          ],
        },
      }),
    ).entries![0]!;
    expect(unwrap(trimAuditEntry({ entry: denied })).authorization).toEqual([
      { granted: false, permission: "p.q", resource: "r" },
    ]);
  });

  it("carries an absent payload as nulls and no authorization, never substituted values", () => {
    const trimmed = unwrap(trimAuditEntry({ entry: { logName: RAW.logName, timestamp: RAW.timestamp } }));
    expect(trimmed.principal).toBe(null);
    expect(trimmed.authorization).toEqual([]);
  });
});
