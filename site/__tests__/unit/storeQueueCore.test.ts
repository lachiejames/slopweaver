/**
 * The console's restatement of the store's half of the Queue's change push: the channel, slugs and triggers pinned
 * against `src/`'s declaration, which store the console listens to, and what each listener event makes the broker do.
 */
import { describe, expect, it } from "vitest";

import {
  QUEUE_CHANGE_CHANNEL,
  QUEUE_CHANGE_TRIGGERS,
  QUEUE_STORE_SLUGS,
} from "../../../src/store/schema/queueChangeNotify";
import {
  missingStoreQueueTriggers,
  STORE_QUEUE_CHANNEL,
  STORE_QUEUE_SLUGS,
  STORE_QUEUE_TRIGGERS,
  selectStoreQueueUrl,
  storeEventEffect,
  storeQueueSlugOf,
} from "../../lib/storeQueueCore";

const LOCAL = "postgres://slopweaver:pw@127.0.0.1:5432/slopweaver";

describe("the restated store contract", () => {
  it("listens on the channel the store's triggers notify", () => {
    expect(STORE_QUEUE_CHANNEL).toBe(QUEUE_CHANGE_CHANNEL);
  });

  it("names the same store-kept registers as the store", () => {
    expect([...STORE_QUEUE_SLUGS]).toEqual([...QUEUE_STORE_SLUGS]);
  });

  it("requires exactly the triggers the store installs, by table and name, in order", () => {
    expect(QUEUE_CHANGE_TRIGGERS.length).toBeGreaterThan(0);
    expect(STORE_QUEUE_TRIGGERS).toEqual(QUEUE_CHANGE_TRIGGERS.map(({ table, name }) => ({ name, table })));
  });
});

describe("selectStoreQueueUrl", () => {
  it("takes the variable first, trimmed", () => {
    const selected = selectStoreQueueUrl({
      environmentValue: `  ${LOCAL}\n`,
      secretValue: "postgres://other@localhost/x",
    });
    expect(selected._unsafeUnwrap()).toBe(LOCAL);
  });

  it("falls to the secret when the variable is blank", () => {
    const selected = selectStoreQueueUrl({ environmentValue: "   ", secretValue: `${LOCAL}\n` });
    expect(selected._unsafeUnwrap()).toBe(LOCAL);
  });

  it("refuses when neither holds a connection string", () => {
    expect(selectStoreQueueUrl({ environmentValue: undefined, secretValue: undefined })._unsafeUnwrapErr().code).toBe(
      "STORE_URL_MISSING",
    );
    expect(selectStoreQueueUrl({ environmentValue: "", secretValue: " \n" })._unsafeUnwrapErr().code).toBe(
      "STORE_URL_MISSING",
    );
  });

  it("accepts every loopback host", () => {
    for (const url of ["postgres://u@localhost/x", "postgres://u@127.0.0.1/x", "postgres://u@[::1]:5432/x"]) {
      expect(selectStoreQueueUrl({ environmentValue: url, secretValue: undefined })._unsafeUnwrap()).toBe(url);
    }
  });

  it("refuses a store off this machine without naming the connection string", () => {
    const refused = selectStoreQueueUrl({
      environmentValue: "postgres://u:secret-pw@db.example.com/x",
      secretValue: undefined,
    })._unsafeUnwrapErr();
    expect(refused.code).toBe("STORE_URL_REMOTE");
    expect(refused.message).not.toContain("secret-pw");
    expect(refused.message).not.toContain("db.example.com");
  });

  it("refuses a string that is not a URL", () => {
    expect(selectStoreQueueUrl({ environmentValue: "not a url", secretValue: undefined })._unsafeUnwrapErr().code).toBe(
      "STORE_URL_REMOTE",
    );
  });
});

describe("missingStoreQueueTriggers", () => {
  it("is empty when every trigger is installed", () => {
    expect(missingStoreQueueTriggers({ installed: STORE_QUEUE_TRIGGERS })).toEqual([]);
  });

  it("names each absent trigger in declaration order", () => {
    const [first, second, ...rest] = STORE_QUEUE_TRIGGERS;
    expect(missingStoreQueueTriggers({ installed: rest })).toEqual([first.name, second.name]);
  });

  it("does not count a same-named trigger on another table", () => {
    const [first, ...rest] = STORE_QUEUE_TRIGGERS;
    expect(missingStoreQueueTriggers({ installed: [...rest, { name: first.name, table: "elsewhere" }] })).toEqual([
      first.name,
    ]);
  });
});

describe("storeQueueSlugOf", () => {
  it("reads a store-kept register's slug", () => {
    expect(storeQueueSlugOf({ payload: "workstreams" })).toBe("workstreams");
  });

  it("ignores a payload no trigger sends", () => {
    expect(storeQueueSlugOf({ payload: "drafts" })).toBe(undefined);
    expect(storeQueueSlugOf({ payload: "" })).toBe(undefined);
  });
});

describe("storeEventEffect", () => {
  it("owes every store-kept register a re-read on ready, each time", () => {
    const first = storeEventEffect({ event: { kind: "ready" } });
    const again = storeEventEffect({ event: { kind: "ready" } });
    expect(first).toEqual({
      alive: true,
      slugs: ["autonomy", "board", "import-questions", "reviewers", "standing-asks", "workstreams"],
      up: true,
    });
    expect(again).toEqual(first);
  });

  it("re-reads only the register a change names", () => {
    expect(storeEventEffect({ event: { kind: "changed", slug: "autonomy" } })).toEqual({
      alive: false,
      slugs: ["autonomy"],
      up: false,
    });
  });

  it("treats a heartbeat as proof of life and nothing else", () => {
    expect(storeEventEffect({ event: { atMs: 1, kind: "heartbeat" } })).toEqual({ alive: true, slugs: [], up: false });
  });
});
