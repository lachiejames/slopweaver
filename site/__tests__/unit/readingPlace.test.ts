/*
 * Where the owner was reading: kept as a row and its offset from the list's top, and put back by scrolling that row to the
 * same offset in a history of another size.
 */
import { describe, expect, it } from "vitest";

import { readingPlaceOf, scrollTopFor } from "../../lib/readingPlace";

describe("readingPlaceOf", () => {
  const rows = [
    { bottom: 140, row: "a", top: 100 },
    { bottom: 220, row: "b", top: 150 },
    { bottom: 300, row: "c", top: 230 },
  ];

  it("keeps the first row still in view, part-scrolled off the top, with its negative offset", () => {
    expect(readingPlaceOf({ listTop: 160, rows })).toEqual({ offset: -10, row: "b" });
  });

  it("skips a row whose bottom sits exactly on the list's top, since none of it shows", () => {
    expect(readingPlaceOf({ listTop: 140, rows })).toEqual({ offset: 10, row: "b" });
  });

  it("keeps the first row when the list's top is above every row", () => {
    expect(readingPlaceOf({ listTop: 40, rows })).toEqual({ offset: 60, row: "a" });
  });

  it("keeps nothing with no row in view, or none drawn", () => {
    expect(readingPlaceOf({ listTop: 300, rows })).toBe(undefined);
    expect(readingPlaceOf({ listTop: 0, rows: [] })).toBe(undefined);
  });
});

describe("scrollTopFor", () => {
  it("scrolls the kept row back to the offset it sat at", () => {
    // In the new list the row's top is 900px below the list's top at scroll 0; it sat 10px above the top.
    expect(
      scrollTopFor({ listTop: 50, maxScrollTop: 2000, place: { offset: -10, row: "b" }, rowTop: 950, scrollTop: 0 }),
    ).toEqual({ held: true, top: 910 });
  });

  it("follows from the foot when the list runs out of turns before the row reaches its offset", () => {
    // The row wants 510px, but this taller list scrolls only 100px.
    expect(
      scrollTopFor({ listTop: 0, maxScrollTop: 100, place: { offset: -10, row: "b" }, rowTop: 500, scrollTop: 0 }),
    ).toEqual({ held: false, top: 100 });
  });

  it("follows when the row's place is exactly the foot", () => {
    expect(
      scrollTopFor({ listTop: 0, maxScrollTop: 300, place: { offset: 0, row: "b" }, rowTop: 300, scrollTop: 0 }),
    ).toEqual({ held: false, top: 300 });
  });

  it("holds at the top when the row is too near it for its offset", () => {
    expect(
      scrollTopFor({ listTop: 0, maxScrollTop: 800, place: { offset: 120, row: "a" }, rowTop: 40, scrollTop: 0 }),
    ).toEqual({ held: true, top: 0 });
  });

  it("round-trips: the place read after the scroll is the place kept", () => {
    const place = { offset: 24, row: "c" };
    const { top: scrollTop } = scrollTopFor({ listTop: 0, maxScrollTop: 5000, place, rowTop: 600, scrollTop: 200 });
    const moved = 600 - (scrollTop - 200);
    expect(readingPlaceOf({ listTop: 0, rows: [{ bottom: moved + 80, row: "c", top: moved }] })).toEqual(place);
  });
});
