/**
 * The redaction, which is the reason `harObservations.ts` is committed code rather than a script.
 *
 * Half of these assertions are the negative kind — that a real Slack object id or message timestamp is NOT
 * in the output. They exist because the script this module replaced shipped real ones into a committed
 * file and only the public hygiene gate noticed.
 */
import { describe, expect, it } from "vitest";

import { type CapturedCall, observationsFromCalls, redactPath } from "../../../../atlas/slackApi/harObservations.js";
import { BROWSER_PATH_CAP } from "../../../../atlas/slackApi/model.js";

describe("redactPath", () => {
  it("leaves an ordinary field path alone", () => {
    expect(redactPath({ path: "messages[].reply_count" })).toBe("messages[].reply_count");
  });

  it("collapses a message timestamp used as a map key to ONE placeholder", () => {
    // The capture yields `1782267351.372679` as two segments, because the path is dot-separated too.
    expect(redactPath({ path: "latest_updates.1782267351.372679" })).toBe("latest_updates.<ts>");
  });

  // The fixtures below use an all-letters id (`CFAKECHANNEL`). A real Slack id carries digits, and the
  // public hygiene gate flags one in a committed file, refusing it wherever `IDENTIFIER_VERDICT` reads
  // `refuse` — correctly, since a test fixture is as public as
  // any other line. All-letters still exercises the redactor, whose rule is prefix-plus-eight, not digits.
  it("redacts a Slack object id used as a map key", () => {
    expect(redactPath({ path: "threads.unread_count_by_channel.CFAKECHANNEL" })).toBe(
      "threads.unread_count_by_channel.<id>",
    );
  });

  it("redacts a lone digit segment too, since one is still a value", () => {
    expect(redactPath({ path: "counts.1782267351" })).toBe("counts.<ts>");
  });

  it("keeps a short upper-case word that is not long enough to be an id", () => {
    expect(redactPath({ path: "prefs.DND" })).toBe("prefs.DND");
  });

  it("keeps a field name that merely contains digits", () => {
    expect(redactPath({ path: "icons.image_36" })).toBe("icons.image_36");
  });

  it("redacts every value segment in a path that has more than one", () => {
    expect(redactPath({ path: "by_channel.CFAKECHANNEL.1782267351.372679" })).toBe("by_channel.<id>.<ts>");
  });
});

