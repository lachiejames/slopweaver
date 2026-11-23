/**
 * The draft register's write lock: one verb's read, check and append runs inside it, a second verb waits and then
 * records nothing, and the lock is released however the work ends. The store half runs on a real temp home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { holdSlackDraftLock } from "../../../../../admit/slackDraftStore.js";
import { underRegisterLock } from "../../../../../cli/commands/slack/draftRegisterLock.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";

const homes: string[] = [];

/** A fresh state home, removed after the test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "draft-lock-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("holdSlackDraftLock", () => {
  it("refuses a second holder while the first holds it, and admits one once it is released", () => {
    const home = freshHome();
    const release = unwrap(holdSlackDraftLock({ home }));

    expect(unwrapErr(holdSlackDraftLock({ home, waitMs: 0 })).message).toContain("a live writer has held");
    release();
    const again = holdSlackDraftLock({ home, waitMs: 0 });
    expect(again.isOk()).toBe(true);
    unwrap(again)();
  });
});

describe("underRegisterLock", () => {
  it("runs the work between taking and releasing the lock", () => {
    const order: string[] = [];
    const deps = {
      lockRegister: () => {
        order.push("lock");
        return ok(() => {
          order.push("unlock");
        });
      },
    };

    const code = underRegisterLock({
      deps,
      home: "/h",
      run: () => {
        order.push("work");
        return EXIT_OK;
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(order).toEqual(["lock", "work", "unlock"]);
  });

  it("releases the lock when the work throws", () => {
    const order: string[] = [];
    const deps = { lockRegister: () => ok(() => order.push("unlock")) };

    expect(() =>
      underRegisterLock({
        deps,
        home: "/h",
        run: () => {
          throw new Error("disk gone");
        },
      }),
    ).toThrow("disk gone");
    expect(order).toEqual(["unlock"]);
  });

  it("runs nothing and exits non-zero when the lock is not taken", () => {
    const ran: string[] = [];
    const deps = {
      lockRegister: () => err(SlackDraftErrors.writeFailed({ cause: new Error("held"), path: "/h.lock" })),
    };

    const code = underRegisterLock({
      deps,
      home: "/h",
      run: () => {
        ran.push("work");
        return EXIT_OK;
      },
    });

    expect(code).toBe(EXIT_ERROR);
    expect(ran).toEqual([]);
  });
});
