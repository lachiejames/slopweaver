import { describe, expect, it } from "vitest";
import type { DoorDecision } from "../../../../../admit/types.js";
import type { GithubAttachDeps } from "../../../../../cli/commands/github/attachDeps.js";
import { runGithubAttach } from "../../../../../cli/commands/github/attachRun.js";
import { runGithubAttachStatus } from "../../../../../cli/commands/github/attachStatusRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { err } from "../../../../../lib/result.js";
import { GithubAttachErrors } from "../../../../../outbound/github/attach.errors.js";
import type { AttachResponse } from "../../../../../outbound/github/attachClient.js";
import { recordedCassette } from "../../../../attachEvidenceFixture.js";
import { ANONYMOUS_PAGE, attachRunHarness, HAPPY, RECEIPT_ID, SIGNED_IN_PAGE } from "../../../../attachRunFixture.js";
import { unreachableDoorLedger } from "../../../../doorLedgerFixture.js";
import { expectedHoldRefusal } from "../../../../profileHoldFixture.js";

const { fixtureFile, makeDeps } = attachRunHarness();

describe("runGithubAttach — usage", () => {
  it("prints usage and exits EXIT_USAGE with no sub-verb", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    expect(await runGithubAttach({ deps, rest: [] })).toBe(EXIT_USAGE);
    expect(captured.diagnostics[0]).toContain("a sub-verb is required");
  });

  it("performs no I/O on the reject path", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    await runGithubAttach({ deps, rest: ["upload", "--nope"] });
    expect(captured.out).toEqual([]);
  });
});

