/**
 * JumpCloud's own decisions about walking its administrator console. The ENGINE's behaviour — accounting,
 * the lost-session stop, the duplicate-picture check — is `kit/pageWalk/`.
 *
 * What a reader would get wrong about JumpCloud specifically: the console is hash-routed, so a client that
 * sends an unknown route home still settles on the same origin and path, and a settle on the sign-in page
 * or the end-user portal ends the walk rather than costing one page.
 */
import { describe, expect, it } from "vitest";

import {
  JUMPCLOUD_ADMIN_TITLE,
  JUMPCLOUD_CONSOLE_ORIGIN,
  JUMPCLOUD_CONSOLE_PAGES,
} from "../../../../atlas/jumpcloud/browserPages.js";
import {
  JUMPCLOUD_PAGE_WALK_SPEC,
  jumpcloudPageOutcome,
  redactedConsoleAddress,
  walkJumpcloudConsole,
} from "../../../../atlas/jumpcloud/browserWalk.js";
import { JumpcloudConsoleWalkErrors } from "../../../../atlas/jumpcloud/errors.js";
import { isPageHeld } from "../../../../atlas/kit/pageWalk.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

import { renderedPng } from "../../../pngFixture.js";
import { capture, fakeTransport, recordingWriter } from "../../../walkTransportFake.js";

const USERS = `${JUMPCLOUD_CONSOLE_ORIGIN}/#/users`;
const PROBE = `${JUMPCLOUD_CONSOLE_ORIGIN}/#/home`;

/** A settled capture of the administrator console at `finalUrl`. */
function settled({ finalUrl, title = JUMPCLOUD_ADMIN_TITLE }: { finalUrl: string; title?: string }) {
  return capture({ over: { finalUrl, title }, url: USERS });
}

