/**
 * `browser present`, the console voice taking the owner to a page: which page a destination or an address resolves to
 * on this install, the short answer it is handed, and the refusals the runner makes before the browser is touched.
 * Every Datadog host in this file reads a synthetic site rather than the install's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ForegroundCommand } from "../../../browser/foreground.js";
import {
  destinationUrl,
  landingHost,
  offSiteDatadogHost,
  PRESENT_DESTINATIONS,
  type PresentError,
  PresentErrors,
  type PresentTarget,
  pageStayedPut,
  presentAnswer,
  resolvePresentTarget,
  slackAppAnswer,
  slackDesktopHandoff,
  slackHandoffAnswer,
} from "../../../browser/present.js";
import type { DesktopPageSeam } from "../../../browser/presentDesktop.js";
import { type SlackWorkspace, slackAppCommand, slackMessageLink, slackWorkspaceOf } from "../../../browser/slackApp.js";
import { runPresent } from "../../../cli/commands/browser/presentRun.js";
import { type SlackAppSeam, slackAppOpening } from "../../../cli/commands/browser/presentSlackApp.js";
import { parseBrowserArgs } from "../../../cli/commands/browser/profileCore.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { slackLookupOnceClientOptions } from "../../../corpus/slack/workspaceLookupOnce.js";
import { datadogSiteRefusal } from "../../../datadog/siteGuard.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import type { PublishedAmong } from "../../../pages/published.js";
import { PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";
import { memoryRecordedProfilePort } from "../../recordedProfileFixture.js";

let home = "";

/** A Slack-app seam a refusal must never reach: both halves throw, so the refusal's exit code is the only way to pass. */
const neverRun: SlackAppSeam = {
  run: () => {
    throw new Error("the Slack app seam ran on a present that should have been refused first");
  },
  workspace: () => Promise.reject(new Error("the Slack workspace was read on a present that should have been refused")),
};

/** A desktop-page seam no Slack or refused present may reach: reading the installation throws. */
const noDesktop: DesktopPageSeam = {
  installation: () => {
    throw new Error("the desktop app was asked about on a present that is not a local page");
  },
  run: () => {
    throw new Error("the desktop app was opened on a present that is not a local page");
  },
};

/** A store that publishes no page. */
const noPages: PublishedAmong = async () => ok(new Set());

/** The workspace `auth.test` answered for the owner's read token. */
const ACME = { teamId: "T0SYN000001", workspaceUrl: "https://acme.slack.com/" };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "browser-present-"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { force: true, recursive: true });
});

describe("destinationUrl", () => {
  it("opens an install's own Datadog console — on a synthetic AP1 site, never the US1 host a doc example carries", () => {
    expect(unwrap(destinationUrl({ ddSite: "ap1.datadoghq.com", destination: "datadog" }))).toBe(
      "https://ap1.datadoghq.com/",
    );
  });

  it("reads the site through the same console-host map the site guard judges by", () => {
    expect(unwrap(destinationUrl({ ddSite: "datadoghq.com", destination: "datadog" }))).toBe(
      "https://app.datadoghq.com/",
    );
    expect(unwrap(destinationUrl({ ddSite: "datadoghq.eu", destination: "datadog" }))).toBe(
      "https://app.datadoghq.eu/",
    );
  });

  it("refuses Datadog with no DD_SITE rather than defaulting one", () => {
    const refused = unwrapErr(destinationUrl({ ddSite: undefined, destination: "datadog" }));
    expect(refused.code).toBe("DATADOG_SITE_UNKNOWN");
  });

  it("refuses Datadog on a site the map does not know", () => {
    const refused = unwrapErr(destinationUrl({ ddSite: "moon.datadoghq.com", destination: "datadog" }));
    expect(refused.code).toBe("DATADOG_SITE_UNKNOWN");
    expect(refused.message).toContain("moon.datadoghq.com");
  });

  it("opens Linear's root and the owner's GitHub pull requests with no per-install value", () => {
    expect(unwrap(destinationUrl({ ddSite: undefined, destination: "linear" }))).toBe("https://linear.app/");
    expect(unwrap(destinationUrl({ ddSite: undefined, destination: "github-pulls" }))).toBe("https://github.com/pulls");
  });

  it("resolves every destination it lists to a page the site guard allows on that site", () => {
    expect(PRESENT_DESTINATIONS.length).toBeGreaterThan(0);
    const env = { DD_SITE: "ap1.datadoghq.com" };
    const refused = PRESENT_DESTINATIONS.filter((destination) => {
      const url = unwrap(destinationUrl({ ddSite: env.DD_SITE, destination }));
      return datadogSiteRefusal({ command: "slopweaver browser present", env, url }) !== undefined;
    });
    expect(refused).toEqual([]);
  });
});

