/**
 * The metered chair read, end to end over a throwaway `~/.claude` holding the metered chair's frozen transcript
 * slice, with a plain fake page fetcher serving the frozen telemetry — no network, no mock.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok } from "../../../lib/result.js";
import { TelemetryReadErrors } from "../../../reflect/errors.js";
import type { TelemetryPage, TelemetryPageFetcher } from "../../../reflect/telemetry.js";
import type { ChairRead } from "../../../supervisor/chairGate.js";
import { judgeChairMetered } from "../../../supervisor/chairMetered.js";
import { METERED_LOOKBACK_MAX_MS, METERED_MAX_PAGES, readChairMetered } from "../../../supervisor/chairMeteredRead.js";

/** The incident chair's session id. */
const SESSION = "a0000038-0000-4000-8000-000000000041";

/** The frozen telemetry, every event the chair made either side of the incident. */
const EVENTS = (
  JSON.parse(readFileSync(join(import.meta.dirname, "../../fixtures/claude/api-request-283-15.json"), "utf8")) as {
    data: unknown[];
  }
).data;

/** The moment the incident's last metered request had landed and its next prompt had not yet gone out. */
const NOW_MS = Date.parse("2026-09-17T13:45:00Z");

/** A resolved chair holding the incident session. */
const READ: ChairRead = {
  kind: "resolved",
  sessions: [{ pid: 222, sessionId: SESSION, verdict: { atIso: "", kind: "on-fable", model: "claude-fable-5-1" } }],
  directory: "/wt/fresh-supervisor-handoff-9283",
  location: { kind: "cmux", workspaceId: "WS-PINNED" },
};

/** A deadline that never passes. */
const NEVER = new Promise<"expired">(() => undefined);

/** What the fake fetcher was asked. */
type Asked = Parameters<TelemetryPageFetcher>[0];

/**
 * A fetcher answering from fixed pages, recording each input.
 *
 * @returns the fetcher and its record
 */
function fakeFetcher({ pages }: { pages: readonly TelemetryPage[] }): {
  fetchPage: TelemetryPageFetcher;
  asked: Asked[];
} {
  const asked: Asked[] = [];
  // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
  const fetchPage: TelemetryPageFetcher = async (input) => {
    asked.push(input);
    return ok(pages[asked.length - 1]!);
  };
  return { asked, fetchPage };
}

/** Only the events a real prompt-scoped query would have returned at {@link NOW_MS}. */
const EVENTS_BY_NOW = EVENTS.filter(
  (event) => Date.parse((event as { attributes: { timestamp: string } }).attributes.timestamp) <= NOW_MS,
);

let claudeHome = "";

beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "metered-"));
  mkdirSync(join(claudeHome, "projects", "chair"), { recursive: true });
  writeFileSync(
    join(claudeHome, "projects", "chair", `${SESSION}.jsonl`),
    readFileSync(join(import.meta.dirname, "../../fixtures/supervisor/chair-metered-a0000038.jsonl"), "utf8"),
  );
});

afterEach(() => {
  rmSync(claudeHome, { force: true, recursive: true });
});