describe("runGithubAttach — upload", () => {
  const argvFor = ({ path }: { path: string }): readonly string[] => [
    "upload",
    "--file",
    path,
    "--repo",
    "slopweaver/slopweaver",
    "--number",
    "485",
    "--proves",
    "the unit suite passes",
  ];

  it("uploads and prints the permanent URL plus the image markdown", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_OK);
    expect(captured.out[1]).toBe("https://github.com/user-attachments/assets/uuid-1");
    expect(captured.out[2]).toBe("![shot.png](https://github.com/user-attachments/assets/uuid-1)");
    expect(captured.out[3]).toBe(
      `upload receipt ${RECEIPT_ID} — fetched back from GitHub and byte-identical to what was checked`,
    );
  });

  it("records the write in the door ledger as an admitted external write", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { deps, door } = makeDeps({ filePath: path, replies: HAPPY });
    await runGithubAttach({ deps, rest: argvFor({ path }) });
    const recorded = door.records();
    expect(recorded.length).toBe(1);
    expect(recorded[0]!["action"]).toBe("verb:github.attach");
    expect(recorded[0]!["effect"]).toBe("external-write");
    expect(recorded[0]!["status"]).toBe("pass");
  });

  it("keeps the file path and the credential kind OUT of the ledger line", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { deps, door } = makeDeps({ filePath: path, replies: HAPPY });
    await runGithubAttach({ deps, rest: argvFor({ path }) });
    const line = door.text().trim();
    expect(line.length).toBeGreaterThan(0);
    expect(line.includes("web-session")).toBe(false);
    expect(line.includes(path)).toBe(false);
  });

  it("writes no ledger line at all when the door was never reached", async () => {
    const path = fixtureFile({ bytes: 10485761, name: "big.png" });
    const { deps, door } = makeDeps({ filePath: path, replies: [] });
    await runGithubAttach({ deps, rest: argvFor({ path }) });
    expect(door.store.rows).toStrictEqual([]);
  });

  it("uploads nothing, and says the decision was not recorded, when the door ledger's store is down", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    const code = await runGithubAttach({
      deps: { ...deps, doorLedger: unreachableDoorLedger() },
      rest: argvFor({ path }),
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.out).toEqual([]);
    expect(captured.diagnostics.at(-1)).toContain("slopweaver github attach upload not performed:");
  });

  it("holds a recording proof cassette wrote on its verb, even acknowledged, uploading nothing", async () => {
    const path = fixtureFile({ bytes: 4, name: "demo.mp4" });
    const { captured, deps, door } = makeDeps({ filePath: path, picture: recordedCassette(), replies: HAPPY });
    const rest = [...argvFor({ path }), "--acknowledge", "the console has no screen for this change"];
    expect(await runGithubAttach({ deps, rest })).toBe(EXIT_ERROR);
    expect(captured.out).toEqual([]);
    expect(captured.diagnostics.some((line) => line.includes("`proof cassette` can show figures"))).toBe(true);
    expect(door.text()).toContain('"status":"hold"');
  });

  it("uses --alt in the image markdown", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    await runGithubAttach({ deps, rest: [...argvFor({ path }), "--alt", "before and after"] });
    expect(captured.out[2]).toBe("![before and after](https://github.com/user-attachments/assets/uuid-1)");
  });

  it("emits one machine-readable document under --json", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    await runGithubAttach({ deps, rest: [...argvFor({ path }), "--json"] });
    const parsed: Record<string, unknown> = JSON.parse(captured.out[0]!);
    expect(parsed["outcome"]).toBe("uploaded");
    expect(parsed["markdown"]).toBe("![shot.png](https://github.com/user-attachments/assets/uuid-1)");
  });

  it("refuses an over-size image locally, sending nothing", async () => {
    const path = fixtureFile({ bytes: 10485761, name: "big.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("exceeds GitHub's measured ceiling");
    expect(captured.out).toEqual([]);
  });

  it("passes a recorded video at a size that would refuse an image, then holds it on its verb", async () => {
    const path = fixtureFile({ bytes: 10485761, name: "demo.mp4" });
    const { captured, deps } = makeDeps({ filePath: path, picture: recordedCassette(), replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.some((line) => line.includes("exceeds GitHub's measured ceiling"))).toBe(false);
    expect(captured.diagnostics.some((line) => line.includes("`proof cassette` can show figures"))).toBe(true);
  });

  it("refuses an unsupported media type before touching the session", async () => {
    const path = fixtureFile({ bytes: 4, name: "notes.pdf" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("not a media type GitHub's comment box accepts");
  });

  it("reports a missing local file rather than throwing", async () => {
    const { captured, deps } = makeDeps({ filePath: "/nowhere/shot.png", replies: [] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path: "/nowhere/shot.png" }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("could not read /nowhere/shot.png");
  });

  it("reports an expired session distinctly from a page with no upload region", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [ANONYMOUS_PAGE] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("GitHub answered your browser's cookies as an anonymous visitor");
  });

  it("carries GitHub's own refusal text out to the caller", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const refusal = JSON.stringify({ errors: [{ field: "size", message: "This video is too big." }] });
    const { captured, deps } = makeDeps({
      filePath: path,
      replies: [
        { status: 200, text: () => Promise.resolve(SIGNED_IN_PAGE) },
        { status: 422, text: () => Promise.resolve(refusal) },
      ],
    });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("This video is too big.");
  });
});

describe("runGithubAttach — dry run", () => {
  it("prints the plan and sends nothing, with no session needed", async () => {
    const path = fixtureFile({ bytes: 913213, name: "shot.png" });
    const { captured, deps } = makeDeps({
      filePath: path,
      replies: [],
      sessionCookies: err(GithubAttachErrors.webSessionMissing({ path: "state-home/github-web-session.json" })),
    });
    const code = await runGithubAttach({
      deps,
      rest: ["upload", "--file", path, "--repo", "o/r", "--number", "7", "--proves", "it passes", "--dry-run"],
    });
    expect(code).toBe(EXIT_OK);
    expect(captured.out[0]).toBe("attach upload is permitted by the owner's ruling on a-row (talk:p1)");
    expect(captured.out[1]).toBe("would upload shot.png (image/png, 913213 of 10485760 bytes allowed)");
    expect(captured.out[2]).toBe(
      "token would be scraped from https://github.com/o/r/pull/7?overview=false, else " +
        "https://github.com/o/r/releases/new; the upload attributed to https://github.com/o/r/pull/7",
    );
    expect(captured.out.length).toBe(3);
  });

  it("still refuses an over-size file on the dry-run path", async () => {
    const path = fixtureFile({ bytes: 10485761, name: "big.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [] });
    const code = await runGithubAttach({
      deps,
      rest: ["upload", "--file", path, "--repo", "o/r", "--number", "7", "--proves", "it passes", "--dry-run"],
    });
    expect(code).toBe(EXIT_ERROR);
    expect(captured.diagnostics[0]).toContain("exceeds GitHub's measured ceiling");
  });
});

describe("runGithubAttach — status and login", () => {
  it("reports a saved session without claiming its cookies are still live", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    expect(await runGithubAttach({ deps, rest: ["status"] })).toBe(EXIT_OK);
    expect(captured.out[0]).toBe("your Chrome profile Default is signed in to github.com as octocat");
    expect(captured.out[2]).toBe(
      "reading the jar is not liveness, and it says NOTHING about a SAML org grant — pass --org <slug> to ask GitHub",
    );
  });

  it("states when the session expires, so nobody has to remember the SSO policy", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    await runGithubAttach({ deps, rest: ["status"] });
    expect(captured.out[1]).toBe("its auth cookies expire 2026-09-07T00:00:00.000Z");
  });

  it("says GitHub owns the schedule when the auth cookies carry no expiry", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    const scoped: GithubAttachDeps = {
      ...deps,
      status: () =>
        Promise.resolve({
          detail: undefined,
          expiresAtIso: undefined,
          login: "octocat",
          present: true,
          sessionScoped: true,
          source: "your Chrome profile Default",
          usable: true,
        }),
    };
    await runGithubAttach({ deps: scoped, rest: ["status"] });
    expect(captured.out[1]).toContain("GitHub ends the session on its own schedule");
  });

  it("exits non-zero when no usable session exists", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { deps } = makeDeps({ filePath: path });
    const absent: GithubAttachDeps = {
      ...deps,
      status: () =>
        Promise.resolve({
          detail: "your Chrome holds no usable github.com session",
          expiresAtIso: undefined,
          login: undefined,
          present: false,
          sessionScoped: false,
          source: "your Chrome profile Default",
          usable: false,
        }),
    };
    expect(await runGithubAttach({ deps: absent, rest: ["status"] })).toBe(EXIT_ERROR);
  });
});