const CONSOLE = "http://localhost:3000";

/* One resolution against a console at {@link CONSOLE} where only `published` pages exist. */
function resolveWith({
  ddSite,
  request,
  published = [],
}: {
  ddSite: string | undefined;
  request: { destination: string | undefined; url: string | undefined; page?: string };
  published?: readonly string[];
}): Result<PresentTarget, PresentError> {
  return resolvePresentTarget({
    consoleBase: CONSOLE,
    ddSite,
    pagePublished: (slug) => published.includes(slug),
    request: { destination: request.destination, page: request.page, url: request.url },
  });
}

describe("resolvePresentTarget", () => {
  it("opens a published local page through the console, off the browser register", () => {
    expect(
      unwrap(
        resolveWith({
          ddSite: undefined,
          published: ["tobias-one-on-one-2-oct"],
          request: { destination: undefined, page: "tobias-one-on-one-2-oct", url: undefined },
        }),
      ),
    ).toEqual({
      deepLink: "slopweaver://open?path=%2Fapi%2Fpage%2Ftobias-one-on-one-2-oct%2Findex.html",
      path: "/api/page/tobias-one-on-one-2-oct/index.html",
      requestedAs: "page",
      url: "http://localhost:3000/api/page/tobias-one-on-one-2-oct/index.html",
    });
  });

  it("refuses a page that is not published, and a slug outside the page alphabet", () => {
    expect(
      unwrapErr(resolveWith({ ddSite: undefined, request: { destination: undefined, page: "gone", url: undefined } })),
    ).toEqual(PresentErrors.pageNotPublished({ page: "gone" }));
    expect(
      unwrapErr(
        resolveWith({
          ddSite: undefined,
          published: ["../etc"],
          request: { destination: undefined, page: "../etc", url: undefined },
        }),
      ),
    ).toEqual(PresentErrors.pageSlugInvalid({ page: "../etc" }));
  });

  it("refuses a page named beside a destination or an address", () => {
    expect(
      unwrapErr(
        resolveWith({
          ddSite: undefined,
          published: ["a"],
          request: { destination: undefined, page: "a", url: "https://linear.app/" },
        }),
      ),
    ).toEqual(PresentErrors.conflict());
    expect(
      unwrapErr(
        resolveWith({
          ddSite: undefined,
          published: ["a"],
          request: { destination: "linear", page: "a", url: undefined },
        }),
      ),
    ).toEqual(PresentErrors.conflict());
  });

  it("opens the console's Settings address as a desktop tab — the address a refused call named", () => {
    expect(
      unwrap(
        resolveWith({
          ddSite: undefined,
          request: { destination: undefined, url: "http://localhost:3000/queue#settings/appearance" },
        }),
      ),
    ).toEqual({
      deepLink: "slopweaver://open?path=%2Fqueue%23settings%2Fappearance",
      path: "/queue#settings/appearance",
      requestedAs: "console",
      url: "http://localhost:3000/queue#settings/appearance",
    });
  });

  it.each([
    ["http://localhost:3000/fleet", "/fleet"],
    ["http://localhost:3000/workstreams", "/workstreams"],
    ["http://127.0.0.1:3000/queue?open=ask%3Aa-row", "/queue?open=ask%3Aa-row"],
    ["http://[::1]:3000/pull-requests", "/pull-requests"],
  ])("opens %s, any loopback spelling on the console's port, as console path %s", (url, path) => {
    const target = unwrap(resolveWith({ ddSite: undefined, request: { destination: undefined, url } }));
    expect(target).toMatchObject({ path, requestedAs: "console" });
  });

  it("opens a published page's own document given as a url, and refuses an unpublished one", () => {
    const url = "http://localhost:3000/api/page/prep/index.html";
    expect(
      unwrap(resolveWith({ ddSite: undefined, published: ["prep"], request: { destination: undefined, url } }))
        .requestedAs,
    ).toBe("console");
    expect(unwrapErr(resolveWith({ ddSite: undefined, request: { destination: undefined, url } }))).toMatchObject({
      cause: "PAGE_NOT_PUBLISHED",
      code: "CONSOLE_PATH_REFUSED",
    });
  });

  it.each([
    ["http://localhost:3000/api/live/depth", "API_PATH"],
    ["http://localhost:3000/api/talk/turn", "API_PATH"],
    ["http://localhost:3000/api", "API_PATH"],
    ["http://localhost:3000/api%2Flive/depth", "API_PATH"],
    ["http://localhost:3000/API/live/depth", "API_PATH"],
    ["http://localhost:3000/api/page/prep/image.png", "API_PATH"],
    ["http://localhost:3000/api/page/pr%2Fep/index.html", "API_PATH"],
    ["http://localhost:3000/_next/image?url=%2Fapi%2Flive%2Fdepth%3Ffresh%3D1&w=640&q=75", "INTERNAL_PATH"],
    ["http://localhost:3000/%5Fnext/image?url=%2Fapi%2Flive%2Fdepth", "INTERNAL_PATH"],
    ["http://localhost:3000/__nextjs_original-stack-frame?file=x", "INTERNAL_PATH"],
    ["http://localhost:3000/view?src=/_next/image%3Furl%3D%252Fapi%252Flive%252Fdepth", "INTERNAL_PATH"],
    ["http://localhost:3000/api/page/prep/index.html?run=1", "API_PATH"],
    ["http://localhost:3000/api/page/prep/index.html#run", "API_PATH"],
    ["http://localhost:3000/api/page/prep/index.html?", "API_PATH"],
    ["http://localhost:3000/view?src=/api/page/prep/index.html%3Frun%3D1", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=/api/page/prep/index.html%23run", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=/api/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=%2Fapi%2Flive%2Fdepth", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=/api%252Flive/depth", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=/a&src=/api/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000/view//?src=/api/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000//view?src=/api/live/depth", "DESKTOP_PATH"],
    ["http://localhost:3000/view%2F%2F?src=/api/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=/.//api/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000//api/live/depth", "DESKTOP_PATH"],
    ["http://localhost:3000/x/..//api/live/depth", "DESKTOP_PATH"],
    ["http://localhost:3000/api//live/depth", "API_PATH"],
    ["http://localhost:3000/x%2F..%2Fapi/live/depth", "API_PATH"],
    ["http://localhost:3000/x%5C..%5Capi/live/depth", "API_PATH"],
    ["http://localhost:3000/x%2F%2E%2E%2Fapi/live/depth", "API_PATH"],
    ["http://localhost:3000/x%252F..%252Fapi/live/depth", "API_PATH"],
    ["http://localhost:3000/x%2F..%2Fview?src=/api/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000/view?src=/x%2F..%2Fapi/live/depth", "VIEW_API_PATH"],
    ["http://localhost:3000/queue%25", "MALFORMED_PATH"],
    ["http://localhost:3000/voice", "DESKTOP_PATH"],
    ["http://localhost:3000/%E0%A4%A", "MALFORMED_PATH"],
  ])("refuses %s, the console's API or a path the app drops (%s)", (url, cause) => {
    expect(
      unwrapErr(resolveWith({ ddSite: undefined, published: ["prep"], request: { destination: undefined, url } })),
    ).toMatchObject({ cause, code: "CONSOLE_PATH_REFUSED" });
  });

  it("lets the viewer frame a published page, never the API", () => {
    const url = "http://localhost:3000/view?src=/api/page/prep/index.html";
    expect(
      unwrap(resolveWith({ ddSite: undefined, published: ["prep"], request: { destination: undefined, url } }))
        .requestedAs,
    ).toBe("console");
  });

  it("holds a console address to the host-blind checks first, and another port to the register", () => {
    const refused = ({ url }: { url: string }): PresentError =>
      unwrapErr(resolveWith({ ddSite: undefined, request: { destination: undefined, url } }));
    expect(refused({ url: "http://user:pw@localhost:3000/queue" })).toMatchObject({ cause: "URL_CREDENTIALS" });
    expect(refused({ url: `http://localhost:3000/queue?q=${"x".repeat(2_100)}` })).toMatchObject({
      cause: "URL_TOO_LONG",
    });
    expect(refused({ url: "http://localhost:3001/queue" })).toMatchObject({
      cause: "HOST_UNREGISTERED",
      code: "URL_REFUSED",
    });
  });

  it("resolves a destination, case and spaces forgiven", () => {
    expect(
      unwrap(resolveWith({ ddSite: "ap1.datadoghq.com", request: { destination: " Datadog ", url: undefined } })),
    ).toEqual({ requestedAs: "datadog", url: "https://ap1.datadoghq.com/" });
  });

  it("keeps a registered deep link exactly", () => {
    const url = "https://github.com/lachiejames/slopweaver/pull/1";
    expect(unwrap(resolveWith({ ddSite: undefined, request: { destination: undefined, url } }))).toEqual({
      requestedAs: "url",
      url,
    });
  });

  it("refuses neither and both", () => {
    expect(unwrapErr(resolveWith({ ddSite: undefined, request: { destination: undefined, url: undefined } }))).toEqual(
      PresentErrors.missing(),
    );
    expect(
      unwrapErr(
        resolveWith({
          ddSite: undefined,
          request: { destination: "linear", url: "https://linear.app/" },
        }),
      ),
    ).toEqual(PresentErrors.conflict());
  });

  it("refuses a destination it does not list", () => {
    expect(unwrapErr(resolveWith({ ddSite: undefined, request: { destination: "grafana", url: undefined } }))).toEqual(
      PresentErrors.unknownDestination({ destination: "grafana" }),
    );
  });

  it("holds an address to inspect's rules: an unregistered host, a user-content host, credentials", () => {
    const refused = ({ url }: { url: string }): PresentError =>
      unwrapErr(resolveWith({ ddSite: undefined, request: { destination: undefined, url } }));
    expect(refused({ url: "https://attacker.example/" })).toMatchObject({
      cause: "HOST_UNREGISTERED",
      code: "URL_REFUSED",
    });
    expect(refused({ url: "https://someone.notion.site/page" })).toMatchObject({ cause: "HOST_USER_CONTENT" });
    expect(refused({ url: "https://raw.githubusercontent.com/o/r/main/x" })).toMatchObject({
      cause: "HOST_USER_CONTENT",
    });
    expect(refused({ url: "https://user:pw@github.com/" })).toMatchObject({ cause: "URL_CREDENTIALS" });
  });

  it("names itself, not inspect, in a refusal", () => {
    const refused = unwrapErr(
      resolveWith({
        ddSite: undefined,
        request: { destination: undefined, url: "https://attacker.example/" },
      }),
    );
    expect(refused.message).toContain("so present will not open it");
  });

  it("leaves a wrong-site Datadog address for the site guard, whose refusal names the right host", () => {
    const target = unwrap(
      resolveWith({
        ddSite: "ap1.datadoghq.com",
        request: { destination: undefined, url: "https://app.datadoghq.com/logs" },
      }),
    );
    const refusal = datadogSiteRefusal({
      command: "slopweaver browser present",
      env: { DD_SITE: "ap1.datadoghq.com" },
      url: target.url,
    })!;
    expect(refusal.split("\n")[0]).toContain("so the console is https://ap1.datadoghq.com");
  });
});

