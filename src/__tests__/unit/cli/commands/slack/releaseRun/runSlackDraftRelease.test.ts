import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { readSlackSendFailures } from "../../../../../../admit/slackSendFailureStore.js";
import {
  SlackLifecycleErrors,
  slackLifecycleErrorLines,
} from "../../../../../../cli/commands/slack/lifecycleErrors.js";
import { runSlackDraftRelease } from "../../../../../../cli/commands/slack/releaseRun.js";
import type { SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import {
  heldReleaseTarget,
  journalUnresolvedRelease,
  UNPREPARED_SEND_ERROR,
} from "../../../../../../cli/commands/slack/sendFailureJournalling.js";
import { dripConfigFromProfile } from "../../../../../../cli/commands/slack/wiring.js";
import { EXIT_ERROR, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { ok, unwrap } from "../../../../../../lib/result.js";
import type { SlackDraftEvent } from "../../../../../../outbound/slack/draftRegister.js";
import { heldRow, logOf, NO_BOT, releaseOf } from "./fixtures.js";

describe("runSlackDraftRelease — a CORRUPT profile", () => {
  it("refuses before the row is resolved, so Slack is never asked the conversation's kind", async () => {
    const corrupt = mkdtempSync(join(tmpdir(), "release-corrupt-"));
    try {
      writeFileSync(join(corrupt, "profile.json"), "{", "utf8");
      const touched: string[] = [];
      // Only the config read and the local register exist: the surface read and every send seam throw if reached.
      const row = heldRow();
      const deps = new Proxy(
        { dripConfig: () => dripConfigFromProfile({ home: corrupt }), readDraftLog: () => logOf({ row }) },
        {
          get: (target, property) => {
            touched.push(String(property));
            return property in target
              ? (target as unknown as Record<string, unknown>)[property as string]
              : () => {
                  throw new Error(`corrupt-profile release touched dependency \`${String(property)}\``);
                };
          },
        },
      ) as unknown as SlackWriteDeps;
      const code = await runSlackDraftRelease({
        deps,
        options: { ...releaseOf({ approve: row.digest }), home: corrupt },
        token: "xoxp-test",
      });
      // A corrupt profile is a fact about the install, not a bad invocation, so it exits 1 rather than 2.
      expect(code).toBe(EXIT_ERROR);
      // The held row is read first, as the thread a release that sends nothing is journalled against; Slack never.
      expect(touched).toEqual(["readDraftLog", "dripConfig"]);
      expect(
        unwrap(readSlackSendFailures({ home: corrupt })).map(({ channel, threadTs }) => ({ channel, threadTs })),
      ).toEqual([{ channel: "D1", threadTs: null }]);
    } finally {
      rmSync(corrupt, { force: true, recursive: true });
    }
  });
});

describe("runSlackDraftRelease — a release that sends nothing", () => {
  it("journals a refusal while re-preparing against the draft's own conversation, as the fixed sentence", async () => {
    const home = mkdtempSync(join(tmpdir(), "release-journal-"));
    try {
      const row = heldRow();
      const known = {
        ...NO_BOT,
        conversationSurface: async () => "direct-message" as const,
        doorEnv: () => ({}),
        dripConfig: () => dripConfigFromProfile({ home }),
        readDraftLog: () => logOf({ row }),
        readDraftMedia: () => ok([]),
      };
      // The row's form is not a drip, so re-preparation refuses it; any other dependency reached would throw instead.
      const deps = new Proxy(known, {
        get: (target, property) =>
          property in target
            ? (target as unknown as Record<string, unknown>)[property as string]
            : () => {
                throw new Error(`re-preparation reached \`${String(property)}\``);
              },
      }) as unknown as SlackWriteDeps;
      const code = await runSlackDraftRelease({
        deps,
        options: { ...releaseOf({ approve: row.digest }), home },
        token: "xoxp-test",
      });
      expect(code).toBe(EXIT_USAGE);
      expect(
        unwrap(readSlackSendFailures({ home })).map(({ channel, error, threadTs }) => ({ channel, error, threadTs })),
      ).toEqual([{ channel: "D1", error: UNPREPARED_SEND_ERROR, threadTs: null }]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("journals a refusal after the held row is read, before its options are built", async () => {
    const home = mkdtempSync(join(tmpdir(), "release-journal-"));
    try {
      const row = heldRow();
      const deps = { ...NO_BOT, readDraftLog: () => logOf({ row }) } as unknown as SlackWriteDeps;
      const approve = "not-the-digest";
      const code = await runSlackDraftRelease({
        deps: { ...deps, dripConfig: () => dripConfigFromProfile({ home }) },
        options: { ...releaseOf({ approve }), home },
        token: "xoxp-test",
      });
      const refusal = SlackLifecycleErrors.draftApprovalMismatch({ approve, digest: row.digest, draftId: row.id });
      expect(code).toBe(EXIT_USAGE);
      expect(
        unwrap(readSlackSendFailures({ home })).map(({ channel, error, threadTs }) => ({ channel, error, threadTs })),
      ).toEqual([{ channel: "D1", error: slackLifecycleErrorLines({ error: refusal }).join(" "), threadTs: null }]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("journals a release refused before it is run, such as for a missing token, only while its row is held", () => {
    const home = mkdtempSync(join(tmpdir(), "release-journal-"));
    try {
      const row = heldRow();
      const deps = { readDraftLog: () => logOf({ row }) };
      const errors = ["no Slack user token"];
      const held = { ...releaseOf({ approve: row.digest }), home };
      journalUnresolvedRelease({ errors, options: held, target: heldReleaseTarget({ deps, options: held }) });
      const unknown = {
        ...releaseOf({ approve: row.digest }),
        home,
        release: { approve: row.digest, draftId: "sd-gone" },
      };
      expect(heldReleaseTarget({ deps, options: unknown })).toBe(undefined);
      journalUnresolvedRelease({ errors, options: unknown, target: heldReleaseTarget({ deps, options: unknown }) });
      expect(
        unwrap(readSlackSendFailures({ home })).map(({ channel, error, threadTs }) => ({ channel, error, threadTs })),
      ).toEqual([{ channel: "D1", error: "no Slack user token", threadTs: null }]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("journals a throw against the row read when the release started, though the row was dropped meanwhile", async () => {
    const home = mkdtempSync(join(tmpdir(), "release-journal-"));
    try {
      const row = heldRow();
      let dropped = false;
      const held: SlackDraftEvent[] = [];
      const deps = {
        ...NO_BOT,
        appendDraftEvent: ({ event }: { event: SlackDraftEvent }) => {
          held.push(event);
          return ok(true as const);
        },
        conversationSurface: async () => {
          dropped = true;
          throw new Error("the surface read failed");
        },
        dripConfig: () => dripConfigFromProfile({ home }),
        readDraftLog: () => (dropped ? [] : logOf({ row })),
        readDraftMedia: () => ok([]),
      } as unknown as SlackWriteDeps;
      await expect(
        runSlackDraftRelease({ deps, options: { ...releaseOf({ approve: row.digest }), home }, token: "xoxp-test" }),
      ).rejects.toThrow("the surface read failed");
      expect(
        unwrap(readSlackSendFailures({ home })).map(({ channel, error, threadTs }) => ({ channel, error, threadTs })),
      ).toEqual([
        {
          channel: "D1",
          error: "the release stopped on an error before sending: the surface read failed",
          threadTs: null,
        },
      ]);
      // Slack threw on a row held when the release started, so the owner's Queue card says why.
      expect(held.map(({ id, kind }) => [id, kind])).toEqual([[row.id, "held"]]);
      expect(held[0]).toEqual(expect.objectContaining({ reason: "slack-refused" }));
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("journals a row dropped right after its first read, which is when the release started, as refused", async () => {
    const home = mkdtempSync(join(tmpdir(), "release-journal-"));
    try {
      const row = heldRow();
      let dropped = false;
      const deps = {
        ...NO_BOT,
        dripConfig: () => {
          dropped = true;
          return dripConfigFromProfile({ home });
        },
        readDraftLog: () => (dropped ? [] : logOf({ row })),
        readDraftMedia: () => ok([]),
      } as unknown as SlackWriteDeps;
      const code = await runSlackDraftRelease({
        deps,
        options: { ...releaseOf({ approve: row.digest }), home },
        token: "xoxp-test",
      });
      expect(code).toBe(EXIT_USAGE);
      expect(unwrap(readSlackSendFailures({ home })).map(({ channel, threadTs }) => ({ channel, threadTs }))).toEqual([
        { channel: "D1", threadTs: null },
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("journals a throw in a gate before the send, then lets it propagate", async () => {
    const home = mkdtempSync(join(tmpdir(), "release-journal-"));
    try {
      const row = heldRow();
      const known = {
        ...NO_BOT,
        conversationSurface: async () => "direct-message" as const,
        doorEnv: () => ({}),
        dripConfig: () => dripConfigFromProfile({ home }),
        readDraftLog: () => logOf({ row }),
        readDraftMedia: () => ok([]),
        whoAmI: async () => ({ userId: "U1" }),
      };
      // Thanks-instead re-reads the thread first; that read is no known dependency, so it throws.
      const deps = new Proxy(known, {
        get: (target, property) =>
          property in target
            ? (target as unknown as Record<string, unknown>)[property as string]
            : () => {
                throw new Error("the thread read failed");
              },
      }) as unknown as SlackWriteDeps;
      await expect(
        runSlackDraftRelease({
          deps,
          options: { ...releaseOf({ approve: row.digest }), home, thanksInstead: "Thanks for the review" },
          token: "xoxp-test",
        }),
      ).rejects.toThrow("the thread read failed");
      expect(
        unwrap(readSlackSendFailures({ home })).map(({ channel, error, threadTs }) => ({ channel, error, threadTs })),
      ).toEqual([
        {
          channel: "D1",
          error: "the release stopped on an error before sending: the thread read failed",
          threadTs: null,
        },
      ]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });
});