describe("jumpcloudPageOutcome", () => {
  it("holds a page the console kept, under the administrator title", () => {
    expect(jumpcloudPageOutcome({ capture: settled({ finalUrl: USERS }), requestedUrl: USERS })).toEqual({
      redirected: false,
      unreachableBecause: null,
    });
  });

  // The kit ignores the fragment, so this is the one rule that catches the client's catch-all.
  it("records a route the client sent home as a redirect", () => {
    expect(jumpcloudPageOutcome({ capture: settled({ finalUrl: PROBE }), requestedUrl: USERS }).redirected).toBe(true);
  });

  it("names the route the client sent it to", () => {
    expect(
      jumpcloudPageOutcome({ capture: settled({ finalUrl: PROBE }), requestedUrl: USERS }).unreachableBecause,
    ).toContain("#/home");
  });

  it("redacts an object id in a settled route rather than quoting it", () => {
    const outcome = jumpcloudPageOutcome({
      capture: settled({ finalUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/#/users/5f1e2d3c4b5a69788796a5b4/details` }),
      requestedUrl: USERS,
    });
    expect(outcome.unreachableBecause).toContain("#/users/{id}/details");
  });

  it("recognises the sign-in page before any other rule", () => {
    expect(
      jumpcloudPageOutcome({
        capture: settled({ finalUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/login/admin` }),
        requestedUrl: USERS,
      }).unreachableBecause,
    ).toContain("no longer signed in");
  });

  it("records a settle on another origin as a redirect", () => {
    expect(
      jumpcloudPageOutcome({ capture: settled({ finalUrl: "https://jumpcloud.com/" }), requestedUrl: USERS })
        .redirected,
    ).toBe(true);
  });

  it("refuses a page that kept its route but did not render the administrator console", () => {
    expect(
      jumpcloudPageOutcome({ capture: settled({ finalUrl: USERS, title: "JumpCloud" }), requestedUrl: USERS })
        .unreachableBecause,
    ).toContain(JUMPCLOUD_ADMIN_TITLE);
  });

  it("refuses an address it cannot read", () => {
    expect(jumpcloudPageOutcome({ capture: settled({ finalUrl: "::::" }), requestedUrl: USERS }).redirected).toBe(true);
  });
});

describe("redactedConsoleAddress", () => {
  it("stores a held page's address unchanged", () => {
    expect(redactedConsoleAddress({ finalUrl: USERS })).toBe(`${JUMPCLOUD_CONSOLE_ORIGIN}/#/users`);
  });

  it("redacts an object id in a settled route before it is stored", () => {
    expect(
      redactedConsoleAddress({ finalUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/#/users/5f1e2d3c4b5a69788796a5b4/details` }),
    ).toBe(`${JUMPCLOUD_CONSOLE_ORIGIN}/#/users/{id}/details`);
  });

  it("keeps a fragment parameter by name and drops its value", () => {
    expect(redactedConsoleAddress({ finalUrl: `${USERS}?tab=all&email=a%40example.com` })).toBe(
      `${JUMPCLOUD_CONSOLE_ORIGIN}/#/users?email={value}&tab={value}`,
    );
  });

  it("drops a query outside the fragment whole", () => {
    expect(redactedConsoleAddress({ finalUrl: "https://idp.example.com/sso?SAMLRequest=abc#/" })).toBe(
      "https://idp.example.com/sso#/",
    );
  });

  it("stores nothing for a page the walk never got to", () => {
    expect(redactedConsoleAddress({ finalUrl: "" })).toBe("");
  });

  it("says unreadable rather than quoting an address it cannot parse", () => {
    expect(redactedConsoleAddress({ finalUrl: "::::" })).toBe("unreadable");
  });
});

describe("JUMPCLOUD_PAGE_WALK_SPEC", () => {
  it("walks the declared inventory and nothing else", () => {
    expect(JUMPCLOUD_PAGE_WALK_SPEC.pages).toBe(JUMPCLOUD_CONSOLE_PAGES);
  });

  it("reads the end-user portal as the administrator session ending", () => {
    expect(
      JUMPCLOUD_PAGE_WALK_SPEC.sessionLostOn({
        capture: settled({ finalUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/userconsole#/` }),
      }),
    ).toBe(true);
  });

  it("reads an ordinary settle as the session continuing", () => {
    expect(JUMPCLOUD_PAGE_WALK_SPEC.sessionLostOn({ capture: settled({ finalUrl: USERS }) })).toBe(false);
  });

  it("photographs every page it reaches", () => {
    expect(
      JUMPCLOUD_CONSOLE_PAGES.filter((page) => JUMPCLOUD_PAGE_WALK_SPEC.photographPolicy({ page }) !== null),
    ).toEqual([]);
  });
});

describe("walkJumpcloudConsole", () => {
  /** A console that keeps every address, renders the admin title, and draws each page differently. */
  function signedIn(): ReturnType<typeof fakeTransport> {
    return fakeTransport({
      answer: ({ visitIndex }) => ({
        capture: { screenshotPng: renderedPng({ seed: visitIndex + 1 }), title: JUMPCLOUD_ADMIN_TITLE },
      }),
    });
  }

  it("probes the console home first", async () => {
    const fake = signedIn();
    await walkJumpcloudConsole({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.visited[0]).toBe(PROBE);
  });

  it("returns exactly one observation per declared page", async () => {
    const fake = signedIn();
    const walked = unwrap(
      await walkJumpcloudConsole({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.map((page) => page.surface)).toEqual(JUMPCLOUD_CONSOLE_PAGES.map((page) => page.surface));
  });

  it("holds every page of a console that kept every address", async () => {
    const fake = signedIn();
    const walked = unwrap(
      await walkJumpcloudConsole({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages.filter((page) => !isPageHeld({ page })).map((page) => page.surface)).toEqual([]);
  });

  it("refuses to start when the probe lands on the sign-in page", async () => {
    const fake = fakeTransport({
      visits: { [PROBE]: { capture: { finalUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/login/admin` } } },
    });
    const walked = await walkJumpcloudConsole({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([JumpcloudConsoleWalkErrors.signedOut().message]);
    expect(fake.visited).toEqual([PROBE]);
  });

  it("stops at a mid-walk sign-out and marks the rest not attempted", async () => {
    const fake = fakeTransport({
      answer: ({ visitIndex }) => ({
        capture:
          visitIndex < 3
            ? { screenshotPng: renderedPng({ seed: visitIndex + 1 }), title: JUMPCLOUD_ADMIN_TITLE }
            : { finalUrl: `${JUMPCLOUD_CONSOLE_ORIGIN}/login/admin` },
      }),
    });
    const walked = unwrap(
      await walkJumpcloudConsole({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.sessionLost).toBe(true);
    expect(walked.pages.filter((page) => !page.attempted)).toHaveLength(JUMPCLOUD_CONSOLE_PAGES.length - 3);
  });
});