describe("landingHost", () => {
  it("names a landing by its host alone — never a redirect's token or its path", () => {
    expect(
      landingHost({
        url: "https://raw.githubusercontent.com/lachiejames/slopweaver/refs/heads/main/README.md?token=GHSATAAAAA#top",
      }),
    ).toBe("raw.githubusercontent.com");
    expect(landingHost({ url: "https://attacker.example/PAGE_OWN_SECRET?token=t" })).toBe("attacker.example");
  });

  it("never repeats an address that does not parse", () => {
    expect(landingHost({ url: "not a url?token=SECRET#frag" })).toBe("an address that does not parse");
  });
});

describe("offSiteDatadogHost", () => {
  const AP1 = "ap1.datadoghq.com";

  it("refuses a US1 org's custom console subdomain on an AP1 install — a counterexample", () => {
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://account-a.datadoghq.com/logs" })).toBe(
      "account-a.datadoghq.com is not this install's Datadog console — DD_SITE is ap1.datadoghq.com, so the console is https://ap1.datadoghq.com",
    );
  });

  it("judges a host written with a trailing root dot as that host", () => {
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://account-a.datadoghq.com./logs" })).toContain(
      "account-a.datadoghq.com is not this install's Datadog console",
    );
  });

  it("allows this install's console, a subdomain of it, and the docs", () => {
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://ap1.datadoghq.com/logs" })).toBe(undefined);
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://acme.ap1.datadoghq.com/" })).toBe(undefined);
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://docs.datadoghq.com/logs/" })).toBe(undefined);
  });

  it("leaves a host outside every Datadog domain alone", () => {
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://github.com/pulls" })).toBe(undefined);
    expect(offSiteDatadogHost({ ddSite: AP1, url: "https://notdatadoghq.com/" })).toBe(undefined);
  });

  it("refuses every Datadog host but the docs when DD_SITE is unset", () => {
    expect(offSiteDatadogHost({ ddSite: undefined, url: "https://ap1.datadoghq.com/" })).toContain(
      "ap1.datadoghq.com is a Datadog host, and this install's site cannot be checked",
    );
  });
});

