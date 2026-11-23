/*
 * A hand step's picture reaches its card whole or not at all, and each red box is drawn exactly where it was posted —
 * in the picture's own pixels, its number tag kept inside the picture.
 */
import { describe, expect, it } from "vitest";

import { readHandSteps } from "../../components/live/read";
import { readHandShotView, shotOverlay } from "../../lib/handShot";

const SHA = "b".repeat(64);

const BOX = { height: 36, label: "Personal API keys", width: 320, x: 40, y: 120 };

const SHOT = { boxes: [BOX], height: 900, sha256: SHA, width: 1440 };

const STEP = {
  id: "linear-token",
  postedIso: "2026-10-02T13:00:00.000Z",
  what: "Create a Linear personal API key and paste it into the field below",
};

describe("reading a step's shot", () => {
  it("reads the picture and its boxes as the register publishes them", () => {
    expect(readHandShotView({ unboxed: "admitted", value: SHOT })).toEqual({ shot: SHOT });
  });

  it("reads none on a row from before the field", () => {
    expect(readHandSteps([STEP])![0].shot).toBeUndefined();
  });

  it("carries it onto the step", () => {
    expect(readHandSteps([{ ...STEP, shot: SHOT }])![0].shot).toEqual(SHOT);
  });

  it.each([
    ["a box past the right edge", { ...SHOT, boxes: [{ ...BOX, width: 1401 }] }],
    ["a box starting below the picture", { ...SHOT, boxes: [{ ...BOX, y: 900 }] }],
    ["a box with no label", { ...SHOT, boxes: [{ ...BOX, label: " " }] }],
    ["a two-line label", { ...SHOT, boxes: [{ ...BOX, label: "one\ntwo" }] }],
    ["ten boxes", { ...SHOT, boxes: Array.from({ length: 10 }, () => BOX) }],
    ["a hash that spells a path", { ...SHOT, sha256: "../../secrets/linear-token" }],
    ["a fractional width", { ...SHOT, width: 1440.5 }],
    ["a string", "a picture"],
  ])("refuses the picture for %s and draws its step as unreadable, naming shot", (_name, shot) => {
    expect(readHandShotView({ unboxed: "admitted", value: shot })).toBeUndefined();
    expect(readHandSteps([{ ...STEP, shot }])![0].unreadable).toBe("shot");
  });

  it("admits a picture with no boxes on a hand step, and refuses it on an ask", () => {
    const unboxed = { ...SHOT, boxes: [] };
    expect(readHandShotView({ unboxed: "refused", value: unboxed })).toBeUndefined();
    expect(readHandShotView({ unboxed: "admitted", value: unboxed })).toEqual({ shot: unboxed });
    expect(readHandSteps([{ ...STEP, shot: unboxed }])![0].shot).toEqual(unboxed);
  });
});

describe("the overlay", () => {
  it("draws on the picture's natural size, from the step's own store route", () => {
    const overlay = shotOverlay({ shot: SHOT });
    expect(overlay.viewBox).toBe("0 0 1440 900");
    expect(overlay.src).toBe(`/api/hand-shot/${SHA}`);
  });

  it("numbers the boxes from 1 in the order posted, each rect exactly as posted", () => {
    const second = { height: 40, label: "New key", width: 200, x: 1200, y: 40 };
    const overlay = shotOverlay({ shot: { ...SHOT, boxes: [BOX, second] } });
    expect(overlay.boxes.map((box) => [box.number, box.label, box.rect])).toEqual([
      [1, "Personal API keys", { height: 36, width: 320, x: 40, y: 120 }],
      [2, "New key", { height: 40, width: 200, x: 1200, y: 40 }],
    ]);
  });

  it("sizes the tag at a fortieth of the picture's width, never under 16 pixels", () => {
    expect(shotOverlay({ shot: SHOT }).boxes[0].tag.size).toBe(36);
    expect(shotOverlay({ shot: { ...SHOT, boxes: [{ ...BOX, x: 0 }], width: 400 } }).boxes[0].tag.size).toBe(16);
  });

  it("sits the tag above the box when there is room", () => {
    expect(shotOverlay({ shot: SHOT }).boxes[0].tag).toEqual({ size: 36, x: 40, y: 84 });
  });

  it("drops the tag below a box at the top of the picture", () => {
    const top = { ...BOX, y: 10 };
    expect(shotOverlay({ shot: { ...SHOT, boxes: [top] } }).boxes[0].tag).toEqual({ size: 36, x: 40, y: 46 });
  });

  it("keeps the tag inside a box that fills the picture's height", () => {
    const full = { height: 900, label: "the whole page", width: 100, x: 0, y: 0 };
    expect(shotOverlay({ shot: { ...SHOT, boxes: [full] } }).boxes[0].tag).toEqual({ size: 36, x: 0, y: 0 });
  });

  it("pulls the tag of a box at the right edge back inside the picture", () => {
    const edge = { height: 20, label: "corner", width: 10, x: 1430, y: 400 };
    expect(shotOverlay({ shot: { ...SHOT, boxes: [edge] } }).boxes[0].tag).toEqual({ size: 36, x: 1404, y: 364 });
  });
});
