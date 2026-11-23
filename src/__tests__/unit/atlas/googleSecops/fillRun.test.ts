/**
 * Unit: a fill run walks every planned list through the injected GET — following page tokens, stopping at
 * the page bound, and recording a refused list without sinking the others.
 */
import { describe, expect, it } from "vitest";

import { runGoogleSecopsFill, SECOPS_MAX_FILL_PAGES, type SecopsGet } from "../../../../atlas/googleSecops/fill/run.js";
import { err, ok, unwrap } from "../../../../lib/result.js";
import { GoogleSecopsReadErrors } from "../../../../live/googleSecops/errors.js";
import { parseSecopsInstance } from "../../../../live/googleSecops/instance.js";

const NAME = "projects/fixture-project/locations/australia-southeast1/instances/00000000-0000-4000-8000-000000000001";
const INSTANCE = unwrap(parseSecopsInstance({ value: NAME }));
const AT = "2026-10-02T00:00:00.000Z";

/** A GET answering each list by the path tail after the instance, recording every URL it was asked for. */
function fakeGet({ answer }: { answer: (input: { tail: string; pageToken: string | null }) => unknown }): {
  readonly get: SecopsGet;
  readonly asked: string[];
} {
  const asked: string[] = [];
  const get: SecopsGet = ({ url }) => {
    asked.push(`${url.pathname}${url.search}`);
    const tail = url.pathname.slice(`/v1/${NAME}`.length);
    const body = answer({ pageToken: url.searchParams.get("pageToken"), tail });
    if (body instanceof Error) {
      return Promise.resolve(err(GoogleSecopsReadErrors.transportFailed({ message: body.message, status: 403 })));
    }
    return Promise.resolve(ok(body));
  };
  return { asked, get };
}

describe("runGoogleSecopsFill", () => {
  it("answers every list once on an empty instance, asking each for its largest page", async () => {
    const { get, asked } = fakeGet({ answer: () => ({}) });
    const fill = await runGoogleSecopsFill({ at: AT, get, instance: INSTANCE });
    expect(fill.failed).toStrictEqual([]);
    expect(
      fill.answered.map((entry) => `${entry.rpc}:${String(entry.items.length)}:${String(entry.truncated)}`),
    ).toStrictEqual([
      "ListDataTables:0:false",
      "ListNativeDashboards:0:false",
      "ListFeaturedContentNativeDashboards:0:false",
      "ListFeeds:0:false",
      "ListFindingsRefinements:0:false",
      "ListAllFindingsRefinementDeployments:0:false",
    ]);
    expect(asked).toStrictEqual([
      `/v1/${NAME}/dataTables?pageSize=100`,
      `/v1/${NAME}/nativeDashboards?pageSize=100`,
      `/v1/${NAME}/contentHub/featuredContentNativeDashboards?pageSize=100`,
      `/v1/${NAME}/feeds?pageSize=100`,
      `/v1/${NAME}/findingsRefinements?pageSize=100`,
      `/v1/${NAME}:listAllFindingsRefinementDeployments?pageSize=100`,
    ]);
    expect(fill.filledAtIso).toBe(AT);
  });

  it("follows a page token to the last page and keeps every page's items", async () => {
    const { get, asked } = fakeGet({
      answer: ({ tail, pageToken }) => {
        if (tail !== "/feeds") {
          return {};
        }
        if (pageToken === null) {
          return { feeds: [{ name: `${NAME}/feeds/a` }], nextPageToken: "p2" };
        }
        return { feeds: [{ name: `${NAME}/feeds/b` }] };
      },
    });
    const fill = await runGoogleSecopsFill({ at: AT, get, instance: INSTANCE });
    const feeds = fill.answered.find((entry) => entry.rpc === "ListFeeds")!;
    expect(feeds.items.map((item) => item.providerId)).toStrictEqual([`${NAME}/feeds/a`, `${NAME}/feeds/b`]);
    expect(feeds.truncated).toBe(false);
    expect(asked.filter((line) => line.includes("/feeds"))).toStrictEqual([
      `/v1/${NAME}/feeds?pageSize=100`,
      `/v1/${NAME}/feeds?pageSize=100&pageToken=p2`,
    ]);
  });

  it("stops at the page bound and says the list is truncated", async () => {
    const { get, asked } = fakeGet({
      answer: ({ tail, pageToken }) =>
        tail === "/dataTables"
          ? { dataTables: [{ name: `${NAME}/dataTables/${String(pageToken)}` }], nextPageToken: "more" }
          : {},
    });
    const fill = await runGoogleSecopsFill({ at: AT, get, instance: INSTANCE });
    const tables = fill.answered.find((entry) => entry.rpc === "ListDataTables")!;
    expect(tables.truncated).toBe(true);
    expect(tables.items.length).toBe(SECOPS_MAX_FILL_PAGES);
    expect(asked.filter((line) => line.includes("/dataTables")).length).toBe(SECOPS_MAX_FILL_PAGES);
  });

  it("records a 403 on one list with Google's status and still reads the rest", async () => {
    const { get } = fakeGet({
      answer: ({ tail }) => (tail === "/feeds" ? new Error("The caller does not have permission") : {}),
    });
    const fill = await runGoogleSecopsFill({ at: AT, get, instance: INSTANCE });
    expect(fill.failed.map((entry) => ({ kind: entry.kind, rpc: entry.rpc, status: entry.status }))).toStrictEqual([
      { kind: "feed", rpc: "ListFeeds", status: 403 },
    ]);
    expect(fill.failed[0]!.message).toBe("The caller does not have permission");
    expect(fill.answered.length).toBe(5);
  });

  it("records a body the boundary refuses as a failure with no status", async () => {
    const { get } = fakeGet({
      answer: ({ tail }) => (tail === "/findingsRefinements" ? { findingsRefinements: "x" } : {}),
    });
    const fill = await runGoogleSecopsFill({ at: AT, get, instance: INSTANCE });
    expect(fill.failed.map((entry) => `${entry.rpc}:${String(entry.status)}`)).toStrictEqual([
      "ListFindingsRefinements:null",
    ]);
  });
});