describe("pageStayedPut", () => {
  const requested = "http://localhost:3000/api/page/prep/index.html";

  it("keeps a page that settled where it was opened, a fragment or query aside", () => {
    expect(pageStayedPut({ landed: `${requested}#agenda`, requested })).toBe(true);
    expect(pageStayedPut({ landed: `${requested}?v=2`, requested })).toBe(true);
  });

  it("refuses another page on the console, another port, and another host", () => {
    expect(pageStayedPut({ landed: "http://localhost:3000/api/page/other/index.html", requested })).toBe(false);
    expect(pageStayedPut({ landed: "http://localhost:3001/api/page/prep/index.html", requested })).toBe(false);
    expect(pageStayedPut({ landed: "https://attacker.example/api/page/prep/index.html", requested })).toBe(false);
  });

  it("refuses a landing that does not parse", () => {
    expect(pageStayedPut({ landed: "not a url", requested })).toBe(false);
  });
});

describe("presentAnswer", () => {
  it("hands back where it landed and a one-line title, and says the tab stays", () => {
    const answer = presentAnswer({
      requestedUrl: "https://ap1.datadoghq.com/",
      session: "s-1",
      title: "  Datadog\n  Home ",
      url: "https://ap1.datadoghq.com/apm/home",
    });
    expect(answer.title).toBe("Datadog Home");
    expect(answer.url).toBe("https://ap1.datadoghq.com/apm/home");
    expect(answer.session).toBe("s-1");
    expect(answer.opened).toBe(true);
    expect(answer.note).toContain("stays open for them");
  });

  it("cuts a long title to a line", () => {
    const answer = presentAnswer({ requestedUrl: "u", session: "s", title: "x".repeat(500), url: "u" });
    expect(answer.title).toBe(`${"x".repeat(200)}…`);
  });
});

