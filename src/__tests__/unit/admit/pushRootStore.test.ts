import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import { readPushRootState, writePushRootBinding } from "../../../admit/pushRootStore.js";

const ROOT = "a".repeat(40);
const BINDING = { recordedAtIso: "2026-01-02T03:04:05.000Z", repository: "acme/widgets", rootSha: ROOT };
const OWNER_ONLY = 0o600;
const PERMISSION_BITS = 0o777;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "push-root-store-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("readPushRootState", () => {
  it("reads an absent register as absent", () => {
    expect(unwrap(readPushRootState({ home }))).toEqual({ kind: "absent" });
  });

  it("refuses a register that is present but not JSON, rather than reading it as empty", () => {
    writeFileSync(join(home, "push-roots.json"), "{not json");

    expect(unwrapErr(readPushRootState({ home })).code).toBe("PUSH_ROOT_UNREADABLE");
  });

  it("refuses a register that parses but is not one this store wrote", () => {
    writeFileSync(join(home, "push-roots.json"), JSON.stringify({ bindings: [{ repository: "acme/widgets" }] }));

    expect(unwrapErr(readPushRootState({ home })).message).toContain("is malformed");
  });
});

describe("writePushRootBinding", () => {
  it("writes the first binding owner-only and reads it back", () => {
    unwrap(writePushRootBinding({ binding: BINDING, home }));

    expect(unwrap(readPushRootState({ home }))).toEqual({ kind: "present", registry: { bindings: [BINDING] } });
    expect(statSync(join(home, "push-roots.json")).mode & PERMISSION_BITS).toBe(OWNER_ONLY);
  });

  it("leaves the file byte for byte when the same root is recorded again", () => {
    unwrap(writePushRootBinding({ binding: BINDING, home }));
    const before = readFileSync(join(home, "push-roots.json"), "utf8");
    unwrap(writePushRootBinding({ binding: { ...BINDING, recordedAtIso: "2026-03-03T00:00:00.000Z" }, home }));

    expect(readFileSync(join(home, "push-roots.json"), "utf8")).toBe(before);
  });

  it("refuses a different root and leaves the file untouched", () => {
    unwrap(writePushRootBinding({ binding: BINDING, home }));
    const before = readFileSync(join(home, "push-roots.json"), "utf8");
    const refused = writePushRootBinding({ binding: { ...BINDING, rootSha: "b".repeat(40) }, home });

    expect(unwrapErr(refused).code).toBe("PUSH_ROOT_CONFLICT");
    expect(readFileSync(join(home, "push-roots.json"), "utf8")).toBe(before);
  });

  it("refuses to repair a malformed register", () => {
    writeFileSync(join(home, "push-roots.json"), "{not json");

    expect(unwrapErr(writePushRootBinding({ binding: BINDING, home })).code).toBe("PUSH_ROOT_UNREADABLE");
    expect(readFileSync(join(home, "push-roots.json"), "utf8")).toBe("{not json");
  });
});
