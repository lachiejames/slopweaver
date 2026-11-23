import { describe, expect, it } from "vitest";

import { GithubRunLogUsageIssues } from "../../../../../cli/commands/github/runLogErrors.js";
import {
  decodeBody,
  EXPIRED_STATUSES,
  redirectLocation,
  responseStatus,
} from "../../../../../cli/commands/github/runLogSeams.js";

/** An in-memory body, handed over in exactly the byte chunks a case is about. */
function bodyOf({ chunks }: { chunks: readonly Uint8Array[] }): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull: (controller) => {
      const next = chunks[index];
      index += 1;
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(next);
    },
  });
}

/** Everything a decode yielded, joined. */
async function decoded({ chunks }: { chunks: readonly Uint8Array[] }): Promise<string> {
  const parts: string[] = [];
  for await (const part of decodeBody({ body: bodyOf({ chunks }) })) {
    parts.push(part);
  }
  return parts.join("");
}

describe("redirectLocation", () => {
  it("reads the signed blob URL out of the headers", () => {
    expect(
      redirectLocation({ response: { headers: { location: "https://blob.example/log?sig=x" }, status: 302 } }),
    ).toBe("https://blob.example/log?sig=x");
  });

  it("answers undefined for a response that followed the redirect and carries no location", () => {
    expect(redirectLocation({ response: { headers: {}, status: 200 } })).toBeUndefined();
  });

  it("answers undefined for an empty location, which names nothing to fetch", () => {
    expect(redirectLocation({ response: { headers: { location: "" } } })).toBeUndefined();
  });

  it("answers undefined for a response that is not a record at all", () => {
    expect(redirectLocation({ response: "not a response" })).toBeUndefined();
  });
});

describe("responseStatus", () => {
  it("reads the reported status", () => {
    expect(responseStatus({ response: { status: 302 } })).toBe(302);
  });

  it("answers 0 when the response named no numeric status", () => {
    expect(responseStatus({ response: { status: "302" } })).toBe(0);
    expect(responseStatus({ response: undefined })).toBe(0);
  });
});

describe("EXPIRED_STATUSES", () => {
  it("holds exactly the two statuses that mean GitHub no longer has the log", () => {
    expect([...EXPIRED_STATUSES]).toEqual([404, 410]);
  });
});

describe("decodeBody", () => {
  it("decodes a body arriving in several chunks, in order", async () => {
    const encoder = new TextEncoder();

    expect(await decoded({ chunks: [encoder.encode("##[error]bad\n"), encoder.encode("dev lint: FAIL\n")] })).toBe(
      "##[error]bad\ndev lint: FAIL\n",
    );
  });

  it("joins a multi-byte character split across two chunks rather than emitting a replacement", async () => {
    // "✓" is three bytes; the gate ticks in a real lint log are full of them, so a split here is the
    // ordinary case rather than an edge.
    const whole = new TextEncoder().encode("  ✓ escape-hatch\n");

    expect(await decoded({ chunks: [whole.slice(0, 3), whole.slice(3)] })).toBe("  ✓ escape-hatch\n");
  });

  it("yields nothing at all for an empty body", async () => {
    expect(await decoded({ chunks: [] })).toBe("");
  });
});

describe("GithubRunLogUsageIssues", () => {
  it("names the flag in a blank-value problem, so a caller knows which one they typed", () => {
    expect(GithubRunLogUsageIssues.blankFlagValue({ flag: "job" })).toEqual({
      code: "BLANK_FLAG_VALUE",
      flag: "job",
      message: "--job was given with no value",
    });
  });

  it("carries the ceiling on a range problem rather than only quoting it in prose", () => {
    const issue = GithubRunLogUsageIssues.tailLinesOutOfRange({ max: 2000 });

    expect(issue.max).toBe(2000);
    expect(issue.message).toBe("--lines must be an integer from 0 to 2000");
  });

  it("tells a caller what a run id LOOKS like rather than only that theirs was wrong", () => {
    expect(GithubRunLogUsageIssues.runIdInvalid().message).toContain("/actions/runs/<id>");
  });

  it("forwards a parser problem's own wording instead of re-writing it", () => {
    expect(GithubRunLogUsageIssues.flagParse({ message: "unknown flag: --tail" })).toEqual({
      code: "FLAG_PARSE",
      message: "unknown flag: --tail",
    });
  });
});