describe("browser present, parsed and refused before the browser", () => {
  it("parses --destination beside the sub-verb", () => {
    const options = unwrap(parseBrowserArgs({ rest: ["present", "--destination", "datadog", "--json"] }));
    expect(options.subverb).toBe("present");
    expect(options.destination).toBe("datadog");
    expect(options.url).toBe(undefined);
  });

  it("parses --page as a slug for present", () => {
    const options = unwrap(parseBrowserArgs({ rest: ["present", "--page", "tobias-one-on-one-2-oct"] }));
    expect(options.page).toBe("tobias-one-on-one-2-oct");
    expect(options.destination).toBe(undefined);
  });

  /** `runPresent` over seams no refused present may reach and a store publishing nothing, bar the fields `over` names. */
  function presentOver(over: Partial<Parameters<typeof runPresent>[0]>): Promise<number> {
    return runPresent({
      desktopPage: noDesktop,
      destination: undefined,
      home,
      page: undefined,
      profiles: memoryRecordedProfilePort(),
      publishedAmong: noPages,
      slackApp: neverRun,
      url: undefined,
      ...over,
    });
  }

  it("refuses a page this home never published as a usage error, before touching the browser", async () => {
    expect(await presentOver({ page: "never-published" })).toBe(EXIT_USAGE);
  });

  it("fails as an error, never a usage refusal, when the store cannot say whether the page is published", async () => {
    const stopped: PublishedAmong = async () =>
      err(PublishedPagesReadErrors.unavailable({ cause: new Error("connect ECONNREFUSED"), doing: "connect" }));
    expect(await presentOver({ page: "standup-brief", publishedAmong: stopped })).toBe(EXIT_ERROR);
  });

  it("refuses an unknown destination as a usage error", async () => {
    expect(await presentOver({ destination: "grafana" })).toBe(EXIT_USAGE);
  });

  it("refuses a custom Datadog subdomain on another site before touching the browser", async () => {
    vi.stubEnv("DD_SITE", "ap1.datadoghq.com");
    expect(await presentOver({ url: "https://account-a.datadoghq.com/logs" })).toBe(EXIT_ERROR);
  });

  it("refuses a wrong-site Datadog address before touching the browser", async () => {
    vi.stubEnv("DD_SITE", "ap1.datadoghq.com");
    expect(await presentOver({ url: "https://app.datadoghq.com/logs" })).toBe(EXIT_ERROR);
  });

  it("opens a Slack message permalink in the Slack desktop app at the message, and never reaches the browser", async () => {
    const ran: ForegroundCommand[] = [];
    const slackApp: SlackAppSeam = {
      run: (command) => {
        ran.push(command);
        return "";
      },
      workspace: () => Promise.resolve(ACME),
    };
    const url = "https://acme.slack.com/archives/C0SYN000001/p1792585836729489";
    expect(await presentOver({ slackApp, url })).toBe(EXIT_OK);
    expect(ran).toEqual([
      { args: ["slack://channel?team=T0SYN000001&id=C0SYN000001&message=1792585836.729489"], file: "open" },
    ]);
  });
});

