/**
 * Measuring and writing the owner's voice register over a fake register: what each outcome writes, the order the steps run
 * in inside the one transaction, which step's refusal becomes which error, and that the connection is always closed.
 * The real store is proven by `subprocess/profile/profileVoiceMeasureContract.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { type OpenVoiceRegister, runVoiceMeasurement } from "../../../profile/voiceMeasureWrite.js";
import { StoreErrors } from "../../../store/errors.js";
import type { VoiceRegisterSteps } from "../../../store/profile/voiceRegisterTarget.js";
import { NO_PROTECTION } from "../../noProtection.js";

import { NOW, OWNER, removeVoiceHomes, voiceHome, voiceRow } from "./voiceMeasureFixture.js";

afterEach(() => {
  removeVoiceHomes();
});

/** A home holding one message of the owner's in a channel and one in a DM, so a measurement yields both cohorts. */
function measurableHome(): string {
  return voiceHome({
    files: {
      "a.jsonl": [
        voiceRow({ id: "1", text: "one two three" }),
        voiceRow({ channel: "D0SYNDMCH01", id: "2", text: "four words right here" }),
      ],
    },
    ownerId: OWNER,
  });
}

/** What the fake register saw, in order. */
interface Journal {
  readonly events: string[];
}

/**
 * A fake register: every step answers as told and is journalled; a body that throws is journalled as a rollback.
 *
 * @param steps the answers that differ from a register that takes everything
 * @param closeFails whether closing the connection rejects
 * @returns the opener to inject, and the journal it writes
 */
function fakeRegister({
  steps = {},
  closeFails = false,
}: {
  steps?: Partial<{
    owner: Result<boolean, string>;
    upsert: Result<true, string>;
    cache: Result<unknown, string>;
  }>;
  closeFails?: boolean;
}): { open: OpenVoiceRegister; journal: Journal } {
  const journal: Journal = { events: [] };
  const answers: { owner: Result<boolean, string>; upsert: Result<true, string>; cache: Result<unknown, string> } = {
    cache: ok("refreshed"),
    owner: ok(true),
    upsert: ok(true),
    ...steps,
  };
  const bound: VoiceRegisterSteps = {
    readOwnerPresent: async () => {
      journal.events.push("owner");
      return answers.owner;
    },
    refreshCache: async () => {
      journal.events.push("cache");
      return answers.cache;
    },
    upsertCohort: async ({ cohort }) => {
      journal.events.push(`upsert ${cohort.surface}/${cohort.cohort}`);
      return answers.upsert;
    },
  };
  const open: OpenVoiceRegister = async ({ nowIso }) => {
    journal.events.push(`open ${nowIso}`);
    return ok({
      close: async () => {
        journal.events.push("close");
        if (closeFails) {
          throw new Error("pool already ended");
        }
      },
      transact: async ({ body }) => {
        try {
          const value = await body(bound);
          journal.events.push("commit");
          return value;
        } catch (error) {
          journal.events.push("rollback");
          throw error;
        }
      },
    });
  };
  return { journal, open };
}

