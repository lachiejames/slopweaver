/**
 * Interpreting the stored row: a whole row reads back as the organisation it records, and a value no parser foresaw,
 * one that throws on being read, is refused as `ORG_INVALID` rather than crashing the read.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { OrganisationErrors } from "../../../organisation/errors.js";
import { closeAfterAnswer, interpretStoredRow } from "../../../organisation/store.js";
import { ORGANISATION_ID, type OrganisationRow } from "../../../store/schema/organisation.js";
import { ACME_ORGANISATION } from "../../organisationFixture.js";

const { revision: _revision, selfRepository: _self, updatedAtIso: _updated, ...RECORD } = ACME_ORGANISATION;
const WRITTEN = new Date("2026-10-30T00:00:00.000Z");
const ROW: OrganisationRow = { ...RECORD, id: ORGANISATION_ID, revision: 1, updatedAt: WRITTEN };

describe("closeAfterAnswer", () => {
  it("resolves when a close rejects, so the answer already read is the one returned", async () => {
    const closes: string[] = [];
    const client = {
      close: async (): Promise<void> => {
        closes.push("attempted");
        throw new Error("connection close failed");
      },
    };
    await expect(closeAfterAnswer({ client })).resolves.toBeUndefined();
    expect(closes).toEqual(["attempted"]);
  });
});

describe("interpretStoredRow", () => {
  it("reads a whole row back as its record, revision and instant", () => {
    expect(unwrap(interpretStoredRow({ row: ROW }))).toEqual({
      record: RECORD,
      revision: 1,
      updatedAtIso: "2026-10-30T00:00:00.000Z",
    });
  });

  it("refuses a timestamp that passes as a Date and throws on being read, rather than throwing out of the read", () => {
    const proxied: OrganisationRow = { ...ROW, updatedAt: new Proxy(WRITTEN, {}) };
    expect(unwrapErr(interpretStoredRow({ row: proxied }))).toEqual(
      OrganisationErrors.invalid({
        issues: ["the stored row could not be read: this is not a Date object."],
      }),
    );
  });
});
