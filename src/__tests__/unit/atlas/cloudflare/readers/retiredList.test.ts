import { describe, expect, it } from "vitest";

import { retiredListRecords } from "../../../../../atlas/cloudflare/readers/retiredList.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const OPERATION = "firewall-service-rate-limits-list";

describe("retiredListRecords", () => {
  it("reads every record of the envelope's result array", () => {
    const records = unwrap(
      retiredListRecords({
        listed: {
          result: [{ id: "rl-1", period: 60 }, { id: "rl-2" }],
          result_info: { count: 2, page: 1, total_pages: 1 },
          success: true,
        },
        operation: OPERATION,
      }),
    );
    expect(records).toEqual([{ id: "rl-1", period: 60 }, { id: "rl-2" }]);
  });

  it.each([
    { item: { period: 10 }, why: "a record with no id" },
    { item: { id: "" }, why: "an empty id" },
    { item: "not-a-record", why: "a non-record" },
  ])("refuses $why as a schema error naming the record, rather than dropping it", ({ item }) => {
    const error = unwrapErr(
      retiredListRecords({ listed: { result: [{ id: "rl-1" }, item], success: true }, operation: OPERATION }),
    );
    expect(error.kind).toBe("schema");
    expect(error.operation).toBe(OPERATION);
    expect(error.message).toContain("record 1 is not a record with a non-empty string id");
  });

  it("reads an empty result as no records", () => {
    expect(unwrap(retiredListRecords({ listed: { result: [], success: true }, operation: OPERATION }))).toEqual([]);
  });

  it.each([
    { listed: [{ id: "rl-1" }], why: "a bare array, which no envelope sends", keys: "object" },
    { listed: { result: null, success: true }, why: "a null result", keys: "result, success" },
    { listed: undefined, why: "nothing at all", keys: "undefined" },
  ])("refuses $why as a schema error", ({ listed, keys }) => {
    const error = unwrapErr(retiredListRecords({ listed, operation: OPERATION }));
    expect(error.kind).toBe("schema");
    expect(error.operation).toBe(OPERATION);
    expect(error.message).toContain(`got: ${keys}`);
  });

  it.each([
    { resultInfo: { page: 1, total_pages: 2 }, why: "a second page" },
    { resultInfo: { page: 1, total_pages: "2" }, why: "a total_pages that is not a number" },
    { resultInfo: "page 1 of 2", why: "a paging block that is not a record" },
    { resultInfo: { total_count: 2, total_pages: 1 }, why: "a total_count above what one page returned" },
    { resultInfo: { total_count: "1", total_pages: 1 }, why: "a total_count that is not a number" },
  ])("refuses an envelope declaring $why rather than reading the first page as the whole list", ({ resultInfo }) => {
    const error = unwrapErr(
      retiredListRecords({
        listed: { result: [{ id: "rl-1" }], result_info: resultInfo, success: true },
        operation: OPERATION,
      }),
    );
    expect(error.kind).toBe("schema");
    expect(error.message).toContain("declares more than it returned, or paging this code cannot read");
  });

  it("reads an envelope whose paging declares no total_pages as its one page", () => {
    expect(
      unwrap(
        retiredListRecords({
          listed: { result: [{ id: "rl-1" }], result_info: { page: 1 }, success: true },
          operation: OPERATION,
        }),
      ),
    ).toEqual([{ id: "rl-1" }]);
  });
});
