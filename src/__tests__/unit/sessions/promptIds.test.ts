/**
 * The prompt ids a transcript names, over a chair's own records around the incident, field-trimmed to
 * `{promptId, sessionId, timestamp, type}`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { recentPromptIds } from "../../../sessions/promptIds.js";

/** The frozen transcript slice. */
const TEXT = readFileSync(join(import.meta.dirname, "../../fixtures/supervisor/chair-metered-a0000038.jsonl"), "utf8");

describe("recentPromptIds", () => {
  it("keeps the newest distinct prompts, oldest first, each at its first transcript instant", () => {
    expect(recentPromptIds({ limit: 3, text: TEXT })).toStrictEqual([
      { firstIso: "2026-09-17T13:34:17.061Z", promptId: "97624c03-6b66-4aea-90ce-1b5822bd53a2" },
      { firstIso: "2026-09-17T13:38:29.731Z", promptId: "5cb9b4ed-4ff6-4381-8a40-03acff6ec113" },
      { firstIso: "2026-09-17T13:40:14.490Z", promptId: "2931f80b-d014-4768-8e30-82fe534b3c60" },
    ]);
  });

  it("returns every prompt when the limit exceeds them", () => {
    expect(recentPromptIds({ limit: 50, text: TEXT }).length).toBe(5);
  });

  it("skips a tail's torn first line and a line with no timestamp", () => {
    const text = [
      'ptId":"aaaaaaaa-0000-4000-8000-000000000000","timestamp":"2026-09-17T13:00:00.000Z"}',
      '{"promptId":"bbbbbbbb-0000-4000-8000-000000000000"}',
      '{"promptId":"cccccccc-0000-4000-8000-000000000000","timestamp":"2026-09-17T13:01:00.000Z"}',
    ].join("\n");

    expect(recentPromptIds({ limit: 5, text })).toStrictEqual([
      { firstIso: "2026-09-17T13:01:00.000Z", promptId: "cccccccc-0000-4000-8000-000000000000" },
    ]);
  });

  it("returns nothing for a zero limit or an empty transcript", () => {
    expect(recentPromptIds({ limit: 0, text: TEXT })).toStrictEqual([]);
    expect(recentPromptIds({ limit: 5, text: "" })).toStrictEqual([]);
  });
});
