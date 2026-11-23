import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SlackWriteTransport } from "../../../../corpus/slack/writeTransport.js";
import { err, ok } from "../../../../lib/result.js";
import type { AskIdentity } from "../../../../live/ask/identity.js";
import { settleLifecycleReaction } from "../../../../live/turn/posterIndicators.js";
import { TurnErrors } from "../../../../live/turn/turnErrors.js";
import { reactingTransport } from "../../../reactingTransportFake.js";

const ASK: AskIdentity = { channel: "C1", messageTs: "1700000000.000050", threadTs: "1700000000.000000" };

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "poster-indicators-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The tagged message wearing the capture and stopped reactions an earlier failed attempt left. */
function seeded(): Map<string, Set<string>> {
  return new Map([[ASK.messageTs, new Set(["eyes", "warning"])]]);
}

describe("settleLifecycleReaction", () => {
  it("succeeds and converges a message wearing the capture and stopped reactions to the completion reaction", async () => {
    const standing = seeded();

    const outcome = await settleLifecycleReaction({
      askIdentity: ASK,
      home,
      reaction: "completion",
      transport: reactingTransport({ standing }),
    });

    expect(outcome).toEqual(ok(undefined));
    expect([...standing.get(ASK.messageTs)!]).toEqual(["white_check_mark"]);
  });

  it("reports a declined add as the unsettled-reaction message", async () => {
    const standing = seeded();
    const addReaction: SlackWriteTransport["addReaction"] = async () => false;

    const outcome = await settleLifecycleReaction({
      askIdentity: ASK,
      home,
      reaction: "completion",
      transport: { ...reactingTransport({ standing }), addReaction },
    });

    expect(outcome).toEqual(err("slack declined to add the :white_check_mark: reaction"));
    expect(outcome).toEqual(err(TurnErrors.reactionDeclined({ action: "add", emoji: "white_check_mark" }).message));
  });

  it("reports a declined removal of the stale :eyes: reaction as the reaction-declined message, leaving the seeded reactions standing as they were", async () => {
    const standing = seeded();
    const base = reactingTransport({ standing });
    const removeReaction: SlackWriteTransport["removeReaction"] = async (request) =>
      request.name === "eyes" ? false : base.removeReaction(request);

    const outcome = await settleLifecycleReaction({
      askIdentity: ASK,
      home,
      reaction: "completion",
      transport: { ...base, removeReaction },
    });

    expect(outcome).toEqual(err("slack declined to remove the stale :eyes: reaction"));
    expect(outcome).toEqual(err(TurnErrors.reactionDeclined({ action: "remove", emoji: "eyes" }).message));
    expect([...standing.get(ASK.messageTs)!]).toEqual(["eyes", "warning"]);
  });
});
