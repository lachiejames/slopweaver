/**
 * Where the two captured-turn sources are read from: a flag always wins, and without one a source is read only for
 * the default home — so a `--home` rehearsal or a test never reads the operator's own dictations.
 */
import { describe, expect, it } from "vitest";

import {
  resolveCodexHome,
  resolveDictationsFolder,
  sourceNotResolvedNote,
} from "../../../../store/fleet/captureSources.js";

const BASE = { defaultHome: "/u/.slopweaver", userHome: "/u" };

describe("resolveDictationsFolder", () => {
  it("reads Superwhisper's own default for the default home, however the home is spelled", () => {
    expect(resolveDictationsFolder({ ...BASE, flag: undefined, home: "/u/.slopweaver/" })).toBe(
      "/u/Documents/superwhisper/recordings",
    );
  });

  it("reads nothing for any other home without a flag", () => {
    expect(resolveDictationsFolder({ ...BASE, flag: undefined, home: "/tmp/rehearsal" })).toBe(undefined);
  });

  it("reads the flag's directory for any home", () => {
    expect(resolveDictationsFolder({ ...BASE, flag: "/r", home: "/tmp/rehearsal" })).toBe("/r");
  });
});

describe("resolveCodexHome", () => {
  it("prefers $CODEX_HOME over ~/.codex for the default home, and ignores an empty one", () => {
    expect(resolveCodexHome({ ...BASE, codexHomeEnv: "/c", flag: undefined, home: BASE.defaultHome })).toBe("/c");
    expect(resolveCodexHome({ ...BASE, codexHomeEnv: "", flag: undefined, home: BASE.defaultHome })).toBe("/u/.codex");
    expect(resolveCodexHome({ ...BASE, codexHomeEnv: undefined, flag: undefined, home: BASE.defaultHome })).toBe(
      "/u/.codex",
    );
  });

  it("reads nothing for any other home without a flag, even with $CODEX_HOME set", () => {
    expect(resolveCodexHome({ ...BASE, codexHomeEnv: "/c", flag: undefined, home: "/tmp/rehearsal" })).toBe(undefined);
  });

  it("reads the flag's directory over $CODEX_HOME", () => {
    expect(resolveCodexHome({ ...BASE, codexHomeEnv: "/c", flag: "/f", home: "/tmp/rehearsal" })).toBe("/f");
  });
});

describe("sourceNotResolvedNote", () => {
  it("names the flag that would read the source", () => {
    expect(sourceNotResolvedNote({ flag: "--codex-home" })).toContain("pass --codex-home <dir> to read one");
  });
});