/**
 * The owner's rule as behaviour: a lapsed session is never grounds to ship less. Because nothing here can open
 * a window, the rule is honoured by REFUSING loudly and publishing the block where the owner reads it — never by substituting weaker output. Every case asserts the
 * DELIVERABLE, because the failure being fixed was output that read fine and shipped less.
 */
describe("runGithubAttach — a signed-out browser refuses loudly rather than degrading", () => {
  const argvFor = ({ path }: { path: string }): readonly string[] => [
    "upload",
    "--file",
    path,
    "--repo",
    "owner/name",
    "--number",
    "7",
    "--proves",
    "the unit suite passes",
  ];

  it("names the fleet's press first, then the owner's own browser, not just the condition", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [ANONYMOUS_PAGE] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toBe(
      "GitHub answered your browser's cookies as an anonymous visitor and nothing was uploaded — press it with " +
        "`slopweaver browser sign-in --provider github`, or sign in to github.com in your own Chrome if that look " +
        "finds the step yours, then run this upload again",
    );
    expect(captured.out).toEqual([]);
  });

  it("publishes needs-owner-login, which is the only trace a blocked upload leaves anywhere the owner reads", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [ANONYMOUS_PAGE] });
    await runGithubAttach({ deps, rest: argvFor({ path }) });
    expect(captured.events.map((event) => `${event.source}/${event.kind}`)).toEqual([
      "github-attach/needs-owner-login",
    ]);
    expect(captured.events[0]!.why).toContain("only signing in yourself unblocks it");
  });

  it("refuses a jar that could not be read at all, not only one that GitHub rejected", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({
      filePath: path,
      sessionCookies: err(GithubAttachErrors.webSessionMissing({ path: "no Chrome profile has been recorded" })),
    });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("no Chrome profile has been recorded for this machine yet");
  });

  it("refuses a jar that holds no usable github.com session", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({
      filePath: path,
      sessionCookies: err(GithubAttachErrors.webSessionUnreadable({ detail: "no user_session", path: "Default" })),
    });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("your Chrome holds no usable github.com session");
  });

  it("says nothing about signing in over a failure signing in would not fix", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const missingPage: AttachResponse = { status: 404, text: () => Promise.resolve("") };
    const { captured, deps } = makeDeps({ filePath: path, replies: [missingPage] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.events).toEqual([]);
  });

  it("names the ORG's own sign-on over a SAML wall, never a plain sign-in that would change nothing", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const wall: AttachResponse = {
      status: 200,
      text: () =>
        Promise.resolve(
          '<meta name="user-login" content="octocat">Single sign-on to continue<form action="/orgs/x/sso"',
        ),
    };
    const { captured, deps } = makeDeps({ filePath: path, replies: [wall] });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain(
      "press the organisation's single sign-on prompt with `slopweaver browser",
    );
    expect(captured.events[0]!.kind).toBe("needs-owner-login");
  });

  it("changes nothing about an upload that works", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: HAPPY });
    expect(await runGithubAttach({ deps, rest: argvFor({ path }) })).toBe(EXIT_OK);
    expect(captured.events).toEqual([]);
  });
});

describe("runGithubAttach — status publishes the clearing event", () => {
  it("publishes login-captured so an outstanding needs-owner-login can resolve", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    expect(await runGithubAttach({ deps, rest: ["status"] })).toBe(EXIT_OK);
    expect(captured.events.length).toBe(1);
    expect(captured.events[0]!.kind).toBe("login-captured");
    expect(captured.events[0]!.why).toBe("your own Chrome is signed in to github.com as octocat — uploads work again");
  });

  it("publishes nothing when the browser holds no usable session, so a stale alert is not cleared", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, login: undefined, usable: false });
    expect(await runGithubAttach({ deps, rest: ["status"] })).toBe(EXIT_ERROR);
    expect(captured.events).toEqual([]);
  });
});