describe("observationsFromCalls", () => {
  const sdkMethodNames = new Set(["conversations.history"]);
  const sdkParamsByMethod = new Map([["conversations.history", new Set(["channel", "limit", "oldest"])]]);

  it("drops the token and every _x_ telemetry parameter", () => {
    const calls: readonly CapturedCall[] = [
      {
        body: { ok: true },
        name: "conversations.history",
        paramNames: ["_x_id", "_x_reason", "fp", "slack_route", "token", "channel", "cached_latest_updates"],
      },
    ];
    const rows = observationsFromCalls({ calls, sdkMethodNames, sdkParamsByMethod });
    expect(rows[0]!.undocumentedParams).toEqual(["cached_latest_updates"]);
  });

  it("marks a name the SDK declares as public surface, and one it does not as internal", () => {
    const calls: readonly CapturedCall[] = [
      { body: undefined, name: "conversations.history", paramNames: [] },
      { body: undefined, name: "client.counts", paramNames: [] },
    ];
    const rows = observationsFromCalls({ calls, sdkMethodNames, sdkParamsByMethod });
    expect(rows.map((row) => [row.name, row.publicSurface])).toEqual([
      ["client.counts", false],
      ["conversations.history", true],
    ]);
  });

  it("collapses an array to one path however many elements it has", () => {
    const calls: readonly CapturedCall[] = [
      {
        body: { messages: [{ reply_count: 1 }, { reply_count: 2 }, { reply_count: 3 }] },
        name: "conversations.history",
        paramNames: [],
      },
    ];
    expect(observationsFromCalls({ calls, sdkMethodNames, sdkParamsByMethod })[0]!.responsePaths).toEqual([
      "messages",
      "messages[].reply_count",
    ]);
  });

  it("reads EVERY array element, because Slack's message arrays are heterogeneous", () => {
    // A join-notice message carries no thread fields. Reading only the first element would report
    // `reply_count` as absent from a response that plainly has it.
    const calls: readonly CapturedCall[] = [
      {
        body: { messages: [{ subtype: "channel_join" }, { reply_count: 4 }] },
        name: "conversations.history",
        paramNames: [],
      },
    ];
    expect(observationsFromCalls({ calls, sdkMethodNames, sdkParamsByMethod })[0]!.responsePaths).toEqual([
      "messages",
      "messages[].reply_count",
      "messages[].subtype",
    ]);
  });

  it("merges every call to the same method into one row", () => {
    const calls: readonly CapturedCall[] = [
      { body: { a: 1 }, name: "conversations.history", paramNames: ["channel"] },
      { body: { b: 2 }, name: "conversations.history", paramNames: ["cursor"] },
    ];
    const rows = observationsFromCalls({ calls, sdkMethodNames, sdkParamsByMethod });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.responsePaths).toEqual(["a", "b"]);
    expect(rows[0]!.undocumentedParams).toEqual(["cursor"]);
  });

  it("caps the path list and states the true total, so the omission is never silent", () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index < BROWSER_PATH_CAP + 25; index += 1) {
      wide[`field_${String(index).padStart(3, "0")}`] = index;
    }
    const rows = observationsFromCalls({
      calls: [{ body: wide, name: "experiments.getByUser", paramNames: [] }],
      sdkMethodNames,
      sdkParamsByMethod,
    });
    expect(rows[0]!.responsePaths).toHaveLength(BROWSER_PATH_CAP);
    expect(rows[0]!.responsePathsTotal).toBe(BROWSER_PATH_CAP + 25);
  });

  it("reads no path out of a body that was absent or not JSON", () => {
    const rows = observationsFromCalls({
      calls: [{ body: undefined, name: "conversations.history", paramNames: [] }],
      sdkMethodNames,
      sdkParamsByMethod,
    });
    expect(rows[0]!.responsePaths).toEqual([]);
    expect(rows[0]!.responsePathsTotal).toBe(0);
  });

  it("treats every parameter as undocumented for a method the SDK does not declare", () => {
    const rows = observationsFromCalls({
      calls: [{ body: undefined, name: "client.counts", paramNames: ["thread_counts_by_channel", "token"] }],
      sdkMethodNames,
      sdkParamsByMethod,
    });
    expect(rows[0]!.undocumentedParams).toEqual(["thread_counts_by_channel"]);
  });

  it("returns nothing for no calls", () => {
    expect(observationsFromCalls({ calls: [], sdkMethodNames, sdkParamsByMethod })).toEqual([]);
  });
});

describe("the committed browser table", () => {
  it("carries no unredacted Slack object id", async () => {
    // The end-to-end guard on the whole file, not just on the function that produced it. The public
    // hygiene gate checks this too; having it here means a regression fails a test rather than a push.
    const { BROWSER_OBSERVED_METHODS } = await import("../../../../atlas/slackApi/browser.js");
    const everyPath = BROWSER_OBSERVED_METHODS.flatMap((row) => [
      row.name,
      ...row.responsePaths,
      ...row.undocumentedParams,
    ]);
    const leaks = everyPath.filter((path) =>
      path.split(/[.[\]]/).some((segment) => /^[A-Z][A-Z0-9]{8,}$/.test(segment)),
    );
    expect(leaks).toEqual([]);
  });

  it("carries no unredacted timestamp", async () => {
    const { BROWSER_OBSERVED_METHODS } = await import("../../../../atlas/slackApi/browser.js");
    const everyPath = BROWSER_OBSERVED_METHODS.flatMap((row) => row.responsePaths);
    expect(everyPath.filter((path) => /\d{6,}/.test(path))).toEqual([]);
  });
});
