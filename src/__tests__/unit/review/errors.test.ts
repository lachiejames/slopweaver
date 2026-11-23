import { describe, expect, it } from "vitest";

import { ReviewErrors, reviewErrorLines } from "../../../review/errors.js";

describe("ReviewErrors", () => {
  it("renders an unknowable slice as one line per reason, in order, with sorted paths", () => {
    const error = ReviewErrors.codeOwnerSliceUnknowable({
      reasons: [
        ReviewErrors.lineError({ paths: ["b.ts", "a.ts"] }),
        ReviewErrors.renameAmbiguous({ paths: ["x to y"] }),
      ],
    });
    expect(error.code).toBe("CODE_OWNER_SLICE_UNKNOWABLE");
    expect(error.reasons.map((reason) => reason.code)).toEqual([
      "CODEOWNERS_LINE_ERROR",
      "CODEOWNERS_RENAME_AMBIGUOUS",
    ]);
    expect(reviewErrorLines({ error })).toEqual([
      "GitHub reports an error on the CODEOWNERS line deciding a.ts, b.ts, so whose those files are is unknown",
      "x to y renamed a file between a path that is the owner's and one that is not, and which path GitHub routes a review by is undocumented, so whether it is the owner's is unknown",
    ]);
    expect(error.message).toBe(reviewErrorLines({ error }).join("; "));
  });

  it("renders the escape and email reasons", () => {
    const escape = ReviewErrors.escapeUndocumented({ lines: [2, 3] });
    const email = ReviewErrors.emailOwner({ paths: ["main.go (CODEOWNERS line 1)"] });
    expect(escape.code).toBe("CODEOWNERS_ESCAPE_UNDOCUMENTED");
    expect(escape.message).toBe(
      "CODEOWNERS line 2, 3 escapes a character with a backslash, and how GitHub reads that is undocumented, so which files are the owner's is unknown",
    );
    expect(email.code).toBe("CODEOWNERS_EMAIL_OWNER");
    expect(email.message).toBe(
      "the CODEOWNERS line deciding main.go (CODEOWNERS line 1) names an email owner, and whose account that email is was not read, so whether those files are the owner's is unknown",
    );
  });

  it("renders each single-message variant as one line", () => {
    const unsafe = ReviewErrors.codeOwnerCountsUnsafe();
    const malformed = ReviewErrors.readingMalformed({ where: "rows.0" });
    const bronze = ReviewErrors.slackBronzeUnlistable({ cause: new Error("denied"), dir: "/b/slack" });
    const bare = ReviewErrors.slackBronzeUnlistable({ cause: "x", dir: "/b/slack" });
    expect(unsafe.code).toBe("CODE_OWNER_COUNTS_UNSAFE");
    expect(reviewErrorLines({ error: unsafe })).toEqual([
      "the owner's files' line counts total past what is counted exactly",
    ]);
    expect(malformed.code).toBe("REVIEWER_READING_MALFORMED");
    expect(reviewErrorLines({ error: malformed })).toEqual([
      "the last github landing reading is not one this build reads: rows.0 is malformed",
    ]);
    expect(bronze.code).toBe("SLACK_BRONZE_UNLISTABLE");
    expect(reviewErrorLines({ error: bronze })).toEqual(["the Slack bronze at /b/slack could not be listed: denied"]);
    expect(bare.message).toBe("the Slack bronze at /b/slack could not be listed: unlistable");
  });
});