describe("slackAppOpening, each lane that falls back to the browser", () => {
  const permalink = "https://acme.slack.com/archives/C0SYN000001/p1792585836729489";

  /** A seam answering `workspace` (or rejecting), counting its reads and recording every command it was asked to run. */
  const recording = ({ workspace, fail }: { workspace: SlackWorkspace | undefined | "rejects"; fail: boolean }) => {
    const ran: ForegroundCommand[] = [];
    const reads: string[] = [];
    const slackApp: SlackAppSeam = {
      run: (command) => {
        ran.push(command);
        if (fail) {
          throw new Error("open: no application knows how to open slack://");
        }
        return "";
      },
      workspace: () => {
        reads.push("workspace");
        if (workspace === "rejects") {
          return Promise.reject(new Error("EACCES: the Slack token file could not be read"));
        }
        return Promise.resolve(workspace);
      },
    };
    return { ran, reads, slackApp };
  };

  it("opens the permalink in the app and answers it as opened", async () => {
    const { ran, slackApp } = recording({ fail: false, workspace: ACME });
    expect(await slackAppOpening({ slackApp, target: { requestedAs: "url", url: permalink } })).toEqual(
      slackAppAnswer({ requestedUrl: permalink }),
    );
    expect(ran.length).toBe(1);
  });

  it("falls back without running anything when the workspace lookup failed or timed out", async () => {
    const { ran, slackApp } = recording({ fail: false, workspace: undefined });
    expect(await slackAppOpening({ slackApp, target: { requestedAs: "url", url: permalink } })).toBe(undefined);
    expect(ran).toEqual([]);
  });

  it("falls back without running anything when the workspace read itself throws", async () => {
    const { ran, reads, slackApp } = recording({ fail: false, workspace: "rejects" });
    expect(await slackAppOpening({ slackApp, target: { requestedAs: "url", url: permalink } })).toBe(undefined);
    expect(reads).toEqual(["workspace"]);
    expect(ran).toEqual([]);
  });

  it("falls back without running anything for a permalink on another workspace", async () => {
    const { ran, slackApp } = recording({
      fail: false,
      workspace: { teamId: "T0SYNOTHER00", workspaceUrl: "https://another-org.slack.com/" },
    });
    expect(await slackAppOpening({ slackApp, target: { requestedAs: "url", url: permalink } })).toBe(undefined);
    expect(ran).toEqual([]);
  });

  it("falls back after exactly one attempt when open itself fails", async () => {
    const { ran, slackApp } = recording({ fail: true, workspace: ACME });
    expect(await slackAppOpening({ slackApp, target: { requestedAs: "url", url: permalink } })).toBe(undefined);
    expect(ran.length).toBe(1);
  });

  it.each([
    { requestedAs: "url", url: "https://github.com/lachiejames/slopweaver/pull/2567" },
    { requestedAs: "url", url: "https://acme.slack.com/archives/C0SYN000001" },
    { deepLink: "slopweaver://open?path=%2Fa", path: "/a", requestedAs: "page", url: permalink },
    { deepLink: "slopweaver://open?path=%2Fa", path: "/a", requestedAs: "console", url: permalink },
  ] as const)("never reads the workspace for $requestedAs $url", async (target) => {
    const { ran, reads, slackApp } = recording({ fail: false, workspace: ACME });
    expect(await slackAppOpening({ slackApp, target })).toBe(undefined);
    expect(reads).toEqual([]);
    expect(ran).toEqual([]);
  });
});

