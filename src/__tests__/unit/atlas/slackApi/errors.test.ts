import { describe, expect, it } from "vitest";

import { SlackAtlasErrors, slackAtlasErrorLines } from "../../../../atlas/slackApi/errors.js";

describe("SlackAtlasErrors", () => {
  it("says a crossed SDK major in three lines, the remedy it was handed last", () => {
    const error = SlackAtlasErrors.sdkMajorCrossed({ after: "8.0.0", before: "7.9.3", remedy: "run: the remedy" });
    expect(error.code).toBe("SDK_MAJOR_CROSSED");
    expect(slackAtlasErrorLines({ error })).toEqual([
      "this generation was published from @slack/web-api 7.9.3 and this build reads 8.0.0",
      "a major bump renames and removes methods, so accumulating across one would mark the old major's methods stale — which reads as Slack having removed them",
      "run: the remedy",
    ]);
    expect(error.message).toBe(
      "this generation was published from @slack/web-api 7.9.3 and this build reads 8.0.0; a major bump renames and removes methods, so accumulating across one would mark the old major's methods stale — which reads as Slack having removed them; run: the remedy",
    );
  });

  it("names both identities of a clashing entity, then refuses to merge them", () => {
    const error = SlackAtlasErrors.identityClash({
      observed: { id: "e-2", kind: "method", providerId: "chat.postMessage" },
      stored: { kind: "page", providerId: "/client/<team>/settings" },
    });
    expect(error.code).toBe("IDENTITY_CLASH");
    expect(slackAtlasErrorLines({ error })).toEqual([
      "entity e-2 is stored as page//client/<team>/settings and this run saw method/chat.postMessage",
      "refusing to merge — two different things sharing one identity is how an atlas starts reporting a thing that never existed",
    ]);
  });

  it("quotes an Error's own message after the file it could not parse", () => {
    const error = SlackAtlasErrors.sessionNotJson({
      cause: new Error("Unexpected end of JSON input"),
      source: "a.json",
    });
    expect(error).toEqual({
      code: "SESSION_NOT_JSON",
      message: "a.json is not valid JSON: Unexpected end of JSON input",
      source: "a.json",
    });
    expect(slackAtlasErrorLines({ error })).toEqual(["a.json is not valid JSON: Unexpected end of JSON input"]);
  });

  it("stringifies a thrown value that is not an Error", () => {
    const error = SlackAtlasErrors.sessionNotJson({ cause: "bad byte", source: "b.json" });
    expect(error.message).toBe("b.json is not valid JSON: bad byte");
  });
});