/** An organisation page fetched by a session that organisation has authorised. */
const GRANTED_ORG: AttachResponse = {
  status: 200,
  text: () => Promise.resolve('<meta name="user-login" content="octocat"><h1>Acme</h1>'),
};

/** The wall: signed in, and carrying the sign-on interstitial instead of the organisation. */
const WALLED_ORG: AttachResponse = {
  status: 200,
  text: () =>
    Promise.resolve('<meta name="user-login" content="octocat"><a href="/orgs/acme/sso/sign_in">Continue</a>'),
};

describe("runGithubAttach — status --org", () => {
  it("asks GitHub and exits OK when the organisation has authorised the session", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [GRANTED_ORG] });
    expect(await runGithubAttach({ deps, rest: ["status", "--org", "acme"] })).toBe(EXIT_OK);
    expect(captured.out.at(-1)).toBe(
      "GitHub confirms this session is SAML-authorised for acme — an upload there will not hit the wall",
    );
  });

  it("exits NON-ZERO on a wall, which is the entire point of the flag", async () => {
    // The false green this replaced: the same session, with no --org, parses fine and reports success while
    // every upload to that organisation is refused.
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [WALLED_ORG] });
    expect(await runGithubAttach({ deps, rest: ["status", "--org", "acme"] })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("signed in but NOT SAML-authorised for acme");
    expect(captured.diagnostics.at(-1)).toContain(
      "press its single sign-on prompt with `slopweaver browser sign-in --provider github --org acme`",
    );
  });

  it("still exits OK with no --org, and says what it did not check", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path });
    expect(await runGithubAttach({ deps, rest: ["status"] })).toBe(EXIT_OK);
    expect(captured.out.at(-1)).toContain("--org <slug> to ask GitHub");
  });

  it("reports a dead session as signed-out rather than as a wall", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [ANONYMOUS_PAGE] });
    expect(await runGithubAttach({ deps, rest: ["status", "--org", "acme"] })).toBe(EXIT_ERROR);
    expect(captured.diagnostics.at(-1)).toContain("anonymous visitor");
  });

  it("emits one JSON document carrying the verdict", async () => {
    const path = fixtureFile({ bytes: 4, name: "shot.png" });
    const { captured, deps } = makeDeps({ filePath: path, replies: [WALLED_ORG] });
    expect(await runGithubAttach({ deps, rest: ["status", "--org", "acme", "--json"] })).toBe(EXIT_ERROR);
    expect(JSON.parse(captured.out.join("\n"))).toEqual({ org: "acme", verdict: "walled" });
  });
});

describe("runGithubAttachStatus — the status sub-verb called directly", () => {
  it("reports an unusable session as the answer and sends no probe, even with an org named", async () => {
    const { captured, deps, home } = makeDeps({ replies: [], usable: false });
    expect(await runGithubAttachStatus({ deps, home, json: true, org: "acme" })).toBe(EXIT_ERROR);
    expect(JSON.parse(captured.out.join("\n"))).toEqual({
      detail: "your Chrome holds no usable github.com session",
      expiresAtIso: "2026-09-07T00:00:00.000Z",
      login: "octocat",
      present: false,
      sessionScoped: false,
      source: "your Chrome profile Default",
      usable: false,
    });
    expect(captured.events).toEqual([]);
  });
});

describe("GithubAttachErrors.doorRecordingRefused", () => {
  it("is a distinct code from a refused door, and says the upload was not performed", () => {
    const error = GithubAttachErrors.doorRecordingRefused({ message: "the store is down" });

    expect(error.code).toBe("DOOR_RECORDING_REFUSED");
    expect(error.message).toBe("slopweaver github attach upload not performed: the store is down");
  });
});

describe("GithubAttachErrors.doorRefused", () => {
  it("carries the door decision and prints its whole refusal, never the bare verdict", () => {
    const decision: DoorDecision = {
      findings: [{ code: "demo.hold", correction: "load the profile", severity: "hold", summary: "no profile" }],
      overridden: [],
      status: "hold",
    };
    const error = GithubAttachErrors.doorRefused({ decision });

    expect(error.code).toBe("DOOR_REFUSED");
    expect(error.decision).toBe(decision);
    expect(error.message.split("\n")).toEqual(
      expectedHoldRefusal({ command: "slopweaver github attach upload", decision }),
    );
  });
});
