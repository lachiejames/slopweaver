import { describe, expect, it } from "vitest";

import { VantaHttpErrors, vantaTransportFailureLines } from "../../../../atlas/vanta/httpErrors.js";
import { readVantaPagesSequentially, VANTA_MAX_PAGES, type VantaPage } from "../../../../atlas/vanta/pagination.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";

interface Item {
  readonly id: string;
}

function pageInfo({ hasNextPage, endCursor }: { hasNextPage: boolean; endCursor: string | null }) {
  return { endCursor, hasNextPage, hasPreviousPage: false, startCursor: null };
}

describe("readVantaPagesSequentially", () => {
  it("accumulates items across pages until hasNextPage is false", async () => {
    const pages: VantaPage<Item>[] = [
      { items: [{ id: "a" }], pageInfo: pageInfo({ endCursor: "c1", hasNextPage: true }) },
      { items: [{ id: "b" }], pageInfo: pageInfo({ endCursor: null, hasNextPage: false }) },
    ];
    let call = 0;
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> => ok(pages[call++]!);
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrap(result).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("accepts a valid empty final page as an authoritative zero", async () => {
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> =>
      ok({ items: [], pageInfo: pageInfo({ endCursor: null, hasNextPage: false }) });
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrap(result)).toEqual([]);
  });

  it("propagates a fetch failure", async () => {
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> => err(["boom"]);
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrapErr(result)).toEqual(["boom"]);
  });

  it("refuses a duplicate provider id within one surface's read", async () => {
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> =>
      ok({ items: [{ id: "a" }, { id: "a" }], pageInfo: pageInfo({ endCursor: null, hasNextPage: false }) });
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrapErr(result)).toEqual(VantaHttpErrors.duplicateProviderId({ id: "a" }));
    // The line a reader sees still names the fault, as it did before the failure had a type.
    expect(vantaTransportFailureLines({ error: unwrapErr(result) })[0]).toContain("appeared twice");
  });

  it("refuses hasNextPage:true with no cursor to continue from", async () => {
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> =>
      ok({ items: [], pageInfo: pageInfo({ endCursor: null, hasNextPage: true }) });
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrapErr(result)).toEqual(VantaHttpErrors.cursorMissing());
  });

  it("refuses a repeated cursor rather than looping forever", async () => {
    let call = 0;
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> => {
      call += 1;
      return ok({ items: [], pageInfo: pageInfo({ endCursor: "same", hasNextPage: true }) });
    };
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrapErr(result)).toEqual(VantaHttpErrors.cursorRepeated({ cursor: "same" }));
    expect(call).toBe(2);
  });

  it("refuses once VANTA_MAX_PAGES is exceeded without a final page", async () => {
    let cursorCounter = 0;
    const fetchPage = async (): Promise<Result<VantaPage<Item>>> => {
      cursorCounter += 1;
      return ok({ items: [], pageInfo: pageInfo({ endCursor: `c${String(cursorCounter)}`, hasNextPage: true }) });
    };
    const result = await readVantaPagesSequentially({ fetchPage, providerId: (item) => item.id });
    expect(unwrapErr(result)).toEqual(VantaHttpErrors.pageLimitExceeded({ maxPages: VANTA_MAX_PAGES }));
  });
});
