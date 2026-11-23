/*
 * `dripPerform`: a release whose row moved sends nothing and names why, and a fresh send runs the whole drip.
 */
import { describe, expect, it } from "vitest";
import type { SlackDripOptions } from "../../../../../../cli/commands/slack/coreTypes.js";
import { dripPerform } from "../../../../../../cli/commands/slack/dripPerform.js";
import { freshHome, plan, recorder, useFreshHomes } from "./harness.js";

useFreshHomes();

describe("dripPerform — a release's last re-read, then the drip", () => {
  function dripOptions({ home }: { home: string }): SlackDripOptions {
    return {
      actor: "me",
      channel: "C1",
      dryRun: false,
      home,
      json: false,
      media: [],
      resendUnconfirmed: false,
      shape: "top-level",
      source: { json: "{}", kind: "form" },
      verb: "post",
    };
  }

  it("sends nothing when the release's row moved, and names why", async () => {
    const rec = recorder();

    const performed = await dripPerform({
      api: rec.api,
      deliberateRepeat: false,
      lastCheck: () => ({ message: "row moved" }),
      options: dripOptions({ home: freshHome() }),
      plan: plan({ texts: ["one"] }),
      uploads: new Map(),
    })();

    expect(performed).toEqual({ moved: "row moved" });
    expect(rec.calls).toEqual([]);
  });

  it("runs the whole drip on a fresh send, which carries no re-read", async () => {
    const rec = recorder();

    const performed = await dripPerform({
      api: rec.api,
      deliberateRepeat: false,
      lastCheck: undefined,
      options: dripOptions({ home: freshHome() }),
      plan: plan({ texts: ["one", "two"] }),
      uploads: new Map(),
    })();

    expect(performed).toMatchObject({ outcomes: [{ state: "sent" }, { state: "sent" }] });
    expect(rec.calls.map((call) => call.text)).toEqual(["one", "two"]);
  });
});