describe("slackLookupOnceClientOptions", () => {
  it("builds the lookup's client with no SDK retry, a thrown 429 and the request deadline", () => {
    expect(slackLookupOnceClientOptions({ timeoutMs: 4500 })).toEqual({
      rejectRateLimitedCalls: true,
      retryConfig: { retries: 0 },
      timeout: 4500,
    });
  });
});

const PERMALINK = "https://acme.slack.com/archives/C0SYN000001/p1789538696815769";
const HANDOFF_TITLE = "Redirecting... | Slack";

describe("slackDesktopHandoff", () => {
  it("reads the measured handoff — the permalink unchanged under Slack's redirect title — as opened", () => {
    expect(slackDesktopHandoff({ landed: PERMALINK, requested: PERMALINK, title: HANDOFF_TITLE })).toBe(true);
  });

  it("matches a reply permalink on origin and path, its thread_ts query and a fragment aside", () => {
    const requested =
      "https://acme.slack.com/archives/C0SYN000001/p1792627158631409?thread_ts=1789538696.815769&cid=C0SYN000001";
    const landed = "https://acme.slack.com/archives/C0SYN000001/p1792627158631409#x";
    expect(slackDesktopHandoff({ landed, requested, title: HANDOFF_TITLE })).toBe(true);
  });

  it("admits the one-glyph ellipsis spelling of the title", () => {
    expect(slackDesktopHandoff({ landed: PERMALINK, requested: PERMALINK, title: "Redirecting… | Slack" })).toBe(true);
  });

  const otherMessage = "https://acme.slack.com/archives/C0SYN000001/p1792377149883349";
  const otherWorkspace = "https://other.slack.com/archives/C0SYN000001/p1789538696815769";
  const plainHttp = "http://acme.slack.com/archives/C0SYN000001/p1789538696815769";
  const channelOnly = "https://acme.slack.com/archives/C0SYN000001";
  const lookalike = "https://evilslack.com/archives/C0SYN000001/p1789538696815769";
  const bareSlack = "https://slack.com/archives/C0SYN000001/p1789538696815769";
  const notSlack = "https://github.com/archives/C0SYN000001/p1789538696815769";
  it.each([
    ["a Slack title that is not the handoff", PERMALINK, PERMALINK, "general | Acme | Slack"],
    ["another failure on an untitled page", PERMALINK, PERMALINK, "(untitled)"],
    ["a different message landed", PERMALINK, otherMessage, HANDOFF_TITLE],
    ["a different workspace landed", PERMALINK, otherWorkspace, HANDOFF_TITLE],
    ["a plain-http request", plainHttp, plainHttp, HANDOFF_TITLE],
    ["a channel page, no message", channelOnly, channelOnly, HANDOFF_TITLE],
    ["a lookalike host", lookalike, lookalike, HANDOFF_TITLE],
    ["slack.com itself", bareSlack, bareSlack, HANDOFF_TITLE],
    ["a non-Slack page", notSlack, notSlack, HANDOFF_TITLE],
    ["an address that does not parse", "not a url", PERMALINK, HANDOFF_TITLE],
  ])("never reads %s as a handoff", (_why, requested, landed, title) => {
    expect(slackDesktopHandoff({ landed, requested, title })).toBe(false);
  });
});

describe("slackMessageLink", () => {
  it("admits a message permalink and a reply's thread_ts permalink", () => {
    const reply = "https://acme.slack.com/archives/C0SYN000001/p1792627158631409?thread_ts=1789538696.815769";
    expect([PERMALINK, reply].map((url) => slackMessageLink({ url }))).toEqual([true, true]);
  });

  it("admits one trailing slash and a fragment", () => {
    const urls = [`${PERMALINK}/`, `${PERMALINK}#reply`];
    expect(urls.map((url) => slackMessageLink({ url }))).toEqual([true, true]);
  });

  it.each([
    ["a channel page", "https://acme.slack.com/archives/C0SYN000001"],
    ["plain http", "http://acme.slack.com/archives/C0SYN000001/p1789538696815769"],
    ["slack.com itself", "https://slack.com/archives/C0SYN000001/p1789538696815769"],
    ["a lookalike host", "https://evilslack.com/archives/C0SYN000001/p1789538696815769"],
    ["a non-Slack page", "https://github.com/archives/C0SYN000001/p1789538696815769"],
    ["an address that does not parse", "not a url"],
    ["a 15-digit message id", "https://acme.slack.com/archives/C0SYN000001/p178953869681576"],
    ["a 17-digit message id", "https://acme.slack.com/archives/C0SYN000001/p17895386968157690"],
    ["a lowercase channel id", "https://acme.slack.com/archives/c0syn000001/p1789538696815769"],
  ])("refuses %s", (_why, url) => {
    expect(slackMessageLink({ url })).toBe(false);
  });
});

