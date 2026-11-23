/*
 * The orb's flight between the corner and the stage: the transform that draws the arriving orb over the one it
 * replaces.
 */
import { describe, expect, it } from "vitest";

import { backdropFadeOf, flightKeyframes } from "../../lib/orbFlight";

const STAGE = { height: 400, left: 100, top: 200, width: 400 };
const CORNER = { height: 56, left: 1200, top: 800, width: 56 };

describe("flightKeyframes", () => {
  it("starts the stage orb over the corner's, shrunk to its size, and ends in its own place", () => {
    // The corner's centre is (1228, 828); the stage's is (300, 400); 56 / 400 = 0.14.
    expect(flightKeyframes({ from: CORNER, to: STAGE })).toEqual(["translate(928px, 428px) scale(0.14)", "none"]);
  });

  it("starts the corner orb over the stage's, grown to its size", () => {
    expect(flightKeyframes({ from: STAGE, to: CORNER })).toEqual(["translate(-928px, -428px) scale(7.1429)", "none"]);
  });

  it("moves nothing between two copies of one box", () => {
    expect(flightKeyframes({ from: STAGE, to: STAGE })).toEqual(["translate(0px, 0px) scale(1)", "none"]);
  });

  it("does not fly from or to a box with no size", () => {
    expect(flightKeyframes({ from: { ...CORNER, width: 0 }, to: STAGE })).toBeUndefined();
    expect(flightKeyframes({ from: CORNER, to: { ...STAGE, height: 0 } })).toBeUndefined();
  });
});

describe("backdropFadeOf", () => {
  it("gathers the corner's disc in as that orb lands, rather than popping it in at the stage's size", () => {
    expect(backdropFadeOf({ arriving: "corner" })).toEqual([0, 1]);
  });

  it("starts the stage orb on the corner's disc and leaves the enlarged view with none", () => {
    expect(backdropFadeOf({ arriving: "stage" })).toEqual([1, 0]);
  });

  it("fades between none and the strength the owner set on the slider, never past it", () => {
    expect(backdropFadeOf({ arriving: "corner", strength: 0.4 })).toEqual([0, 0.4]);
    expect(backdropFadeOf({ arriving: "stage", strength: 0.4 })).toEqual([0.4, 0]);
  });
});
