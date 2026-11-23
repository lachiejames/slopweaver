/**
 * `admit/botLiveWriteGuardRunner.ts` — the hook a bot turn meets before a migration or a live write runs. The
 * rule: the bot never runs a migration and never acts on staging or prod unless the owner explicitly
 * asked; another person's request never opens it. Each case runs the real runner over a real temp home.
 */
import { chmodSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { botLiveWriteRefusal, runBotLiveWriteGuard } from "../../../admit/botLiveWriteGuardRunner.js";
import { askLifecyclePath } from "../../../live/ask/store.js";
import { dispatchAsk, ENGINEER, freshHome, OWNER, removeHomes, WORKER_SESSION } from "./botTurnFixture.js";

const dirs: string[] = [];

afterEach(() => {
  removeHomes({ dirs });
});

const RERUN = "yarn prisma migrate deploy";

/** Run the guard over one payload, collecting what it printed. */
const runGuard = async ({
  home,
  command,
  tool = "Bash",
  sessionId = WORKER_SESSION,
  hatch = false,
}: {
  home: string;
  command: string;
  tool?: string;
  sessionId?: string;
  hatch?: boolean;
}): Promise<{ readonly code: number; readonly text: string }> => {
  const lines: string[] = [];
  const env = hatch ? { SLOPWEAVER_ALLOW_BOT_LIVE_WRITE: "1", SLOPWEAVER_HOME: home } : { SLOPWEAVER_HOME: home };
  const payload = JSON.stringify({ session_id: sessionId, tool_input: { command }, tool_name: tool });
  const code = await runBotLiveWriteGuard({
    env,
    readStdin: () => Promise.resolve(payload),
    writeError: (line) => {
      lines.push(line);
    },
  });
  return { code, text: lines.join("") };
};

describe("runBotLiveWriteGuard — a colleague's ask", () => {
  it("holds a production migration rerun with no hatch, and names the safe lane instead", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000001.000100" });

    const { code, text } = await runGuard({ command: RERUN, home });

    expect(code).toBe(2);
    expect(text).toContain("held because a bot turn never runs or reruns a migration");
    expect(text).toContain(`this turn was asked by <@${ENGINEER}>, not the owner`);
    expect(text).toContain("Instead: post the diagnosis");
    expect(text).not.toContain("SLOPWEAVER_ALLOW_BOT_LIVE_WRITE");
  });

  it("keeps holding when the hatch variable is set, because only the owner's own ask opens it", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000002.000100" });

    expect((await runGuard({ command: RERUN, hatch: true, home })).code).toBe(2);
    expect((await runGuard({ command: `SLOPWEAVER_ALLOW_BOT_LIVE_WRITE=1 ${RERUN}`, home })).code).toBe(2);
  });

  it("holds a staging write from a Monitor too, since a Monitor runs a shell line", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000003.000100" });

    const { code, text } = await runGuard({
      command: "kubectl -n staging rollout restart deploy/api",
      home,
      tool: "Monitor",
    });

    expect(code).toBe(2);
    expect(text).toContain("writes to a live system — kubectl");
  });

  it("holds when the ask log is there but unreadable, rather than reading it as no bot turn", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000005.000100" });
    const log = askLifecyclePath({ home });
    chmodSync(log, 0o000);

    const held = await runGuard({ command: RERUN, home });
    const read = await runGuard({ command: "yarn prisma migrate status", home });
    chmodSync(log, 0o600);

    expect(held.code).toBe(2);
    expect(held.text).toContain(`${log} exists but cannot be read`);
    expect(held.text).toContain("This hold has no escape hatch: make that state readable");
    expect(read.code).toBe(0);
  });

  it("lets a read through: the investigation is the job", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000004.000100" });

    expect((await runGuard({ command: "yarn prisma migrate status", home })).code).toBe(0);
    expect((await runGuard({ command: "kubectl -n production logs deploy/api --tail 200", home })).code).toBe(0);
  });
});

describe("runBotLiveWriteGuard — the owner's own ask", () => {
  it("refuses without the hatch, and names the hatch the owner's own ask may open", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: OWNER, home, messageTs: "1791000005.000100" });

    const { code, text } = await runGuard({ command: RERUN, home });

    expect(code).toBe(2);
    expect(text).toContain("SLOPWEAVER_ALLOW_BOT_LIVE_WRITE=1");
    expect(text).toContain("Instead: post the diagnosis");
  });

  it("allows the run once the hatch is set, either ambient or inline", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: OWNER, home, messageTs: "1791000006.000100" });

    expect((await runGuard({ command: RERUN, hatch: true, home })).code).toBe(0);
    expect((await runGuard({ command: `SLOPWEAVER_ALLOW_BOT_LIVE_WRITE=1 ${RERUN}`, home })).code).toBe(0);
  });

  it("holds when a colleague's ask rides in the same session as the owner's", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: OWNER, home, messageTs: "1791000007.000100" });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000008.000100" });

    const { code, text } = await runGuard({ command: RERUN, hatch: true, home });

    expect(code).toBe(2);
    expect(text).toContain(`asked by <@${ENGINEER}>, not the owner`);
  });

  it("holds when the profile names no owner, since whether the owner asked cannot be checked", async () => {
    const home = freshHome({ dirs, ownerUserId: null });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: OWNER, home, messageTs: "1791000009.000100" });

    const { code, text } = await runGuard({ command: RERUN, hatch: true, home });

    expect(code).toBe(2);
    expect(text).toContain("the profile names no owner");
  });
});

describe("runBotLiveWriteGuard — not a bot turn", () => {
  it("says nothing to a session that is not the dispatched worker, so the owner's own seats keep working", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000010.000100" });

    const { code, text } = await runGuard({ command: RERUN, home, sessionId: "a-fleet-seat" });

    expect(code).toBe(0);
    expect(text).toBe("");
  });

  it("releases a malformed payload and a tool that runs no shell line", async () => {
    const home = freshHome({ dirs, ownerUserId: OWNER });
    dispatchAsk({ announcedAs: WORKER_SESSION, asker: ENGINEER, home, messageTs: "1791000011.000100" });
    const lines: string[] = [];

    const malformed = await runBotLiveWriteGuard({
      env: { SLOPWEAVER_HOME: home },
      readStdin: () => Promise.resolve("{not json"),
      writeError: (line) => {
        lines.push(line);
      },
    });

    expect(malformed).toBe(0);
    expect((await runGuard({ command: RERUN, home, tool: "Artifact" })).code).toBe(0);
    expect(lines).toStrictEqual([]);
  });
});

describe("botLiveWriteRefusal", () => {
  it("clips a long segment so the refusal stays readable", () => {
    const segment = `psql "$DATABASE_URL" -c "${"UPDATE users SET plan = 'x' WHERE id = 1; ".repeat(10)}"`;
    const text = botLiveWriteRefusal({
      asks: [{ askerUserId: ENGINEER, channel: "C0SYNDEPLOYS01", messageTs: "1791000012.000100", text: undefined }],
      finding: { kind: "live-write", operation: "UPDATE", segment, tool: "psql" },
      ownerUserId: OWNER,
    });

    expect(text).toContain(`\`${segment.slice(0, 120)}\` writes to a live system — psql UPDATE`);
    expect(text).not.toContain(segment);
  });
});
