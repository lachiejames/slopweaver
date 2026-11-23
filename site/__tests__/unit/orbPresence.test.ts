/*
 * The orb's presences: which there are, in the Settings tab's order, the one a first call wears, where the owner's pick
 * is kept, and the guards that read a pick back.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PRESENCE,
  isPresenceId,
  ORB_PRESENCES,
  PRESENCE_IDS,
  PRESENCE_STORAGE_KEY,
  presenceOf,
} from "../../lib/orbPresence";
import { chooseView } from "../../lib/workContext";

// Settings offers six presence options, as it does six themes.
describe("the presences", () => {
  it("are six, in the tab's order, one per id, each under its own name", () => {
    expect([...PRESENCE_IDS]).toEqual(["star-cluster", "mist", "ink", "dot-matrix", "aurora", "embers"]);
    expect(ORB_PRESENCES.map((presence) => `${presence.id}:${presence.name}`)).toEqual([
      "star-cluster:Star cluster",
      "mist:Mist",
      "ink:Ink",
      "dot-matrix:Dot matrix",
      "aurora:Aurora",
      "embers:Embers",
    ]);
  });

  it("open a first call on the star cluster, and keep the owner's pick under its own key", () => {
    expect(DEFAULT_PRESENCE).toBe("star-cluster");
    expect(PRESENCE_STORAGE_KEY).toBe("slopweaver.talk.presence.v1");
  });
});

describe("isPresenceId", () => {
  it("accepts every presence", () => {
    expect(PRESENCE_IDS.length).toBeGreaterThan(0);
    expect(PRESENCE_IDS.filter((id) => !isPresenceId(id))).toEqual([]);
  });

  it("refuses a name that is no presence, the swarm's retired looks and smoke, and the sixth that was swapped out, among them", () => {
    expect(
      ["laser-beams", "steel-wool", "murmuration", "sun", "particles", "Mist", "smoke", "", undefined, 3].map((value) =>
        isPresenceId(value),
      ),
    ).toEqual([false, false, false, false, false, false, false, false, false, false]);
  });
});

describe("presenceOf", () => {
  it("finds a presence by its id, and nothing for an id that names none", () => {
    expect(presenceOf({ id: "dot-matrix" })!.name).toBe("Dot matrix");
    expect(presenceOf({ id: "embers" })!.name).toBe("Embers");
    expect(["sun", "", "smoke"].map((id) => presenceOf({ id }))).toEqual([undefined, undefined, undefined]);
  });
});

describe("an old stored smoke", () => {
  it("opens on the star cluster, never carried over to embers", () => {
    expect(chooseView({ accept: isPresenceId, fallback: DEFAULT_PRESENCE, fromUrl: null, stored: "smoke" })).toBe(
      "star-cluster",
    );
  });
});
