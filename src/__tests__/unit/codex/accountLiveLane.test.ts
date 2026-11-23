/**
 * Every test lane points the live Codex account read at a binary that does not exist, so a caller that forgot to
 * inject a fake reader gets `unreadable` — today's behaviour — rather than a real app-server launch. The setup
 * file spells the variable's name as a literal (it must set it before any module loads), so this pins the two
 * spellings together.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { APP_SERVER_ENV } from "../../../codex/accountLive.js";

describe("the lane's live-read override", () => {
  it("is the variable the reader honours, pointing at nothing", () => {
    expect(APP_SERVER_ENV).toBe("SLOPWEAVER_CODEX_APP_SERVER");
    expect(process.env[APP_SERVER_ENV]!.endsWith("no-codex-app-server-in-tests")).toBe(true);
    expect(existsSync(process.env[APP_SERVER_ENV]!)).toBe(false);
  });
});
