/**
 * The pure half of branch attribution: what counts as a register row declaring a name. The git half is proved
 * against a real repository in the subprocess lane.
 */
import { describe, expect, it } from "vitest";

import { declaresName } from "../../../devLint/secretsRegistryGit.js";

const REGISTER = [
  "export const CREDENTIALS = [",
  "  {",
  '    name: "store-url",',
  '    reader: "src/store/config.ts",',
  "  },",
  "];",
].join("\n");

describe("declaresName", () => {
  it("finds a row's exact name field", () => {
    expect(declaresName({ content: REGISTER, name: "store-url" })).toBe(true);
  });

  it("ignores a name no row carries", () => {
    expect(declaresName({ content: REGISTER, name: "notion-token" })).toBe(false);
  });

  it("ignores a longer name that shares the prefix", () => {
    expect(declaresName({ content: REGISTER.replace('"store-url"', '"store-url-two"'), name: "store-url" })).toBe(
      false,
    );
  });

  it("ignores prose that quotes the field, which the pickaxe would still nominate", () => {
    const prose = ' * the old row read name: "store-url", and was removed';

    expect(declaresName({ content: prose, name: "store-url" })).toBe(false);
  });

  it("finds nothing in an empty register", () => {
    expect(declaresName({ content: "", name: "store-url" })).toBe(false);
  });
});
