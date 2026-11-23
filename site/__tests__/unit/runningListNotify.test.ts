/*
 * The list route's one helper: it tells the conversation held under an id, answers a reason for an id holding none,
 * and never throws. The lookup is a plain fake; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { notifyRunningListChanged, notifyRunningListChangedVia } from "../../lib/runningListNotify";

describe("notifyRunningListChangedVia", () => {
  it("tells the conversation the lookup resolves for that id, and answers what it answered", async () => {
    const asked: string[] = [];
    const told = { count: 0 };
    const lookup = ({ id }: { id: string }) => {
      asked.push(id);
      return {
        notifyRunningListChanged: async (): Promise<string | undefined> => {
          told.count += 1;
          return undefined;
        },
      };
    };
    expect(await notifyRunningListChangedVia({ callId: "call-7", lookup })).toBe(undefined);
    expect(asked).toEqual(["call-7"]);
    expect(told.count).toBe(1);
  });

  it("passes a conversation's own refusal through unchanged", async () => {
    const lookup = () => ({
      notifyRunningListChanged: async (): Promise<string | undefined> => "the call has ended: the owner hung up",
    });
    expect(await notifyRunningListChangedVia({ callId: "call-7", lookup })).toBe(
      "the call has ended: the owner hung up",
    );
  });

  it("answers a reason for an id holding no conversation", async () => {
    expect(await notifyRunningListChangedVia({ callId: "gone-1", lookup: () => undefined })).toBe(
      "no live call or typed conversation is held under gone-1",
    );
  });

  it("answers a throw as a reason rather than throwing", async () => {
    const lookup = () => ({
      notifyRunningListChanged: async (): Promise<string | undefined> => {
        throw new Error("port closed");
      },
    });
    expect(await notifyRunningListChangedVia({ callId: "call-7", lookup })).toBe(
      "the running-list notice failed: port closed",
    );
  });
});

describe("notifyRunningListChanged", () => {
  it("answers a reason, never a throw, for an id this process holds nothing under", async () => {
    expect(await notifyRunningListChanged({ callId: "never-held" })).toBe(
      "no live call or typed conversation is held under never-held",
    );
  });
});
