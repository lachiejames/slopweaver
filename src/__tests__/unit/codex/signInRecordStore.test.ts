import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { CodexAccountLive } from "../../../codex/accountLiveParse.js";
import { CodexSignInErrors } from "../../../codex/signInErrors.js";
import { type CodexSignInImportRead, readCodexSignInImportFile } from "../../../codex/signInObservationCurrent.js";
import type { CodexSignInObserved } from "../../../codex/signInPort.js";
import type { CodexAuthStamp, CodexSignInRecord } from "../../../codex/signInRecord.js";
import { storeCodexSignInPort } from "../../../codex/signInRecordStore.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import {
  type MemoryCodexSignInStore,
  memoryCodexSignInKey,
  memoryCodexSignInPort,
  memoryCodexSignInSeams,
  memoryCodexSignInStore,
} from "../../codexSignInFixture.js";

const HOME_ONE = "/Users/owner/.codex-one";
const FIRST_ISO = "2026-09-25T12:30:00.000Z";
const LATER_ISO = "2026-09-25T12:35:00.000Z";
const ABSENT: CodexAuthStamp = { kind: "absent" };

const signedOut: CodexAccountLive = { codexHome: HOME_ONE, kind: "signed-out", readAtIso: LATER_ISO };

const signedIn: CodexAccountLive = {
  accountId: "acct",
  codexHome: HOME_ONE,
  email: "codex-1@example.org",
  gauges: [],
  kind: "signed-in",
  ordinaryUsageAllowed: true,
  planType: "plus",
  readAtIso: LATER_ISO,
  resetCreditsAvailable: 0,
};

/** A refusal as an earlier read filed it, against no auth.json. */
const filed: CodexSignInRecord = {
  alias: "codex-one",
  authStamp: ABSENT,
  codexHome: HOME_ONE,
  failingSinceIso: FIRST_ISO,
  readAtIso: FIRST_ISO,
  state: "signed-out",
};

/** One observation of codex-one against no auth.json, which did not move during the read. */
function observe({ alias = "codex-one", live }: { alias?: string; live: CodexAccountLive }): CodexSignInObserved {
  return { alias, authAfter: ABSENT, authBefore: ABSENT, live };
}

