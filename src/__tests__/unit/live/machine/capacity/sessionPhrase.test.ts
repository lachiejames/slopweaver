import { describe, expect, it } from "vitest";
import { sessionPhrase } from "../../../../../live/machine/sessionOwner.js";
import { INCIDENT_SESSION } from "./fixtures.js";

describe("sessionPhrase", () => {
  it("names the session id and the worktree its cwd ends in, trailing slash and all", () => {
    expect(sessionPhrase({ session: INCIDENT_SESSION })).toBe(
      "session d5546c00-0000-4000-8000-000000000000 in live-bot-loop-a",
    );
  });

  it("names the id alone when the registry recorded no cwd", () => {
    expect(sessionPhrase({ session: { ...INCIDENT_SESSION, cwd: "" } })).toBe(
      "session d5546c00-0000-4000-8000-000000000000",
    );
  });
});
