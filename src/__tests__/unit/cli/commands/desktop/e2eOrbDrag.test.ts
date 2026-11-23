import { describe, expect, it } from "vitest";

import { toClient, toScreen, type WindowGeometry } from "../../../../../cli/commands/desktop/e2eOrbDrag.js";

/** A voice window grown over a work area offset by a menu bar, at a non-unit zoom. */
const GEOMETRY: WindowGeometry = {
  bounds: { height: 600, width: 400, x: 1100, y: 300 },
  workArea: { height: 957, width: 1512, x: 0, y: 25 },
  zoom: 1.25,
};

describe("toScreen", () => {
  it("places a client point on the screen through the window's place and zoom", () => {
    expect(toScreen({ geometry: GEOMETRY, point: { x: 80, y: 40 } })).toEqual({ x: 1200, y: 350 });
  });

  it("places the window's own corner at its bounds", () => {
    expect(toScreen({ geometry: GEOMETRY, point: { x: 0, y: 0 } })).toEqual({ x: 1100, y: 300 });
  });
});

describe("toClient", () => {
  it("aims a screen point at the window's client pixels through its place and zoom", () => {
    expect(toClient({ geometry: GEOMETRY, point: { x: 1200, y: 350 } })).toEqual({ x: 80, y: 40 });
  });

  it("aims a screen point left of and above the window at negative client pixels, as a drag past its edge does", () => {
    expect(toClient({ geometry: GEOMETRY, point: { x: 1000, y: 250 } })).toEqual({ x: -80, y: -40 });
  });

  it("undoes toScreen exactly", () => {
    const point = { x: 123, y: 456 };
    expect(toClient({ geometry: GEOMETRY, point: toScreen({ geometry: GEOMETRY, point }) })).toEqual(point);
  });
});
