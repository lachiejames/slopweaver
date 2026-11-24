/*
 * A typed look's one frame, and which application a look is credited to.
 */
import { describe, expect, it } from "vitest";

import { creditedLook, gatedTypedLook, refusedLook, type ToolLook } from "../../components/voice/screenLooks";
import { TYPED_LOOK_NOT_ASKED_DETAIL, type TypedLookState } from "../../lib/typedLookGate";

type Shot = Awaited<ReturnType<ToolLook["screenShot"]>>;

const TOOK = {
  ...refusedLook({ reason: "stands in for a frame" }),
  output: "a frame",
} as unknown as Shot;

const NO_FRAME = refusedLook({ reason: "no frame" });

const authority = (state: Partial<TypedLookState> = {}): { current: TypedLookState | undefined } => ({
  current: { messageId: "m1", phase: "replying", spent: false, text: "look at my screen", ...state },
});

const counted = (): { look: () => Promise<Shot>; taken: () => number } => {
  let taken = 0;
  return {
    look: async () => {
      taken += 1;
      return TOOK;
    },
    taken: () => taken,
  };
};

describe("gatedTypedLook", () => {
  it("takes the one look a message asked for", async () => {
    const { look, taken } = counted();
    await expect(gatedTypedLook({ look, typedLook: authority() })()).resolves.toBe(TOOK);
    expect(taken()).toBe(1);
  });

  it("takes one frame for two calls made before the first await", async () => {
    const { look, taken } = counted();
    const typedLook = authority();
    const gated = gatedTypedLook({ look, typedLook });
    const [first, second] = await Promise.all([gated(), gated()]);
    expect(taken()).toBe(1);
    expect(first).toBe(TOOK);
    expect(second.output).toBe(undefined);
  });

  it("takes no frame when the message did not ask, whatever the tool attempted", async () => {
    const { look, taken } = counted();
    const shot = await gatedTypedLook({ look, typedLook: { current: undefined } })();
    expect(taken()).toBe(0);
    expect(shot.answer).toContain("the owner did not ask for one in this message");
    // The exact detail the toast classifier keeps quiet: the same constant on both sides, so neither drifts alone.
    expect(shot.detail).toBe(TYPED_LOOK_NOT_ASKED_DETAIL);
  });

  it("takes no frame for the turn before's late tool call", async () => {
    const { look, taken } = counted();
    await gatedTypedLook({ look, typedLook: authority({ phase: "sending" }) })();
    expect(taken()).toBe(0);
  });

  it("takes no frame after a close forgot the authority", async () => {
    const { look, taken } = counted();
    const typedLook = authority();
    const gated = gatedTypedLook({ look, typedLook });
    typedLook.current = undefined;
    await gated();
    expect(taken()).toBe(0);
  });
});

/** A shell read answering each of the given applications in turn. */
const frontOf = (...apps: readonly string[]): (() => Promise<unknown>) => {
  let index = 0;
  return async () => {
    const app = apps[index];
    index += 1;
    return { app, bundleId: `com.acme.${app}`, kind: "app", title: null };
  };
};

describe("creditedLook", () => {
  it("credits a look to the application in front on both sides of it", async () => {
    const credited = creditedLook({ front: frontOf("Linear", "Linear"), look: async () => TOOK });
    await credited.screenShot();
    expect(credited.lookedApp()).toBe("com.acme.Linear");
  });

  it("credits a look that straddled a switch to neither application", async () => {
    const credited = creditedLook({ front: frontOf("Linear", "Notes"), look: async () => TOOK });
    await credited.screenShot();
    expect(credited.lookedApp()).toBe(undefined);
  });

  it("credits a look that took no frame to nothing", async () => {
    const credited = creditedLook({ front: frontOf("Linear", "Linear"), look: async () => NO_FRAME });
    await credited.screenShot();
    expect(credited.lookedApp()).toBe(undefined);
  });

  it("credits nothing under a shell that cannot say what is in front", async () => {
    const credited = creditedLook({ front: undefined, look: async () => TOOK });
    await credited.screenShot();
    expect(credited.lookedApp()).toBe(undefined);
  });

  it("credits nothing when the shell's read fails, and still hands the look back", async () => {
    const credited = creditedLook({
      front: async () => {
        throw new Error("no");
      },
      look: async () => TOOK,
    });
    await expect(credited.screenShot()).resolves.toBe(TOOK);
    expect(credited.lookedApp()).toBe(undefined);
  });
});