describe("slackAppCommand", () => {
  it("builds Slack's channel deep link at the message, as argv, never a shell line", () => {
    expect(slackAppCommand({ url: PERMALINK, ...ACME })).toEqual({
      args: ["slack://channel?team=T0SYN000001&id=C0SYN000001&message=1789538696.815769"],
      file: "open",
    });
  });

  it("names the thread's root message for a reply permalink, off its thread_ts query", () => {
    const reply =
      "https://acme.slack.com/archives/C0SYN000001/p1792622697867469?thread_ts=1792585836.729489&cid=C0SYN000001";
    expect(slackAppCommand({ url: reply, ...ACME })).toEqual({
      args: ["slack://channel?team=T0SYN000001&id=C0SYN000001&message=1792585836.729489"],
      file: "open",
    });
  });

  it.each([
    ["is not a Slack ts", "root"],
    ["is the message itself", "1792622697.867469"],
    ["is later than the message, so cannot be its root", "1792622697.867470"],
  ])("names the permalink's own message when its thread_ts %s", (_why, threadTs) => {
    const url = `https://acme.slack.com/archives/C0SYN000001/p1792622697867469?thread_ts=${threadTs}`;
    expect(slackAppCommand({ url, ...ACME })).toEqual({
      args: ["slack://channel?team=T0SYN000001&id=C0SYN000001&message=1792622697.867469"],
      file: "open",
    });
  });

  it.each([
    ["a permalink on another workspace", { url: "https://other.slack.com/archives/C0SYN000001/p1789538696815769" }],
    ["a channel page", { url: "https://acme.slack.com/archives/C0SYN000001" }],
    ["a team id that is not one", { teamId: "acme" }],
    ["a workspace url that does not parse", { workspaceUrl: "not a url" }],
    ["a permalink on a non-default port", { url: "https://acme.slack.com:444/archives/C0SYN000001/p1789538696815769" }],
    ["a workspace url on another origin", { workspaceUrl: "https://acme.slack.com:444/" }],
  ])("builds nothing for %s", (_why, over) => {
    expect(slackAppCommand({ url: PERMALINK, ...ACME, ...over })).toBe(undefined);
  });
});

describe("slackWorkspaceOf", () => {
  it("reads the team id and workspace url off an auth.test body", () => {
    const body = { ok: true, team: "acme", team_id: "T0SYN000001", url: "https://acme.slack.com/" };
    expect(slackWorkspaceOf({ body })).toEqual(ACME);
  });

  it.each([
    ["no body", undefined],
    ["a body that is not an object", "ok"],
    ["no team id", { url: "https://acme.slack.com/" }],
    ["an empty team id", { team_id: "", url: "https://acme.slack.com/" }],
    ["no workspace url", { team_id: "T0SYN000001" }],
    ["a workspace url that is not a string", { team_id: "T0SYN000001", url: 7 }],
  ])("names no workspace for %s", (_why, body) => {
    expect(slackWorkspaceOf({ body })).toBe(undefined);
  });
});

describe("slackAppAnswer", () => {
  it("says it opened in the desktop app and that no browser tab was made", () => {
    expect(slackAppAnswer({ requestedUrl: PERMALINK })).toEqual({
      note:
        "The Slack permalink was handed straight to the owner's Slack desktop app; no browser tab was opened, and nothing was " +
        "clicked or typed.",
      opened: true,
      openedIn: "slack-desktop-app",
      requestedUrl: PERMALINK,
    });
  });
});

describe("slackHandoffAnswer", () => {
  it("says the desktop app opened it, never that a browser tab stays open, and carries the close in fixed words", () => {
    expect(slackHandoffAnswer({ cleanup: ["the tab it opened was closed again"], requestedUrl: PERMALINK })).toEqual({
      note:
        "Slack handed this message to the owner's Slack desktop app, where it opens in front of them; nothing in it was clicked " +
        "or typed. The browser's handoff tab: the tab it opened was closed again.",
      opened: true,
      openedIn: "slack-desktop-app",
      requestedUrl: PERMALINK,
    });
  });
});
