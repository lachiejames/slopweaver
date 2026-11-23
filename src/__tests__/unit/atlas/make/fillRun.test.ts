/**
 * Unit: one Make fill walked over a canned organisation — what it asks for and in what order, what it keeps
 * of each answer, and that the first failure or an unreadable shape stops the whole run.
 */
import { describe, expect, it } from "vitest";

import { MAKE_PAGE_LIMIT, type MakeRead, type MakeReadRequest } from "../../../../atlas/make/client.js";
import { MakeAtlasErrors } from "../../../../atlas/make/errors.js";
import { MAKE_EXECUTION_LIMIT, MAKE_MAX_PAGES, MAKE_READ_OPS } from "../../../../atlas/make/fill/plan.js";
import { runMakeFill } from "../../../../atlas/make/fill/run.js";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { fixtureRead } from "./makeFixtures.js";

const AT = "2026-10-15T00:00:00.000Z";

describe("runMakeFill", () => {
  it("walks organisation, team, then each team's folders, scenarios with blueprint and runs, connections and hooks", async () => {
    const seen: MakeReadRequest[] = [];
    unwrap(await runMakeFill({ at: AT, read: fixtureRead({ seen }) }));
    expect(seen).toStrictEqual([
      { offset: 0, op: "organizations.list" },
      { offset: 0, op: "teams.list", organizationId: 1 },
      { op: "folders.list", teamId: 10 },
      { offset: 0, op: "scenarios.list", teamId: 10 },
      { op: "blueprints.get", scenarioId: 1000 },
      { limit: MAKE_EXECUTION_LIMIT, op: "executions.list", scenarioId: 1000 },
      { op: "connections.list", teamId: 10 },
      { offset: 0, op: "hooks.list", teamId: 10 },
    ]);
  });

  it("reaches every read the plan names, sorted", async () => {
    const fill = unwrap(await runMakeFill({ at: AT, read: fixtureRead({ seen: [] }) }));
    expect(fill.reached).toStrictEqual([...MAKE_READ_OPS]);
    expect(fill.filledAtIso).toBe(AT);
  });

  it("keeps a scenario's allowlisted fields and its blueprint outline, never a module's configuration", async () => {
    const fill = unwrap(await runMakeFill({ at: AT, read: fixtureRead({ seen: [] }) }));
    expect(fill.items.scenario).toStrictEqual([
      {
        detail: {
          blueprintOutline: {
            appPrefixes: ["gateway", "builtin", "knowbe4", "vanta"],
            moduleCount: 4,
            modules: ["gateway:CustomWebHook", "builtin:BasicRouter", "knowbe4:deleteUser", "vanta:updatePerson"],
          },
          created: "2026-01-02T00:00:00.000Z",
          createdByUser: { email: "builder@example.test", id: 7, name: "A Builder" },
          description: "Removes a leaver from KnowBe4 and marks them offboarded in Vanta",
          folderId: 101,
          id: 1000,
          isActive: true,
          isPaused: false,
          isinvalid: false,
          lastEdit: "2026-09-01T00:00:00.000Z",
          name: "Offboard leaver",
          scheduling: { type: "immediately" },
          teamId: 10,
          updatedByUser: { email: "editor@example.test", id: 8, name: "An Editor" },
          usedPackages: ["gateway", "knowbe4", "vanta"],
        },
        providerId: "1000",
      },
    ]);
  });

  it("flattens the folder tree, each folder carrying its team", async () => {
    const fill = unwrap(await runMakeFill({ at: AT, read: fixtureRead({ seen: [] }) }));
    expect(fill.items.folder).toStrictEqual([
      { detail: { id: 100, name: "IT", path: "IT", teamId: 10 }, providerId: "100" },
      { detail: { id: 101, name: "Offboarding", path: "IT/Offboarding", teamId: 10 }, providerId: "101" },
    ]);
  });

  it("keeps a connection's app and usage but never its metadata or uid, and a hook's state but never its URL", async () => {
    const fill = unwrap(await runMakeFill({ at: AT, read: fixtureRead({ seen: [] }) }));
    expect(fill.items.connection.map((item) => Object.keys(item.detail).toSorted())).toStrictEqual([
      ["accountLabel", "accountName", "accountType", "expire", "id", "name", "packageName", "scenarioUsages", "teamId"],
    ]);
    expect(fill.items.hook.map((item) => Object.keys(item.detail).toSorted())).toStrictEqual([
      ["enabled", "id", "name", "packageName", "queueCount", "scenarioId", "teamId", "type"],
    ]);
  });

  it("keeps each execution's list row, tagged with its scenario and keyed by its own id", async () => {
    const fill = unwrap(await runMakeFill({ at: AT, read: fixtureRead({ seen: [] }) }));
    expect(fill.items.execution.map((item) => item.providerId)).toStrictEqual(["exec-new", "exec-old"]);
    expect(fill.items.execution[0]!.detail).toStrictEqual({
      duration: 1200,
      id: "exec-new",
      operations: 4,
      scenarioId: 1000,
      status: 1,
      timestamp: "2026-10-14T00:00:00.000Z",
    });
  });

  it("stops at the first failed read and returns its error", async () => {
    const refusal = MakeAtlasErrors.readFailed({ operation: "hooks.list", reason: "403 Forbidden", status: 403 });
    const inner = fixtureRead({ seen: [] });
    const read: MakeRead = ({ request }) =>
      request.op === "hooks.list" ? Promise.resolve(err(refusal)) : inner({ request });
    expect(unwrapErr(await runMakeFill({ at: AT, read }))).toStrictEqual(refusal);
  });

  it("refuses an answer missing a kept field rather than publishing a partial row", async () => {
    const inner = fixtureRead({ seen: [] });
    const read: MakeRead = ({ request }) =>
      request.op === "teams.list" ? Promise.resolve(ok([{ id: 10 }])) : inner({ request });
    const failure = unwrapErr(await runMakeFill({ at: AT, read }));
    expect(failure.code).toBe("MALFORMED_RESPONSE");
    expect(failure.message).toContain("teams.list: 0.name Invalid input: expected string, received undefined");
  });

  it("follows a full page to the next offset and stops on a short one", async () => {
    const seen: MakeReadRequest[] = [];
    const inner = fixtureRead({ seen: [] });
    const full = Array.from({ length: MAKE_PAGE_LIMIT }, (_, index) => ({
      enabled: true,
      id: 9000 + index,
      name: `hook ${String(index)}`,
      packageName: null,
      queueCount: 0,
      teamId: 10,
      type: "web",
    }));
    const read: MakeRead = ({ request }) => {
      if (request.op !== "hooks.list") {
        return inner({ request });
      }
      seen.push(request);
      return Promise.resolve(ok(request.offset === 0 ? full : []));
    };
    const fill = unwrap(await runMakeFill({ at: AT, read }));
    expect(seen.map((request) => request.op === "hooks.list" && request.offset)).toStrictEqual([0, MAKE_PAGE_LIMIT]);
    expect(fill.items.hook.length).toBe(MAKE_PAGE_LIMIT);
  });

  it("refuses a list still full after the page bound instead of publishing part of it", async () => {
    const inner = fixtureRead({ seen: [] });
    const full = Array.from({ length: MAKE_PAGE_LIMIT }, (_, index) => ({ id: index, name: "t", organizationId: 1 }));
    const read: MakeRead = ({ request }) =>
      request.op === "teams.list" ? Promise.resolve(ok(full)) : inner({ request });
    const failure = unwrapErr(await runMakeFill({ at: AT, read }));
    expect(failure.message).toContain(`still more after ${String(MAKE_MAX_PAGES)} pages`);
  });
});
