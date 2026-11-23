import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { grantEnvOf } from "../../../hatch/grantSession.js";
import { hatchOpen } from "../../../hatch/open.js";
import { CLAUDE_CODE_SESSION_ID_ENV, CODEX_THREAD_ID_ENV } from "../../../supervisor/session.js";
import { envReader, grantedEnv, grantSessionEnv, TEST_GRANT_SESSION } from "../../hatchGrantFixture.js";

/** Thirty-one minutes, one past the thirty a grant lives for. */
const PAST_EXPIRY_MS = 31 * 60 * 1000;

describe("hatchOpen on a journalled row", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hatch-open-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("stays closed with its retired variable set and no grant, because a variable leaves no journal row", () => {
    const env = { ...grantSessionEnv({ home }), SLOPWEAVER_ALLOW_WALL: "1" };

    expect(hatchOpen({ env, id: "wall", nowIso: new Date().toISOString() })).toBe(false);
  });

  it("opens on a live grant issued to the session the environment names", () => {
    const env = grantedEnv({ hatchIds: ["wall"], home });

    expect(hatchOpen({ env, id: "wall", nowIso: new Date().toISOString() })).toBe(true);
  });

  it("opens on the home passed explicitly, ahead of the one the environment names", () => {
    grantedEnv({ hatchIds: ["wall"], home });
    const env = { [CLAUDE_CODE_SESSION_ID_ENV]: TEST_GRANT_SESSION };

    expect(hatchOpen({ env, home, id: "wall", nowIso: new Date().toISOString() })).toBe(true);
  });

  it("closes once the grant has expired", () => {
    const env = grantedEnv({ hatchIds: ["wall"], home });
    const later = new Date(Date.now() + PAST_EXPIRY_MS).toISOString();

    expect(hatchOpen({ env, id: "wall", nowIso: later })).toBe(false);
  });

  it("stays closed for a grant issued to another session", () => {
    grantedEnv({ hatchIds: ["wall"], home });
    const env = grantSessionEnv({ home, session: "d00d0000-1111-2222-3333-444455556666" });

    expect(hatchOpen({ env, id: "wall", nowIso: new Date().toISOString() })).toBe(false);
  });

  it("stays closed for a grant on a different hatch", () => {
    const env = grantedEnv({ hatchIds: ["voice-rules"], home });

    expect(hatchOpen({ env, id: "wall", nowIso: new Date().toISOString() })).toBe(false);
  });

  it("opens for a Codex thread holding the grant, because Codex is a substitute host", () => {
    grantedEnv({ hatchIds: ["wall"], home, session: "codex-thread-0001" });
    const env = { [CODEX_THREAD_ID_ENV]: "codex-thread-0001", SLOPWEAVER_HOME: home };

    expect(hatchOpen({ env, id: "wall", nowIso: new Date().toISOString() })).toBe(true);
  });

  it("stays closed when both a Claude session and a Codex thread are named, rather than picking one", () => {
    grantedEnv({ hatchIds: ["wall"], home });
    const env = { ...grantSessionEnv({ home }), [CODEX_THREAD_ID_ENV]: "codex-thread-0001" };

    expect(hatchOpen({ env, id: "wall", nowIso: new Date().toISOString() })).toBe(false);
  });

  it("stays closed when no session is named at all", () => {
    grantedEnv({ hatchIds: ["wall"], home });

    expect(hatchOpen({ env: { SLOPWEAVER_HOME: home }, id: "wall", nowIso: new Date().toISOString() })).toBe(false);
  });
});

describe("hatchOpen on an ambient row", () => {
  it("opens on its variable set to 1", () => {
    const env = { SLOPWEAVER_ALLOW_CARD_FRAMING: "1" };

    expect(hatchOpen({ env, id: "card-framing", nowIso: new Date().toISOString() })).toBe(true);
  });

  it("stays closed on any other value of its variable", () => {
    const env = { SLOPWEAVER_ALLOW_CARD_FRAMING: "true" };

    expect(hatchOpen({ env, id: "card-framing", nowIso: new Date().toISOString() })).toBe(false);
  });
});

describe("grantEnvOf", () => {
  it("copies exactly the two session ids and the state home a grant check reads", () => {
    const read = envReader({
      env: { [CLAUDE_CODE_SESSION_ID_ENV]: "s-1", PATH: "/usr/bin", SLOPWEAVER_HOME: "/h" },
    });

    expect(grantEnvOf({ read })).toEqual({
      [CLAUDE_CODE_SESSION_ID_ENV]: "s-1",
      [CODEX_THREAD_ID_ENV]: undefined,
      SLOPWEAVER_HOME: "/h",
    });
  });
});
