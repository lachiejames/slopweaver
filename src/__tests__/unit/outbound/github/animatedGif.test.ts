import { describe, expect, it } from "vitest";

import { gifFrameCount } from "../../../../outbound/github/animatedGif.js";
import { gifWithFrames } from "../../../gifFixtures.js";

describe("gifFrameCount", () => {
  it("counts the one frame of a still GIF", () => {
    expect(gifFrameCount({ bytes: gifWithFrames({ frames: 1 }) })).toBe(1);
  });

  it("counts every frame of a looping recording", () => {
    expect(gifFrameCount({ bytes: gifWithFrames({ frames: 3, loop: true }) })).toBe(3);
  });

  it("counts a two-frame GIF with no loop extension as two — it still plays with no controls", () => {
    expect(gifFrameCount({ bytes: gifWithFrames({ frames: 2 }) })).toBe(2);
  });

  it("counts the frames a GIF delivered before it was cut off ahead of its trailer", () => {
    const whole = gifWithFrames({ frames: 2 });
    expect(gifFrameCount({ bytes: whole.subarray(0, whole.length - 1) })).toBe(2);
  });

  it("answers undefined for a GIF whose data overruns the buffer mid-block", () => {
    const whole = gifWithFrames({ frames: 2 });
    expect(gifFrameCount({ bytes: whole.subarray(0, whole.length - 4) })).toBeUndefined();
  });

  it("answers undefined for bytes that are not a GIF", () => {
    expect(
      gifFrameCount({ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]) }),
    ).toBeUndefined();
  });

  it("answers undefined for an introducer the grammar does not define", () => {
    const whole = gifWithFrames({ frames: 1 });
    const corrupt = Buffer.concat([whole.subarray(0, 19), Buffer.from([0x99]), whole.subarray(19)]);
    expect(gifFrameCount({ bytes: corrupt })).toBeUndefined();
  });

  it("answers undefined for an empty file", () => {
    expect(gifFrameCount({ bytes: new Uint8Array() })).toBeUndefined();
  });
});