describe("runVoiceMeasurement", () => {
  it("writes every cohort, then rebuilds the cache, in one transaction, and closes", async () => {
    const { journal, open } = fakeRegister({});
    const outcome = unwrap(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(outcome.kind).toBe("written");
    expect(outcome).toMatchObject({ filesRead: 1, notRead: [] });
    expect(journal.events).toStrictEqual([
      `open ${NOW}`,
      "owner",
      "upsert slack/all-sent",
      "upsert slack-dm/aggregate",
      "cache",
      "commit",
      "close",
    ]);
  });

  it("reports a dry run without opening the register", async () => {
    const { journal, open } = fakeRegister({});
    const outcome = unwrap(
      await runVoiceMeasurement({
        dryRun: true,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(outcome.kind).toBe("dry-run");
    expect(outcome.measurement!.cohorts.map((cohort) => cohort.medianWords)).toEqual([3, 4]);
    expect(journal.events).toStrictEqual([]);
  });

  it("passes a skip through without opening the register", async () => {
    const { journal, open } = fakeRegister({});
    const outcome = unwrap(
      await runVoiceMeasurement({
        dryRun: false,
        home: voiceHome({}),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(outcome).toMatchObject({ kind: "skipped", reason: "owner-user-id-absent" });
    expect(journal.events).toStrictEqual([]);
  });

  it("passes a read failure through", async () => {
    const { open } = fakeRegister({});
    const dir = voiceHome({ files: { "a.jsonl": [`{"author":"${OWNER}",`] }, ownerId: OWNER });
    const failure = unwrapErr(
      await runVoiceMeasurement({
        dryRun: false,
        home: dir,
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(failure.code).toBe("VOICE_MEASURE_ROW_MALFORMED");
  });

  it("answers no-store when no store is selected and the caller can do without one", async () => {
    const missing = StoreErrors.urlMissing({ envVar: "STORE_URL_FIXTURE", secretName: "store-url-fixture" });
    const outcome = unwrap(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: async () => err(missing),
        protection: NO_PROTECTION,
        storeOptional: true,
      }),
    );
    expect(outcome).toMatchObject({ kind: "no-store", message: missing.message });
  });

  it("fails when no store is selected and the caller needs one", async () => {
    const missing = StoreErrors.urlMissing({ envVar: "STORE_URL_FIXTURE", secretName: "store-url-fixture" });
    const failure = unwrapErr(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: async () => err(missing),
        protection: NO_PROTECTION,
      }),
    );
    expect(failure.code).toBe("VOICE_MEASURE_STORE_FAILED");
    expect(failure.message).toBe(`the voice register could not be written: ${missing.message}`);
  });

  it("fails on any other refusal to open, even when the caller can do without a store", async () => {
    const remote = StoreErrors.urlRemote({ host: "db.acme.example" });
    const failure = unwrapErr(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: async () => err(remote),
        protection: NO_PROTECTION,
        storeOptional: true,
      }),
    );
    expect(failure.message).toBe(`the voice register could not be written: ${remote.message}`);
    expect(remote.message).toContain("names host db.acme.example");
  });

  it("skips, writing nothing, when no owner row exists yet", async () => {
    const { journal, open } = fakeRegister({ steps: { owner: ok(false) } });
    const outcome = unwrap(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(outcome).toMatchObject({ kind: "skipped", reason: "owner-row-absent" });
    expect(journal.events).toStrictEqual([`open ${NOW}`, "owner", "commit", "close"]);
  });

  it("rolls back and names the store when the owner row cannot be read", async () => {
    const { journal, open } = fakeRegister({ steps: { owner: err("connection reset") } });
    const failure = unwrapErr(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(failure.message).toBe("the voice register could not be written: connection reset");
    expect(journal.events).toStrictEqual([`open ${NOW}`, "owner", "rollback", "close"]);
  });

  it("rolls back at the first cohort the store refuses, never reaching the cache", async () => {
    const { journal, open } = fakeRegister({ steps: { upsert: err("check constraint") } });
    const failure = unwrapErr(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(failure.code).toBe("VOICE_MEASURE_STORE_FAILED");
    expect(journal.events).toStrictEqual([`open ${NOW}`, "owner", "upsert slack/all-sent", "rollback", "close"]);
  });

  it("rolls every cohort back when the cache cannot be rebuilt", async () => {
    const { journal, open } = fakeRegister({ steps: { cache: err("disk full") } });
    const failure = unwrapErr(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(failure.code).toBe("VOICE_MEASURE_CACHE_FAILED");
    expect(failure.message).toContain("could not be rebuilt (disk full), so no cohort was written");
    expect(journal.events.slice(-2)).toStrictEqual(["rollback", "close"]);
  });

  it("keeps a committed write a success when closing the connection fails", async () => {
    const { journal, open } = fakeRegister({ closeFails: true });
    const outcome = unwrap(
      await runVoiceMeasurement({
        dryRun: false,
        home: measurableHome(),
        nowIso: NOW,
        openRegister: open,
        protection: NO_PROTECTION,
      }),
    );
    expect(outcome.kind).toBe("written");
    expect(journal.events.slice(-2)).toStrictEqual(["commit", "close"]);
  });
});