describe("readChairMetered", () => {
  it("finds the incident chair metered now, asking only for its five newest prompts over their own window", async () => {
    const { asked, fetchPage } = fakeFetcher({ pages: [{ events: EVENTS_BY_NOW, nextCursor: null, status: "done" }] });

    const reading = await readChairMetered({
      claudeHome,
      expired: NEVER,
      fetchPage,
      nowMs: NOW_MS,
      read: READ,
    });

    expect(asked.length).toBe(1);
    expect(asked[0]!.query).toBe(
      "service:claude-code @event.name:api_request @prompt.id:(823354ff-92f4-4018-8c14-ae1a49435945 OR " +
        "fdad8584-c3ea-46bd-975d-6cfdaaf05cfc OR 97624c03-6b66-4aea-90ce-1b5822bd53a2 OR " +
        "5cb9b4ed-4ff6-4381-8a40-03acff6ec113 OR 2931f80b-d014-4768-8e30-82fe534b3c60)",
    );
    expect(asked[0]!.fromMs).toBe(Date.parse("2026-09-17T13:17:17.352Z"));
    expect(asked[0]!.toMs).toBe(NOW_MS);
    expect(reading).toMatchObject({
      kind: "measured",
      sessions: [
        {
          pid: 222,
          sessionId: SESSION,
          verdict: { firstIso: "2026-09-17T13:39:02.089Z", kind: "metered-now", requests: 4 },
        },
      ],
      truncated: false,
      unprojected: 0,
    });
    // The telemetry names no plan: which organisation a request stamps is `~/.claude.json`'s, not the seat's.
    expect(Object.keys((reading as { sessions: readonly object[] }).sessions[0]!).toSorted()).toStrictEqual([
      "pid",
      "sessionId",
      "verdict",
    ]);
  });

  it("counts an event that does not project as unprojected, and still judges the ones that do", async () => {
    const unprojectable = JSON.parse(JSON.stringify(EVENTS_BY_NOW[0]).replace(/"cost_usd":[^,}]*,?/, "")) as unknown;
    const { fetchPage } = fakeFetcher({
      pages: [{ events: [unprojectable, ...EVENTS_BY_NOW], nextCursor: null, status: "done" }],
    });

    const reading = await readChairMetered({ claudeHome, expired: NEVER, fetchPage, nowMs: NOW_MS, read: READ });

    expect(JSON.stringify(unprojectable)).not.toContain("cost_usd");
    expect(JSON.stringify(EVENTS_BY_NOW[0])).toContain("cost_usd");
    expect(reading).toMatchObject({
      kind: "measured",
      sessions: [{ sessionId: SESSION, verdict: { kind: "metered-now", requests: 4 } }],
      unprojected: 1,
    });
  });

  it("never reaches further back than the lookback cap, whatever the prompts say", async () => {
    const { asked, fetchPage } = fakeFetcher({ pages: [{ events: [], nextCursor: null, status: "done" }] });
    const later = NOW_MS + METERED_LOOKBACK_MAX_MS;

    await readChairMetered({ claudeHome, expired: NEVER, fetchPage, nowMs: later, read: READ });

    expect(asked[0]!.fromMs).toBe(NOW_MS);
  });

  it("follows the cursor, and calls the read truncated when the page cap stops it", async () => {
    const page: TelemetryPage = { events: [], nextCursor: "more", status: "done" };
    const { asked, fetchPage } = fakeFetcher({ pages: Array.from({ length: METERED_MAX_PAGES + 1 }, () => page) });

    const reading = await readChairMetered({
      claudeHome,
      expired: NEVER,
      fetchPage,
      nowMs: NOW_MS,
      read: READ,
    });

    expect(asked.map((input) => input.cursor)).toStrictEqual([null, "more", "more"]);
    expect(reading).toMatchObject({
      kind: "measured",
      sessions: [{ verdict: { kind: "no-telemetry" } }],
      truncated: true,
    });
  });

  it("judges what it already read when a LATER page comes back partial, marking the read truncated", async () => {
    const { asked, fetchPage } = fakeFetcher({
      pages: [
        { events: EVENTS_BY_NOW, nextCursor: "more", status: "done" },
        { events: [], nextCursor: null, status: "timeout" },
      ],
    });

    const reading = await readChairMetered({
      claudeHome,
      expired: NEVER,
      fetchPage,
      nowMs: NOW_MS,
      read: READ,
    });

    expect(asked.length).toBe(2);
    expect(reading).toMatchObject({
      kind: "measured",
      sessions: [{ verdict: { kind: "metered-now", requests: 4 } }],
      truncated: true,
    });
  });

  it("judges what it already read when a LATER page fails outright, marking the read truncated", async () => {
    const pages: ReturnType<TelemetryPageFetcher>[] = [
      Promise.resolve(ok({ events: EVENTS_BY_NOW, nextCursor: "more", status: "done" })),
      Promise.resolve(err(TelemetryReadErrors.queryFailed({ query: "q", reasons: ["aborted after 10s"] }))),
    ];
    const fetchPage: TelemetryPageFetcher = ({ cursor }) => pages[cursor === null ? 0 : 1]!;

    const reading = await readChairMetered({
      claudeHome,
      expired: NEVER,
      fetchPage,
      nowMs: NOW_MS,
      read: READ,
    });

    expect(reading).toMatchObject({
      kind: "measured",
      sessions: [{ verdict: { kind: "metered-now", requests: 4 } }],
      truncated: true,
    });
  });

  it("is unmeasured, carrying the error's message, when the query fails", async () => {
    const failure = TelemetryReadErrors.queryFailed({ query: "q", reasons: ["HTTP 503"] });
    // eslint-disable-next-line @typescript-eslint/require-await -- the seam's contract is async; this fake has nothing to await
    const fetchPage: TelemetryPageFetcher = async () => err(failure);

    expect(
      await readChairMetered({
        claudeHome,
        expired: NEVER,
        fetchPage,
        nowMs: NOW_MS,
        read: READ,
      }),
    ).toStrictEqual({
      kind: "unmeasured",
      why: "the telemetry query could not be believed: HTTP 503",
    });
  });

  it("is unmeasured when Datadog calls the page partial", async () => {
    const { fetchPage } = fakeFetcher({ pages: [{ events: EVENTS, nextCursor: null, status: "timeout" }] });

    expect(
      await readChairMetered({
        claudeHome,
        expired: NEVER,
        fetchPage,
        nowMs: NOW_MS,
        read: READ,
      }),
    ).toStrictEqual({
      kind: "unmeasured",
      why: 'Datadog answered status "timeout", so the page is partial and cannot be judged',
    });
  });

  it("asks nothing when no session has a transcript, and names the session instead", async () => {
    const { asked, fetchPage } = fakeFetcher({ pages: [] });
    const stranger: ChairRead = { ...READ, sessions: [{ ...READ.sessions[0]!, sessionId: "no-such-session" }] };

    const reading = await readChairMetered({
      claudeHome,
      expired: NEVER,
      fetchPage,
      nowMs: NOW_MS,
      read: stranger,
    });

    expect(asked).toStrictEqual([]);
    expect(reading).toStrictEqual({
      kind: "unmeasured",
      why: "no session in the pinned workspace named a prompt to ask the telemetry about",
    });
  });

  it("is unmeasured when the chair itself could not be read", async () => {
    const { fetchPage } = fakeFetcher({ pages: [] });

    expect(
      await readChairMetered({
        claudeHome,
        expired: NEVER,
        fetchPage,
        nowMs: NOW_MS,
        read: { cause: "no-chair", kind: "unresolved", why: "no pin" },
      }),
    ).toStrictEqual({ kind: "unmeasured", why: "the chair could not be read: no pin" });
  });
});

