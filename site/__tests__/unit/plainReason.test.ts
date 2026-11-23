/*
 * A failed read's reason as one plain line, and the raw message kept apart for the fold: the console's own transport
 * sentences by their shape, a status or errno code by its code, the console's own missing-token line, and anything else
 * said honestly as a technical error — never guessed at, and never lifted as itself.
 */
import { describe, expect, it } from "vitest";

import { failedRunLeadOf, fullMessageOf, plainReasonOf } from "../../lib/plainReason";

describe("failedRunLeadOf", () => {
  it("leads a failed sync run with a fixed true sentence, never its first raw error", () => {
    expect([
      failedRunLeadOf({ errors: ['GET /x: {"error":"invalid_grant"}'] }),
      failedRunLeadOf({ errors: [] }),
    ]).toEqual(["This run failed.", "This run failed without giving an error message."]);
  });
});

describe("a sync run's stored errors", () => {
  it("says a stack trace and a JSON body plainly, each kept whole for the fold", () => {
    const stack = "TypeError: boom\n    at readChannel (/repo/src/slack.ts:12:3)\n    at main (/repo/src/run.ts:4:1)";
    const json = '{"ok":false,"detail":{"field":"cursor","value":null}}';

    expect([stack, json].map((why) => plainReasonOf({ why }))).toEqual([
      { plain: "It failed with a technical error.", raw: stack },
      { plain: "It failed with a technical error.", raw: json },
    ]);
  });
});

describe("a failed desktop update's reason", () => {
  it("keeps the error leading the fold, ahead of the command that hit it", () => {
    const why =
      "bash: ../scripts/tsc-owner.sh: No such file or directory (exit 127) — from `yarn app --config.buildVersion=4152`";

    expect(plainReasonOf({ why })).toEqual({ plain: "It failed with a technical error.", raw: why });
  });
});

describe("fullMessageOf", () => {
  it("folds the run's whole record under Full message, never the short words the verb extracted", () => {
    const detail =
      'recipe acme · ran · slopweaver foo · exit 1 · why: GET /x: {"status":401,"message":"bad credentials"}';

    expect([
      fullMessageOf({ account: { detail, said: "bad credentials" } }),
      fullMessageOf({ account: { detail: undefined, said: "bad credentials" } }),
    ]).toEqual([detail, undefined]);
  });
});

