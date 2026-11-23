/*
 * `truncatedSendAllowed`: a truncated send opens only for this session's own live grant of the truncated-send
 * hatch, never for another session's, another hatch's, or the retired ambient variable. Each case mints a
 * throwaway home this file removes. It moved here when `truncate.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { TRUNCATED_SEND_HATCH, truncatedSendAllowed } from "../../../../../outbound/artifact/truncatedSendHatch.js";
import { grantedEnv, grantSessionEnv } from "../../../../hatchGrantFixture.js";

/** The retired ambient variable; it opens nothing now, and a test proves that by setting it. */
const REMOVED_VARIABLE = "SLOPWEAVER_ALLOW_TRUNCATED_SEND";

describe("truncatedSendAllowed", () => {
  const homes: string[] = [];
  const freshHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "truncate-grant-"));
    homes.push(home);
    return home;
  };

  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("is true while this session holds a live truncated-send grant", () => {
    const env = grantedEnv({ hatchIds: [TRUNCATED_SEND_HATCH], home: freshHome() });
    expect(truncatedSendAllowed({ env })).toBe(true);
  });

  it("is false when the session holds no grant", () => {
    expect(truncatedSendAllowed({ env: grantSessionEnv({ home: freshHome() }) })).toBe(false);
  });

  it("is false when no session is named at all", () => {
    expect(truncatedSendAllowed({ env: { SLOPWEAVER_HOME: freshHome() } })).toBe(false);
  });

  it("is false for a grant held by a DIFFERENT session", () => {
    const home = freshHome();
    grantedEnv({ hatchIds: [TRUNCATED_SEND_HATCH], home, session: "other-session" });
    expect(truncatedSendAllowed({ env: grantSessionEnv({ home }) })).toBe(false);
  });

  it("is false for a grant of a DIFFERENT hatch", () => {
    const env = grantedEnv({ hatchIds: ["voice-rules"], home: freshHome() });
    expect(truncatedSendAllowed({ env })).toBe(false);
  });

  it("is false when the removed variable is set to 1 and no grant exists", () => {
    const env = { ...grantSessionEnv({ home: freshHome() }), [REMOVED_VARIABLE]: "1" };
    expect(truncatedSendAllowed({ env })).toBe(false);
  });
});
