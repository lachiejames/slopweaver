/*
 * The id maps an ingest run carries: the cache key, an author's resolution against the person index, and that index
 * read once over a scripted client (`../../scriptedStoreClient.ts`).
 */
import { describe, expect, it } from "vitest";

import { ContainerIds, cacheKey, type IdCache, loadPeopleIndex, personFor } from "../../../store/ingestIds.js";
import { scriptedStoreClient } from "../../scriptedStoreClient.js";

/** A fresh cache holding one GitHub login and one Slack user, both pointing at people already in the store. */
const cache = (): IdCache => ({
  containers: new ContainerIds(),
  people: new Map<string, string>([
    ["github octocat", "p-1"],
    ["slack U01", "p-2"],
  ]),
  resolved: new Set<string>(),
  unresolved: new Set<string>(),
});

describe("cacheKey", () => {
  it("keys a native id by its source as well, so two sources' identical ids stay apart", () => {
    expect(cacheKey({ nativeId: "C01", source: "slack" })).toBe("slack C01");
    expect(cacheKey({ nativeId: "C01", source: "linear" })).toBe("linear C01");
  });
});

describe("personFor", () => {
  it("resolves a GitHub login whatever its case, and counts the key resolved once", () => {
    const ids = cache();

    const person = personFor({
      author: { email: null, handle: null, nativeId: "OctoCat" },
      cache: ids,
      source: "github",
    });

    expect(person).toBe("p-1");
    expect([...ids.resolved]).toEqual(["github octocat"]);
    expect([...ids.unresolved]).toEqual([]);
  });

  it("leaves a Slack author the directory does not hold unresolved, and counts that key once", () => {
    const ids = cache();
    const author = { email: null, handle: null, nativeId: "U99" };

    const first = personFor({ author, cache: ids, source: "slack" });
    const second = personFor({ author, cache: ids, source: "slack" });

    expect(first).toBe(null);
    expect(second).toBe(null);
    expect([...ids.unresolved]).toEqual(["slack U99"]);
    expect([...ids.resolved]).toEqual([]);
  });

  it("names nobody for a source with no person column, and counts nothing", () => {
    const ids = cache();

    const person = personFor({ author: { email: null, handle: null, nativeId: "U01" }, cache: ids, source: "gmail" });

    expect(person).toBe(null);
    expect([...ids.resolved]).toEqual([]);
    expect([...ids.unresolved]).toEqual([]);
  });
});

describe("loadPeopleIndex", () => {
  it("keys every set id column, a Linear person by id and by handle, and a GitHub login lower-cased", async () => {
    const { client, statements } = scriptedStoreClient({
      answer: () => [["OctoCat", "p-1", "ada", "lin-1", null, "U01"]],
    });

    const index = await loadPeopleIndex({ client });

    expect(index).toEqual(
      new Map<string, string>([
        ["slack U01", "p-1"],
        ["linear lin-1", "p-1"],
        ["linear ada", "p-1"],
        ["github octocat", "p-1"],
      ]),
    );
    expect(statements().length).toBe(1);
  });

  it("indexes nobody from an empty person table", async () => {
    const { client } = scriptedStoreClient({ answer: () => [] });

    expect(await loadPeopleIndex({ client })).toEqual(new Map<string, string>());
  });
});