describe("plainReasonOf", () => {
  it("says the console's own transport sentences plainly, keeping each raw", () => {
    const reasons = [
      "slopweaver hand list did not answer within 30s",
      "slopweaver talk offer was killed by SIGTERM before it answered",
      "fetch failed (the console server did not answer; reading again)",
      "queue answered in a shape this tile does not read",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }))).toEqual([
      { plain: "It did not answer in time.", raw: reasons[0] },
      { plain: "It was stopped before it answered.", raw: reasons[1] },
      {
        plain: "The console's own server gave no answer this page could read.",
        raw: reasons[2],
      },
      { plain: "It answered in a form this page cannot read.", raw: reasons[3] },
    ]);
  });

  it("reads only the console's own not-JSON sentences as an unreadable answer, never a provider's", () => {
    const own = [
      "slopweaver connect slack --check printed something that is not JSON",
      "talk offer printed something that is not JSON, beginning `panic: boom`",
    ];
    const outside = [
      "Slack API response is not JSON: HTTP 502 Bad Gateway",
      "profile.json is not JSON",
      "the upstream printed something that is not JSON: HTTP 503",
    ];
    const bug = "It answered in a form this page cannot read.";

    expect([...own, ...outside].map((why) => plainReasonOf({ why }).plain)).toEqual([
      bug,
      bug,
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
    ]);
  });

  it("reads a stopped command only in the spawn reader's own grammar, its stderr tail allowed", () => {
    const reasons = [
      "slopweaver talk offer was killed by SIGKILL before it answered: out of memory",
      "slopweaver hand list ended with neither an exit code nor a signal",
      "the provider said it was killed by SIGTERM before it answered, then retried",
      "The worker was killed by SIGTERM before it answered",
      // A wait that ran out, in the reader's own grammar and quoted outside it.
      "slopweaver hand list did not answer within 30s",
      "The test expected: hand list did not answer within 30s",
      // Each transport line quoted after a `: `, and an exit envelope with half a pair of backticks.
      "The test expected: fetch failed (the console server did not answer; reading again)",
      "The test expected: queue answered in a shape this tile does not read",
      "The test expected: queue printed something that is not JSON",
      "`slopweaver github read exited 1: HTTP 401 Unauthorized",
      "slopweaver github read` exited 1: HTTP 401 Unauthorized",
      // Each transport line quoted with no colon, an exit 0, and a coded tail under a title naming no call.
      "The test expected fetch failed (the console server did not answer; reading again)",
      "The test expected queue answered in a shape this tile does not read",
      "The test expected queue printed something that is not JSON",
      "slopweaver hand list exited 0",
      "slopweaver docs check exited 1: HTTP 401 Unauthorized",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }).plain)).toEqual([
      "It was stopped before it answered.",
      "It stopped without saying how.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It did not answer in time.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "Its command stopped with a technical error.",
    ]);
  });

  it("strips only the spawn reader's own exit envelope, so an outside line that says `exited` settles nothing", () => {
    const reasons = [
      "Parser rejected documentation example because worker exited 1: HTTP 401 Unauthorized",
      "The provider said worker exited 1: HTTP 429 Too Many Requests",
      "Cleanup failed after helper exited 1: ENOSPC",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }).plain)).toEqual(
      reasons.map(() => "It failed with a technical error."),
    );
  });

  it("says a reset connection as cut off, never as a service it could not reach", () => {
    expect(plainReasonOf({ why: "read ECONNRESET" }).plain).toBe("A connection was cut off.");
  });

  it("reads a status only written as a status, so a number in passing is not a rate limit", () => {
    expect([
      plainReasonOf({ why: "slopweaver linear sync exited 1: HTTP 401 Unauthorized" }).plain,
      plainReasonOf({ why: 'slopweaver slack read exited 1: {"ok":false,"error":"missing_scope"}' }).plain,
      plainReasonOf({ why: "`slopweaver github read` exited 1: status 503" }).plain,
      plainReasonOf({ why: "pull request 429 is still open" }).plain,
    ]).toEqual([
      "The service turned down its sign-in.",
      "The service refused it permission.",
      "The service hit an error and could not answer.",
      "It failed with a technical error.",
    ]);
  });

  it("never guesses a cause from two statuses, a negated one or two classes, and never lifts an exception line", () => {
    const reasons = [
      "expected HTTP 401 but got HTTP 503",
      "the gateway said not a 403, status 500",
      "HTTP 429 after invalid_auth",
      "the response was not rate_limited",
      "token_expired? no, it wasn't token_expired",
      "No HTTP 401 was returned; the request timed out",
      "finished without a 403",
      "neither invalid_auth nor a timeout",
      "none of the replies was rate_limited",
      "ENOSPC: no space left on device, then it was not ENOSPC after all",
      "TypeError: Cannot read properties of undefined",
      "Error: something went wrong",
      '{ "error": "bad" }',
      '[ "a", "b" ]',
    ];

    expect(reasons.map((why) => plainReasonOf({ why }))).toEqual(
      reasons.map((why) => ({ plain: "It failed with a technical error.", raw: why })),
    );
  });

  it("never reads a lone code as the cause when another word in its clause may be the failure", () => {
    const reasons = [
      "Cleanup after HTTP 401 failed: EACCES writing cache",
      "HTTP 401 while cleaning up the cache",
      '{"message":"cache cleanup broke","error":"missing_scope"}',
      "retrying after rate_limited timed out",
      '{"message":"upstream unavailable","status":503}',
    ];

    expect(reasons.map((why) => plainReasonOf({ why }).plain)).toEqual(
      reasons.map(() => "It failed with a technical error."),
    );
  });

  it("counts a word in any script, so a reason in another language settles no cause", () => {
    const reasons = ["HTTP 401", "Ожидалось HTTP 401", "HTTP 401 — 期待されていた", "«Ожидалось» HTTP 401"];

    expect(reasons.map((why) => plainReasonOf({ why }).plain)).toEqual([
      "The service turned down its sign-in.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
    ]);
  });

  it("never settles a status beside another class's phrase, which names a second cause", () => {
    const reasons = [
      "Request failed with HTTP 401 Too Many Requests",
      "HTTP 429 Unauthorized",
      "HTTP 403 Bad Gateway",
      "HTTP 503 Forbidden",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }).plain)).toEqual(
      reasons.map(() => "It failed with a technical error."),
    );
  });

  it("never settles a code quoted as data under a link that names something other than the call", () => {
    const reasons = [
      "slopweaver docs check exited 1: Parser rejected documentation example: HTTP 401 Unauthorized",
      "Fixture loader skipped sample: invalid_auth",
      // A link that is only a locator names no call: a file or page can hold a status as data.
      "README.md: HTTP 401 Unauthorized",
      "/docs/example: HTTP 401 Unauthorized",
      "https://example.test/docs: HTTP 401 Unauthorized",
      "api.example.test: HTTP 401 Unauthorized",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }).plain)).toEqual([
      "Its command stopped with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
    ]);
  });

  it("never reads a code buried in an identifier, a path or a locator as the cause", () => {
    const reasons = [
      "ReferenceError: statusCode401",
      "Error: /tmp/invalid_auth",
      "GET /cache/HTTP401",
      // A code carried as a URL's query value is data the call sent, never its answer.
      "GET https://api.example.com/v1/x?error=invalid_auth",
      // The same value spaced off its `=`.
      "GET https://api.example.com/v1/x?error= invalid_auth",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }))).toEqual(
      reasons.map((why) => ({ plain: "It failed with a technical error.", raw: why })),
    );
  });

  it("keeps the raw message exactly as received, its surrounding whitespace included", () => {
    const reasons = [
      "  ETIMEDOUT\n",
      "\tTypeError: boom\n    at x (/repo/a.ts:1:1)\n",
      "slopweaver hand list exited 1\n",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }))).toEqual([
      { plain: "It timed out.", raw: "  ETIMEDOUT\n" },
      { plain: "It failed with a technical error.", raw: "\tTypeError: boom\n    at x (/repo/a.ts:1:1)\n" },
      { plain: "Its command stopped with an error and gave no reason.", raw: "slopweaver hand list exited 1\n" },
    ]);
  });

  it("reads a code that is the whole of its innermost clause, under a chain that only names the call", () => {
    expect([
      plainReasonOf({ why: "slack api error: invalid_auth" }).plain,
      plainReasonOf({ why: "Request failed with HTTP 401 Unauthorized" }).plain,
      plainReasonOf({ why: "GET https://api.example.com/v1/x: HTTP 429 Too Many Requests" }).plain,
      plainReasonOf({ why: "Error: HTTP 401\n    at refresh (/repo/src/auth.ts:3:1)" }).plain,
    ]).toEqual([
      "The service turned down its sign-in.",
      "The service turned down its sign-in.",
      "The service turned it away because too many requests came in at once.",
      "The service turned down its sign-in.",
    ]);
  });

  it("reads a network, timeout and disk errno by its code", () => {
    expect([
      plainReasonOf({ why: "getaddrinfo ENOTFOUND api.example.com" }).plain,
      plainReasonOf({ why: "connect ETIMEDOUT 10.0.0.1:443" }).plain,
      plainReasonOf({ why: "ENOSPC: no space left on device, write" }).plain,
    ]).toEqual(["It could not reach a service over the network.", "It timed out.", "It ran out of space."]);
  });

  // English is never a code: a missing token is said as stored-or-not, never re-said as a class it might
  // not be.
  it("says Slopweaver's own missing-token lines as such, and an exit with no words as giving no reason", () => {
    const forHome = "no Linear token for this home. Set LINEAR_API_KEY, or write <home>/secrets/linear-token";

    expect([
      plainReasonOf({ why: "slopweaver refresh exited 1: no linear token configured" }),
      plainReasonOf({ why: "no Slack token is configured — run `slopweaver connect slack`" }),
      plainReasonOf({ why: forHome }),
      plainReasonOf({ why: "no GitHub token is stored" }),
      plainReasonOf({ why: "slopweaver hand list exited 1" }),
      plainReasonOf({ why: "no GitHub token configured; run `slopweaver connect github`" }),
      plainReasonOf({ why: "no Slack token configured — `slopweaver secrets status` names the missing one" }),
    ]).toEqual([
      { plain: "No Linear token is stored.", raw: "slopweaver refresh exited 1: no linear token configured" },
      { plain: "No Slack token is stored.", raw: "no Slack token is configured — run `slopweaver connect slack`" },
      { plain: "No Linear token is stored.", raw: forHome },
      { plain: "No GitHub token is stored.", raw: "no GitHub token is stored" },
      { plain: "Its command stopped with an error and gave no reason.", raw: "slopweaver hand list exited 1" },
      { plain: "No GitHub token is stored.", raw: "no GitHub token configured; run `slopweaver connect github`" },
      {
        plain: "No Slack token is stored.",
        raw: "no Slack token configured — `slopweaver secrets status` names the missing one",
      },
    ]);
  });

  it("says an empty reason as a failure that gave no message, with nothing folded", () => {
    expect([plainReasonOf({ why: "" }), plainReasonOf({ why: " \n " })]).toEqual([
      { plain: "It failed without giving an error message.", raw: undefined },
      { plain: "It failed without giving an error message.", raw: undefined },
    ]);
  });

  it("never says a token another service left out as one not stored here", () => {
    expect(
      [
        "no refresh token",
        "slopweaver sync exited 1: no access token",
        "no linear token",
        "no Slack token the send could go out under: revoked",
        "no Slack token configured by the provider for this request",
        "no GitHub token configured; the app was uninstalled",
      ].map((why) => plainReasonOf({ why }).plain),
    ).toEqual([
      "It failed with a technical error.",
      "Its command stopped with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
      "It failed with a technical error.",
    ]);
  });

  it("takes a producer's hint only whole, so words after it settle nothing", () => {
    const reasons = [
      "no Slack token configured; run `slopweaver secrets status` was only the expected text, not the failure; HTTP 503 was returned",
      "no GitHub token configured; run `slopweaver connect github` then it got HTTP 500",
      "no Slack token configured; run `slopweaver connect github`",
      "no Linear token for this home. Set LINEAR_API_KEY, or write it somewhere",
    ];
    const notion = "no Notion token for this home. Set NOTION_TOKEN, or run `slopweaver connect notion`";

    expect([...reasons, notion].map((why) => plainReasonOf({ why }).plain)).toEqual([
      ...reasons.map(() => "It failed with a technical error."),
      "No Notion token is stored.",
    ]);
  });

  // A runtime's own message is an English sentence no pattern tells from a plain one, so no reason
  // of a shape this file does not know is ever said as itself, however plain it reads.
  it("never lifts a reason as itself: a plain-reading line and a classless runtime message both read as technical", () => {
    const reasons = [
      "the route timed out",
      "Cannot read properties of undefined",
      "Unexpected token '<', \"<!DOCTYPE \" is not valid JSON",
    ];
    const exited = [
      "slopweaver hand list exited 2: the handover board is locked by another session",
      "slopweaver board read exited 1: Cannot read properties of undefined (reading 'rows')",
    ];

    expect([...reasons, ...exited].map((why) => plainReasonOf({ why }))).toEqual([
      ...reasons.map((why) => ({ plain: "It failed with a technical error.", raw: why })),
      ...exited.map((why) => ({ plain: "Its command stopped with a technical error.", raw: why })),
    ]);
  });

  it("never lifts a stack frame, a JSON body or a long multi-line record: it says a technical error and folds it", () => {
    const trace = "TypeError: x is undefined\n    at readBoard (/repo/src/handover/board.ts:12:3)";
    const tail =
      "slopweaver board read exited 1: TypeError: x is undefined · at readBoard (/repo/src/board.ts:12:3) · at main";

    expect([plainReasonOf({ why: trace }), plainReasonOf({ why: tail })]).toEqual([
      { plain: "It failed with a technical error.", raw: trace },
      { plain: "Its command stopped with a technical error.", raw: tail },
    ]);
  });
});
