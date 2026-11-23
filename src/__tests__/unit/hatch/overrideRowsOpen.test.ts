/*
 * The two overrides that used to sit outside the register, opened the way their rows now say: `fable-worker`
 * on its own ambient variable, `responder-allow-open` on a journalled grant and never on its retired variable.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ambientHatchOpen, hatchOpen } from "../../../hatch/open.js";
import { grantedEnv, grantSessionEnv } from "../../hatchGrantFixture.js";

/** Thirty-one minutes, one past the thirty a grant lives for. */
const PAST_EXPIRY_MS = 31 * 60 * 1000;

describe("fable-worker, an ambient row named outside the SLOPWEAVER_ALLOW_ family", () => {
  it("opens on ALLOW_FABLE_OVERRIDE=1, its own name for it", () => {
    expect(ambientHatchOpen({ env: { ALLOW_FABLE_OVERRIDE: "1" }, id: "fable-worker" })).toBe(true);
  });

  it("stays closed on any other value, or with the variable unset", () => {
    expect(ambientHatchOpen({ env: { ALLOW_FABLE_OVERRIDE: "yes" }, id: "fable-worker" })).toBe(false);
    expect(ambientHatchOpen({ env: {}, id: "fable-worker" })).toBe(false);
  });

  it("is not opened by a SLOPWEAVER_ALLOW_ spelling of the same name", () => {
    expect(ambientHatchOpen({ env: { SLOPWEAVER_ALLOW_FABLE_OVERRIDE: "1" }, id: "fable-worker" })).toBe(false);
  });

  it("answers identically through hatchOpen, whose ambient half it is", () => {
    const nowIso = "2026-11-05T12:00:00.000Z";
    expect(hatchOpen({ env: { ALLOW_FABLE_OVERRIDE: "1" }, id: "fable-worker", nowIso })).toBe(true);
    expect(hatchOpen({ env: {}, id: "fable-worker", nowIso })).toBe(false);
  });
});

describe("responder-allow-open, a journalled row", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "responder-open-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("stays closed with the retired SLOPWEAVER_RESPONDER_ALLOW_OPEN=1 and no grant", () => {
    const env = { ...grantSessionEnv({ home }), SLOPWEAVER_RESPONDER_ALLOW_OPEN: "1" };

    expect(hatchOpen({ env, id: "responder-allow-open", nowIso: new Date().toISOString() })).toBe(false);
  });

  it("opens on a live grant issued to the session the environment names", () => {
    const env = grantedEnv({ hatchIds: ["responder-allow-open"], home });

    expect(hatchOpen({ env, id: "responder-allow-open", nowIso: new Date().toISOString() })).toBe(true);
  });

  it("closes once that grant has expired, which is why the listener asks per address", () => {
    const env = grantedEnv({ hatchIds: ["responder-allow-open"], home });
    const later = new Date(Date.now() + PAST_EXPIRY_MS).toISOString();

    expect(hatchOpen({ env, id: "responder-allow-open", nowIso: later })).toBe(false);
  });

  it("is never opened by the ambient half, whatever the environment carries", () => {
    const env = { ...grantedEnv({ hatchIds: ["responder-allow-open"], home }), SLOPWEAVER_RESPONDER_ALLOW_OPEN: "1" };

    expect(ambientHatchOpen({ env, id: "responder-allow-open" })).toBe(false);
  });
});
