import { describe, expect, it } from "vitest";

import {
  classifySessionRole,
  colourForRole,
  isSessionRole,
  SESSION_ROLE_COLOURS,
  SESSION_ROLES,
  type SessionRole,
} from "../../../cmux/role.js";

/** cmux's own sixteen named workspace colours, from its settings schema's `workspaceColors.colors` default. */
const CMUX_PALETTE = new Set([
  "Red",
  "Crimson",
  "Orange",
  "Amber",
  "Olive",
  "Green",
  "Teal",
  "Aqua",
  "Blue",
  "Navy",
  "Indigo",
  "Purple",
  "Magenta",
  "Rose",
  "Brown",
  "Charcoal",
]);

describe("classifySessionRole", () => {
  it("returns the declared role, which is the tier that cannot be wrong", () => {
    expect(classifySessionRole({ declared: "scheduler", docRole: "bot" })).toBe("scheduler");
  });

  it("falls to the doc's declared role when the call site knows nothing", () => {
    expect(classifySessionRole({ docRole: "bot" })).toBe("bot");
  });

  it("calls everything else a temporary session, which is an answer and not a failure to reach one", () => {
    expect(classifySessionRole({})).toBe("session");
  });

  it("infers nothing from anywhere, so it cannot infer wrongly", () => {
    expect(classifySessionRole({ declared: undefined, docRole: undefined })).toBe("session");
  });
});

describe("colourForRole", () => {
  it("colours exactly the three standing surfaces", () => {
    expect(colourForRole({ role: "supervisor" })).toBe("Indigo");
    expect(colourForRole({ role: "bot" })).toBe("Green");
    expect(colourForRole({ role: "scheduler" })).toBe("Teal");
  });

  it("leaves every spawned row plain, which is the whole point of the signal", () => {
    expect(colourForRole({ role: "session" })).toBe(undefined);
  });

  it("colours three roles and no more, so a tint always means always-on", () => {
    const named = SESSION_ROLES.map((role) => SESSION_ROLE_COLOURS[role]).filter(
      (colour): colour is string => colour !== undefined,
    );

    expect(named.length).toBe(3);
  });

  it("only ever names a colour cmux's own palette has", () => {
    const named = SESSION_ROLES.map((role) => SESSION_ROLE_COLOURS[role]).filter(
      (colour): colour is string => colour !== undefined,
    );

    expect(named.filter((colour) => CMUX_PALETTE.has(colour))).toStrictEqual(named);
  });

  it("gives no two roles the same colour", () => {
    const named = SESSION_ROLES.map((role) => SESSION_ROLE_COLOURS[role]).filter(
      (colour): colour is string => colour !== undefined,
    );

    expect(new Set(named).size).toBe(named.length);
  });
});

describe("isSessionRole", () => {
  it("accepts every role in the set", () => {
    expect(SESSION_ROLES.filter((role: SessionRole) => isSessionRole(role))).toStrictEqual([...SESSION_ROLES]);
  });

  it("rejects a retired role name, so an old doc's line does not silently colour a row", () => {
    expect(isSessionRole("tooling")).toBe(false);
    expect(isSessionRole("team")).toBe(false);
    expect(isSessionRole("botWork")).toBe(false);
  });

  it("rejects a typo, a near miss and a non-string", () => {
    expect(isSessionRole("Supervisor")).toBe(false);
    expect(isSessionRole("")).toBe(false);
    expect(isSessionRole(undefined)).toBe(false);
    expect(isSessionRole(7)).toBe(false);
  });
});