/** A device id in the shape Claude Code mints. */
const DEVICE = "3c722295fc702ce4700a6e0e31508923988ee6729364ee83902ea4abce55b296";

/**
 * The shape over the incident's own prompts: identified requests BEFORE the absence and none after, every event
 * stamped with this device. Everything the chair made after the absence's end is cut, so the read holds no identified request at
 * or after the absence began — exactly a five-prompt window straddling a restart.
 */
const STRADDLE = EVENTS_BY_NOW.filter(
  (event) =>
    Date.parse((event as { attributes: { timestamp: string } }).attributes.timestamp) <=
    Date.parse("2026-09-17T13:41:00Z"),
).map((event) => {
  const shaped = event as { attributes: { attributes: Record<string, unknown> } };
  return {
    ...shaped,
    attributes: { ...shaped.attributes, attributes: { ...shaped.attributes.attributes, user: { id: DEVICE } } },
  };
});

describe("readChairMetered's device baseline", () => {
  it("reads a device-wide absence as UNMEASURED, asking one identified event since the absence began", async () => {
    const { asked, fetchPage } = fakeFetcher({
      pages: [
        { events: STRADDLE, nextCursor: null, status: "done" },
        { events: [], nextCursor: null, status: "done" },
      ],
    });

    const reading = await readChairMetered({ claudeHome, expired: NEVER, fetchPage, nowMs: NOW_MS, read: READ });

    expect(STRADDLE.length).toBe(9);
    expect(asked.length).toBe(2);
    expect(asked[1]!).toStrictEqual({
      cursor: null,
      fromMs: Date.parse("2026-09-17T13:39:02.089Z"),
      limit: 1,
      query: `service:claude-code @event.name:api_request @organization.id:* @user.id:(${DEVICE})`,
      toMs: NOW_MS,
    });
    expect(reading).toMatchObject({ kind: "measured", sessions: [{ verdict: { kind: "unmeasured" } }] });
    expect(judgeChairMetered({ reading }).kind).toBe("clean");
  });

  it("still refuses when the device named an organisation after the absence began", async () => {
    const { fetchPage } = fakeFetcher({
      pages: [
        { events: STRADDLE, nextCursor: null, status: "done" },
        { events: [EVENTS[0]], nextCursor: null, status: "done" },
      ],
    });

    const reading = await readChairMetered({ claudeHome, expired: NEVER, fetchPage, nowMs: NOW_MS, read: READ });

    expect(reading).toMatchObject({ sessions: [{ verdict: { kind: "metered-now", requests: 4 } }] });
    expect(judgeChairMetered({ reading }).kind).toBe("refused");
  });

  it("reads an unreadable baseline as UNMEASURED, carrying why", async () => {
    const pages: ReturnType<TelemetryPageFetcher>[] = [
      Promise.resolve(ok({ events: STRADDLE, nextCursor: null, status: "done" })),
      Promise.resolve(err(TelemetryReadErrors.queryFailed({ query: "q", reasons: ["HTTP 503"] }))),
    ];
    const fetchPage: TelemetryPageFetcher = ({ limit }) => pages[limit === 1 ? 1 : 0]!;

    const reading = await readChairMetered({ claudeHome, expired: NEVER, fetchPage, nowMs: NOW_MS, read: READ });

    expect(reading).toMatchObject({
      sessions: [
        {
          verdict: {
            kind: "unmeasured",
            why:
              "its requests name no organisation and the device baseline could not be read " +
              "(the telemetry query could not be believed: HTTP 503)",
          },
        },
      ],
    });
  });
});