describe("the store-backed sign-in observations", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  function freshHome(): string {
    const home = mkdtempSync(join(tmpdir(), "sw-signin-"));
    homes.push(home);
    return home;
  }
  function importPath({ home }: { home: string }): string {
    return join(home, "codex-signin", "codex-one.json");
  }
  function writeImport({ content, home }: { content: string; home: string }): string {
    const path = importPath({ home });
    mkdirSync(join(home, "codex-signin"), { recursive: true });
    writeFileSync(path, content);
    return path;
  }

  it("files a refusal, then signed-in once the store answers, bumping the revision each time", async () => {
    const home = freshHome();
    const port = memoryCodexSignInPort();
    const first = unwrap(await port.record({ home, observed: [observe({ live: signedOut })] }));
    const later = { ...signedIn, readAtIso: "2026-09-25T12:50:00.000Z" };
    const second = unwrap(await port.record({ home, observed: [observe({ live: later })] }));
    expect([first, second, unwrap(await port.read({ aliases: ["codex-one"], home }))]).toEqual([
      [{ alias: "codex-one", kind: "written", revision: 1 }],
      [{ alias: "codex-one", kind: "written", revision: 2 }],
      [
        {
          alias: "codex-one",
          kind: "record",
          record: { ...filed, failingSinceIso: undefined, readAtIso: "2026-09-25T12:50:00.000Z", state: "signed-in" },
          revision: 2,
        },
      ],
    ]);
  });

  it("imports a valid file once, and the row stays the authority after the file changes or goes", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const port = memoryCodexSignInPort({ store });
    const path = writeImport({ content: JSON.stringify(filed), home });
    const imported = unwrap(await port.read({ aliases: ["codex-one"], home }));
    writeFileSync(path, JSON.stringify({ ...filed, state: "capped" }));
    const afterChange = unwrap(await port.read({ aliases: ["codex-one"], home }));
    rmSync(path);
    const afterRemoval = unwrap(await port.read({ aliases: ["codex-one"], home }));
    const expected = [{ alias: "codex-one", kind: "record", record: filed, revision: 1 }];
    expect([imported, afterChange, afterRemoval, store.rows.size]).toEqual([expected, expected, expected, 1]);
  });

  it("inserts nothing for an alias with no row and no file", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const read = unwrap(await memoryCodexSignInPort({ store }).read({ aliases: ["codex-one"], home }));
    expect([read, store.rows.size]).toEqual([[{ alias: "codex-one", kind: "absent" }], 0]);
  });

  it("refuses a reader over an import file that does not parse, while a writer replaces it with the store's answer", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const port = memoryCodexSignInPort({ store });
    const path = writeImport({ content: "{not json", home });
    const read = unwrap(await port.read({ aliases: ["codex-one"], home }));
    const written = unwrap(await port.record({ home, observed: [observe({ live: signedOut })] }));
    expect(read[0]!.kind).toBe("refused");
    expect(read[0]).toMatchObject({ error: { code: "CODEX_SIGN_IN_OBSERVATION_INVALID", source: "import-file" } });
    expect([written, readFileSync(path, "utf8")]).toEqual([
      [{ alias: "codex-one", kind: "written", revision: 1 }],
      "{not json",
    ]);
  });

  it("refuses a reader over an import file that decodes to nothing, naming the file and the field", async () => {
    const home = freshHome();
    const path = writeImport({ content: JSON.stringify({ ...filed, state: "capped" }), home });
    const read = unwrap(await memoryCodexSignInPort().read({ aliases: ["codex-one"], home }));
    expect(read).toEqual([
      {
        alias: "codex-one",
        error: CodexSignInErrors.importObservationInvalid({
          alias: "codex-one",
          path,
          why: 'carries state "capped", not signed-in, signed-out or store-missing',
        }),
        kind: "refused",
      },
    ]);
  });

  it("refuses both a read and a write over an import file it cannot read, writing nothing past it", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const port = memoryCodexSignInPort({ store });
    const path = writeImport({ content: JSON.stringify({ ...filed, readAtIso: "2026-09-25T12:40:00.000Z" }), home });
    chmodSync(path, 0o000);
    const read = unwrap(await port.read({ aliases: ["codex-one"], home }));
    const written = unwrap(await port.record({ home, observed: [observe({ live: signedIn })] }));
    chmodSync(path, 0o600);
    expect([read[0]!.kind, written[0]!.kind, store.rows.size]).toEqual(["refused", "refused", 0]);
    expect([read[0], written[0]]).toMatchObject([
      { error: { code: "CODEX_SIGN_IN_IMPORT_UNREADABLE", path } },
      { error: { code: "CODEX_SIGN_IN_IMPORT_UNREADABLE", path } },
    ]);
  });

  it("reads an import file behind a directory it cannot search as unreadable, never as nothing filed", async () => {
    const home = freshHome();
    writeImport({ content: JSON.stringify(filed), home });
    chmodSync(join(home, "codex-signin"), 0o600);
    const read = unwrap(await memoryCodexSignInPort().read({ aliases: ["codex-one"], home }));
    chmodSync(join(home, "codex-signin"), 0o700);
    expect(read[0]).toMatchObject({ error: { code: "CODEX_SIGN_IN_IMPORT_UNREADABLE" }, kind: "refused" });
  });

  it("refuses a FIFO at the import path rather than blocking the routing read on it", async () => {
    const home = freshHome();
    mkdirSync(join(home, "codex-signin"), { recursive: true });
    execFileSync("mkfifo", [importPath({ home })]);
    const port = memoryCodexSignInPort();
    const written = unwrap(await port.record({ home, observed: [observe({ live: signedIn })] }));
    const read = unwrap(await port.read({ aliases: ["codex-one"], home }));
    expect([written[0], read[0]]).toMatchObject([
      { error: { code: "CODEX_SIGN_IN_IMPORT_UNREADABLE" }, kind: "refused" },
      { error: { code: "CODEX_SIGN_IN_IMPORT_UNREADABLE" }, kind: "refused" },
    ]);
  });

  it("refuses a stored row that does not decode, and never overwrites it", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const bad = { alias: "codex-one", record: { ...filed, state: "capped" }, revision: 4 };
    store.rows.set(memoryCodexSignInKey({ alias: "codex-one", home }), bad);
    const port = memoryCodexSignInPort({ store });
    const read = unwrap(await port.read({ aliases: ["codex-one"], home }));
    const written = unwrap(await port.record({ home, observed: [observe({ live: signedIn })] }));
    const error = CodexSignInErrors.storedObservationInvalid({
      alias: "codex-one",
      why: 'carries state "capped", not signed-in, signed-out or store-missing',
    });
    expect([read, written, store.rows.get(memoryCodexSignInKey({ alias: "codex-one", home }))]).toEqual([
      [{ alias: "codex-one", error, kind: "refused" }],
      [{ alias: "codex-one", error, kind: "refused" }],
      bad,
    ]);
  });

  it("reports a compare-and-set another pass won as a conflict, and never retries it", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const key = memoryCodexSignInKey({ alias: "codex-one", home });
    store.rows.set(key, { alias: "codex-one", record: filed, revision: 1 });
    const seams = memoryCodexSignInSeams({ store });
    let updates = 0;
    const port = storeCodexSignInPort({
      seams: {
        ...seams,
        connect: async ({ home: connected }) => {
          const rows = unwrap(await seams.connect({ home: connected }));
          return ok({
            ...rows,
            update: (request) => {
              updates += 1;
              // A concurrent pass commits between this pass's read and its update.
              store.rows.set(key, { alias: "codex-one", record: filed, revision: 2 });
              return rows.update(request);
            },
          });
        },
      },
    });
    // Two observations of the alias in one batch: the second meets the first's miss, never a second stale update.
    const written = unwrap(
      await port.record({
        home,
        observed: [
          observe({ live: signedIn }),
          observe({ live: { ...signedIn, readAtIso: "2026-09-25T12:40:00.000Z" } }),
        ],
      }),
    );
    const conflict = {
      alias: "codex-one",
      error: CodexSignInErrors.revisionConflict({ alias: "codex-one", expectedRevision: 1 }),
      kind: "refused",
    };
    expect([written, updates, store.rows.get(key)]).toEqual([
      [conflict, conflict],
      1,
      { alias: "codex-one", record: filed, revision: 2 },
    ]);
  });

  it("reads back the winner when a concurrent importer inserts first, rather than its own file", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const winner = { ...filed, readAtIso: "2026-09-25T12:40:00.000Z" };
    writeImport({ content: JSON.stringify(filed), home });
    const seams = memoryCodexSignInSeams({ store });
    const port = storeCodexSignInPort({
      seams: {
        ...seams,
        connect: async ({ home: connected }) => {
          const rows = unwrap(await seams.connect({ home: connected }));
          return ok({
            ...rows,
            insert: async (request) => {
              await rows.insert({ alias: request.alias, record: winner });
              return rows.insert(request);
            },
          });
        },
      },
    });
    expect(unwrap(await port.read({ aliases: ["codex-one"], home }))).toEqual([
      { alias: "codex-one", kind: "record", record: winner, revision: 1 },
    ]);
  });

  it("refuses on a store outage without ever reading the import file", async () => {
    const home = freshHome();
    writeImport({ content: JSON.stringify(filed), home });
    const imports: string[] = [];
    const outage = CodexSignInErrors.storeUnavailable({ doing: "be opened", reason: "connect ECONNREFUSED" });
    const port = storeCodexSignInPort({
      seams: {
        connect: () => Promise.resolve(err(outage)),
        readImportFile: ({ alias }): CodexSignInImportRead => {
          imports.push(alias);
          return { kind: "absent" };
        },
      },
    });
    const read = await port.read({ aliases: ["codex-one"], home });
    const written = await port.record({ home, observed: [observe({ live: signedOut })] });
    expect([unwrapErr(read), unwrapErr(written), imports]).toEqual([outage, outage, []]);
  });

  it("refuses as unavailable when the connection throws rather than answering", async () => {
    const home = freshHome();
    const port = storeCodexSignInPort({
      seams: {
        connect: () => Promise.reject(new Error("socket hang up")),
        readImportFile: () => ({ kind: "absent" }),
      },
    });
    expect(unwrapErr(await port.read({ aliases: ["codex-one"], home }))).toEqual(
      CodexSignInErrors.storeUnavailable({ doing: "be opened", reason: "socket hang up" }),
    );
  });

  it("opens and closes one connection for a read of several aliases, answering in the order asked", async () => {
    const home = freshHome();
    const store: MemoryCodexSignInStore = memoryCodexSignInStore();
    const port = memoryCodexSignInPort({ store });
    unwrap(await port.record({ home, observed: [observe({ live: signedOut })] }));
    const read = unwrap(await port.read({ aliases: ["codex-two", "codex-one"], home }));
    expect([read.map((one) => [one.alias, one.kind]), store.opened, store.closed]).toEqual([
      [
        ["codex-two", "absent"],
        ["codex-one", "record"],
      ],
      2,
      2,
    ]);
  });

  it("consults an alias's import file once when one read asks for that alias twice", async () => {
    const home = freshHome();
    writeImport({ content: JSON.stringify(filed), home });
    const store = memoryCodexSignInStore();
    const imports: string[] = [];
    const port = storeCodexSignInPort({
      seams: memoryCodexSignInSeams({
        readImportFile: ({ alias, home: from }) => {
          imports.push(alias);
          return readCodexSignInImportFile({ alias, home: from });
        },
        store,
      }),
    });
    const read = unwrap(await port.read({ aliases: ["codex-one", "codex-one"], home }));
    const expected = { alias: "codex-one", kind: "record", record: filed, revision: 1 };
    expect([read, imports, store.rows.size]).toEqual([[expected, expected], ["codex-one"], 1]);
  });

  it("judges a second observation of one alias in a batch against what the first one committed", async () => {
    const home = freshHome();
    const port = memoryCodexSignInPort();
    const written = unwrap(
      await port.record({
        home,
        observed: [
          observe({ live: signedOut }),
          observe({ live: { ...signedIn, readAtIso: "2026-09-25T12:40:00.000Z" } }),
        ],
      }),
    );
    expect(written).toEqual([
      { alias: "codex-one", kind: "written", revision: 1 },
      { alias: "codex-one", kind: "written", revision: 2 },
    ]);
    expect(unwrap(await port.read({ aliases: ["codex-one"], home }))).toMatchObject([
      { kind: "record", record: { state: "signed-in" }, revision: 2 },
    ]);
  });

  it("touches only the aliases a read observed, so concurrent reads never overwrite each other's stores", async () => {
    const home = freshHome();
    const port = memoryCodexSignInPort();
    unwrap(await port.record({ home, observed: [observe({ live: signedOut })] }));
    unwrap(
      await port.record({ home, observed: [observe({ alias: "codex-two", live: { ...signedIn, codexHome: "/x" } })] }),
    );
    const read = unwrap(await port.read({ aliases: ["codex-one"], home }));
    expect(read).toMatchObject([{ alias: "codex-one", kind: "record", revision: 1 }]);
  });

  it("files nothing under a string no register would accept as an alias, and refuses to read one", async () => {
    const home = freshHome();
    const store = memoryCodexSignInStore();
    const port = memoryCodexSignInPort({ store });
    const written = unwrap(await port.record({ home, observed: [observe({ alias: "../escape", live: signedOut })] }));
    const read = unwrap(await port.read({ aliases: ["../escape"], home }));
    const error = CodexSignInErrors.aliasInvalid({ alias: "../escape" });
    expect([written, read, store.rows.size]).toEqual([
      [{ alias: "../escape", error, kind: "refused" }],
      [{ alias: "../escape", error, kind: "refused" }],
      0,
    ]);
  });

  it("keeps what is filed when the live read was unreadable", async () => {
    const home = freshHome();
    const port = memoryCodexSignInPort();
    unwrap(await port.record({ home, observed: [observe({ live: signedOut })] }));
    const unreadable: CodexAccountLive = { codexHome: HOME_ONE, kind: "unreadable", readAtIso: LATER_ISO, reason: "x" };
    expect(unwrap(await port.record({ home, observed: [observe({ live: unreadable })] }))).toEqual([
      { alias: "codex-one", kind: "kept", why: "the live read was unreadable: x" },
    ]);
  });
});
