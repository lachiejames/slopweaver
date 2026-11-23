import { describe, expect, it } from "vitest";
import {
  blankUrlPaths,
  isGraphqlUrl,
  normalizeGraphqlBody,
  scrubGeneric,
  scrubKnownValues,
  scrubLeakClasses,
} from "../cassetteScrub.js";

// Leak-shaped fixtures are assembled at RUNTIME via interpolation so this committed test file never itself
// contains a whole literal the public hygiene gate would flag (it scans every file, tests included).
const homePath = `/${"Users"}/alice/dev/x`;
const slackToken = `xoxb${"-"}1234567890-abcdefghij`;
const ghToken = `gh${"o"}_0123456789abcdef0123456789`;
const wsId = ({ rest }: { rest: string }): string => `${"C"}${rest}`;

describe("scrubLeakClasses", () => {
  it("collapses an absolute home path", () => {
    expect(scrubLeakClasses({ text: `cwd is ${homePath} here` })).toBe("cwd is /<home>/dev/x here");
  });

  it("redacts a slack token shape", () => {
    expect(scrubLeakClasses({ text: `token=${slackToken}` })).toBe("token=[REDACTED-SLACK-TOKEN]");
  });

  it("redacts a github oauth token shape", () => {
    expect(scrubLeakClasses({ text: `${ghToken} end` })).toBe("[REDACTED-GH-TOKEN] end");
  });

  it("collapses a raw workspace id (letter prefix + digits)", () => {
    expect(scrubLeakClasses({ text: `channel ${wsId({ rest: "0123ABCDE" })} posted` })).toBe(
      "channel REDACTEDID posted",
    );
  });

  it("collapses a non-CUAW slack id prefix (file F.../enterprise E...) — broader than the public gate", () => {
    expect(scrubLeakClasses({ text: `file F${"0BKFEQGVPY"} team E${"08UGUNA8EA"}` })).toBe(
      "file REDACTEDID team REDACTEDID",
    );
  });

  it("leaves an all-caps English word (no digit) untouched", () => {
    expect(scrubLeakClasses({ text: "WARRANTIES OF ANY KIND" })).toBe("WARRANTIES OF ANY KIND");
  });

  it("rewrites an email to a synthetic address", () => {
    expect(scrubLeakClasses({ text: "from jane.doe@acme.co today" })).toBe("from redacted@example.com today");
  });

  it("leaves a URL path untouched (that is blankUrlPaths' job)", () => {
    expect(scrubLeakClasses({ text: "https://slack.com/api/conversations.list" })).toBe(
      "https://slack.com/api/conversations.list",
    );
  });
});

describe("blankUrlPaths", () => {
  it("blanks a URL path + query, keeping scheme and host", () => {
    expect(blankUrlPaths({ text: "see https://linear.app/acme/issue/ENG-42/secret-title-slug now" })).toBe(
      "see https://linear.app/[REDACTED] now",
    );
  });

  it("leaves a bare scheme://host (no path) unchanged", () => {
    expect(blankUrlPaths({ text: "https://linear.app" })).toBe("https://linear.app");
  });
});

describe("scrubKnownValues", () => {
  it("redacts a known literal case-insensitively", () => {
    expect(scrubKnownValues({ knownValues: ["Acme"], text: "welcome to ACME corp" })).toBe(
      "welcome to [REDACTED] corp",
    );
  });

  it("redacts every occurrence and preserves surrounding casing", () => {
    expect(scrubKnownValues({ knownValues: ["widget"], text: "Widget and widget and WIDGET" })).toBe(
      "[REDACTED] and [REDACTED] and [REDACTED]",
    );
  });

  it("is a no-op with an empty list", () => {
    expect(scrubKnownValues({ knownValues: [], text: "nothing to hide" })).toBe("nothing to hide");
  });

  it("skips empty needles", () => {
    expect(scrubKnownValues({ knownValues: [""], text: "unchanged" })).toBe("unchanged");
  });
});

describe("scrubGeneric", () => {
  it("applies known-values, then leak classes, then url-path blanking", () => {
    expect(
      scrubGeneric({ knownValues: ["acme"], text: `Acme ${wsId({ rest: "0123456A" })} https://x.com/secret` }),
    ).toBe("[REDACTED] REDACTEDID https://x.com/[REDACTED]");
  });
});

describe("isGraphqlUrl", () => {
  it("is true for the Linear graphql endpoint", () => {
    expect(isGraphqlUrl({ url: "https://api.linear.app/graphql" })).toBe(true);
  });

  it("is true for the GitHub graphql endpoint", () => {
    expect(isGraphqlUrl({ url: "https://api.github.com/graphql" })).toBe(true);
  });

  it("is false for a REST endpoint", () => {
    expect(isGraphqlUrl({ url: "https://slack.com/api/conversations.list" })).toBe(false);
  });
});

describe("normalizeGraphqlBody", () => {
  it("keeps operationName, whitespace-collapsed query, and sorted variables", () => {
    const body = JSON.stringify({
      operationName: "Issues",
      query: "query Issues($first: Int!) {\n  issues(first: $first) {\n    nodes { id }\n  }\n}",
      variables: { after: "cur", first: 50 },
    });
    expect(normalizeGraphqlBody({ body })).toBe(
      JSON.stringify({
        operationName: "Issues",
        query: "query Issues($first: Int!) { issues(first: $first) { nodes { id } } }",
        variables: { after: "cur", first: 50 },
      }),
    );
  });

  it("strips fragment blocks from the query", () => {
    const body = JSON.stringify({ query: "query Q { a { ...F } }\n  fragment F on A { id name }", variables: null });
    expect(normalizeGraphqlBody({ body })).toBe(
      JSON.stringify({ operationName: null, query: "query Q { a { ...F } }", variables: null }),
    );
  });

  it("distinguishes two operations by their normalised query", () => {
    const issues = normalizeGraphqlBody({ body: JSON.stringify({ query: "query Issues { issues { id } }" }) });
    const projects = normalizeGraphqlBody({ body: JSON.stringify({ query: "query Projects { projects { id } }" }) });
    expect(issues === projects).toBe(false);
  });

  it("distinguishes two pages of one operation by their cursor variable", () => {
    const q = "query Issues { issues { id } }";
    const page1 = normalizeGraphqlBody({ body: JSON.stringify({ query: q, variables: {} }) });
    const page2 = normalizeGraphqlBody({ body: JSON.stringify({ query: q, variables: { after: "X" } }) });
    expect(page1 === page2).toBe(false);
  });

  it("returns a non-JSON body unchanged", () => {
    expect(normalizeGraphqlBody({ body: "not json" })).toBe("not json");
  });
});