describe("readChairMetered's deadline", () => {
  it("still refuses off the page already read when the deadline passes with a later page in flight", async () => {
    let expire: (value: "expired") => void = () => undefined;
    const expired = new Promise<"expired">((resolve) => {
      expire = resolve;
    });
    const asked: Asked[] = [];
    const fetchPage: TelemetryPageFetcher = (input) => {
      asked.push(input);
      if (input.cursor === null) {
        return Promise.resolve(ok({ events: EVENTS_BY_NOW, nextCursor: "more", status: "done" }));
      }
      expire("expired");
      return new Promise(() => undefined);
    };

    const reading = await readChairMetered({
      claudeHome,
      expired,
      fetchPage,
      nowMs: NOW_MS,
      read: READ,
    });

    expect(asked.map((input) => input.cursor)).toStrictEqual([null, "more"]);
    expect(reading).toMatchObject({
      kind: "measured",
      sessions: [{ verdict: { kind: "metered-now", requests: 4 } }],
      truncated: true,
    });
    expect(judgeChairMetered({ reading }).kind).toBe("refused");
  });

  it("is unmeasured, naming the deadline, when the first page never arrives", async () => {
    const fetchPage: TelemetryPageFetcher = () => new Promise(() => undefined);

    expect(
      await readChairMetered({
        claudeHome,
        expired: Promise.resolve("expired"),
        fetchPage,
        nowMs: NOW_MS,
        read: READ,
      }),
    ).toStrictEqual({
      kind: "unmeasured",
      why: "Datadog did not answer within 15s, so the tick did not wait for it",
    });
  });

  it("starts no page once the deadline has passed", async () => {
    const { asked, fetchPage } = fakeFetcher({
      pages: [{ events: EVENTS_BY_NOW, nextCursor: "more", status: "done" }],
    });
    const expired = Promise.resolve("expired" as const);
    await expired;

    await readChairMetered({ claudeHome, expired, fetchPage, nowMs: NOW_MS, read: READ });

    expect(asked).toStrictEqual([]);
  });
});
