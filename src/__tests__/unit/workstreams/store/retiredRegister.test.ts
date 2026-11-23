/**
 * The tombstone at the retired register's path: what each state of the path calls for, the order its effects run in
 * — all four syncs on every open, before the caller may open the store — and, on a real
 * filesystem, that the primitives the old code wrote and read the register with both fail against it.
 */
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import {
  fenceRetiredWorkstreamRegister,
  RETIRED_REGISTER_MARKER,
  type RetiredRegisterNode,
  type RetiredRegisterSeams,
  retiredRegisterStep,
} from "../../../../workstreams/store/retiredRegister.js";
import { productionRetiredRegisterSeams } from "../../../../workstreams/store/retiredRegisterSeams.js";

const HOME = "/acme/home";
const PATH = "/acme/home/workstreams/register.json";
const MARKER = "/acme/home/workstreams/register.json/RETIRED";
const NOW = "2026-11-07T05:00:00.000Z";

/** The four syncs every open runs, in the order it must run them. */
const SYNCS = [
  `syncFile ${MARKER}`,
  `syncDirectory ${PATH} nofollow`,
  "syncDirectory /acme/home/workstreams follow",
  "syncDirectory /acme/home follow",
] as const;

/**
 * Seams that log every effect in order, report `node` for the path, and throw at the call named by `failAt`.
 *
 * @param failAt the logged line whose call throws, if any
 * @param lock what taking the lock answers
 * @returns the seams and the log they append to
 */
function transcriptSeams({
  failAt,
  lock = ok({ release: () => undefined }),
  node,
}: {
  failAt?: string;
  lock?: Result<{ readonly release: () => void }, string>;
  node: RetiredRegisterNode;
}): { readonly log: string[]; readonly seams: RetiredRegisterSeams } {
  const log: string[] = [];
  const effect = ({ line }: { line: string }): void => {
    log.push(line);
    if (line === failAt) {
      throw new Error(`${line} failed`);
    }
  };
  return {
    log,
    seams: {
      inspect: ({ path }) => {
        effect({ line: `inspect ${path}` });
        return node;
      },
      lock: ({ home }) => {
        log.push(`lock ${home}`);
        if (lock.isErr()) {
          return lock;
        }
        return ok({ release: () => log.push("release") });
      },
      makeDirectory: ({ path }) => {
        effect({ line: `makeDirectory ${path}` });
      },
      syncDirectory: ({ followLink, path }) => {
        effect({ line: `syncDirectory ${path} ${followLink ? "follow" : "nofollow"}` });
      },
      syncFile: ({ path }) => {
        effect({ line: `syncFile ${path}` });
      },
      writeMarker: ({ contents, path }) => {
        effect({ line: `writeMarker ${path} ${String(contents === RETIRED_REGISTER_MARKER)}` });
      },
    },
  };
}

const TOMBSTONE: RetiredRegisterNode = {
  entries: ["RETIRED"],
  kind: "directory",
  marker: { contents: RETIRED_REGISTER_MARKER, kind: "file" },
};

describe("retiredRegisterStep", () => {
  it("installs over an absent path, and over a directory holding only a missing or partial marker", () => {
    expect(retiredRegisterStep({ node: { kind: "absent" } })).toEqual({ step: "install" });
    expect(retiredRegisterStep({ node: { entries: [], kind: "directory", marker: null } })).toEqual({
      step: "install",
    });
    expect(
      retiredRegisterStep({
        node: { entries: ["RETIRED"], kind: "directory", marker: { contents: "The work", kind: "file" } },
      }),
    ).toEqual({ step: "install" });
  });

  it("only re-syncs a directory holding exactly the marker", () => {
    expect(retiredRegisterStep({ node: TOMBSTONE })).toEqual({ step: "sync" });
  });

  it("names what stands there instead: a file, a link, a foreign node or a directory holding anything else", () => {
    expect(retiredRegisterStep({ node: { kind: "file" } })).toEqual({ found: "a regular file" });
    expect(retiredRegisterStep({ node: { kind: "symlink" } })).toEqual({ found: "a symbolic link" });
    expect(retiredRegisterStep({ node: { kind: "other" } })).toEqual({
      found: "something that is neither a file nor a directory",
    });
    expect(
      retiredRegisterStep({
        node: {
          entries: ["RETIRED", "notes.md"],
          kind: "directory",
          marker: { contents: RETIRED_REGISTER_MARKER, kind: "file" },
        },
      }),
    ).toEqual({ found: "a directory holding notes.md" });
  });

  it("refuses a marker entry that is not a regular file, never installing through it", () => {
    expect(
      retiredRegisterStep({ node: { entries: ["RETIRED"], kind: "directory", marker: { kind: "not-a-file" } } }),
    ).toEqual({ found: "a directory whose RETIRED is not a regular file" });
  });
});

describe("fenceRetiredWorkstreamRegister over transcript seams", () => {
  it("installs a fresh tombstone, then runs all four syncs in order, all under the lock", () => {
    const { log, seams } = transcriptSeams({ node: { kind: "absent" } });

    expect(unwrap(fenceRetiredWorkstreamRegister({ home: HOME, seams }))).toBe(undefined);
    expect(log).toEqual([
      `lock ${HOME}`,
      `inspect ${PATH}`,
      `makeDirectory ${PATH}`,
      `writeMarker ${MARKER} true`,
      ...SYNCS,
      "release",
    ]);
  });

  it("replays all four syncs over an existing tombstone, since a process before it may have died before any", () => {
    const { log, seams } = transcriptSeams({ node: TOMBSTONE });

    expect(unwrap(fenceRetiredWorkstreamRegister({ home: HOME, seams }))).toBe(undefined);
    expect(log).toEqual([`lock ${HOME}`, `inspect ${PATH}`, ...SYNCS, "release"]);
  });

  it.each(SYNCS.map((failAt, at) => ({ at, failAt })))(
    "refuses as not durable when sync $at fails over an existing tombstone, running nothing after it",
    ({ at, failAt }) => {
      const { log, seams } = transcriptSeams({ failAt, node: TOMBSTONE });
      const error = unwrapErr(fenceRetiredWorkstreamRegister({ home: HOME, seams }));

      expect(error.code).toBe("WORKSTREAM_TOMBSTONE_NOT_DURABLE");
      expect(error.message).toBe(
        `the tombstone at ${PATH} could not be made durable, so the store was not opened — a build from before the move could write the retired register again: ${failAt} failed`,
      );
      expect(log).toEqual([`lock ${HOME}`, `inspect ${PATH}`, ...SYNCS.slice(0, at + 1), "release"]);
    },
  );

  it.each(SYNCS.map((failAt, at) => ({ at, failAt })))(
    "refuses as not durable when sync $at fails over a fresh install",
    ({ at, failAt }) => {
      const { log, seams } = transcriptSeams({ failAt, node: { kind: "absent" } });

      expect(unwrapErr(fenceRetiredWorkstreamRegister({ home: HOME, seams })).code).toBe(
        "WORKSTREAM_TOMBSTONE_NOT_DURABLE",
      );
      expect(log.slice(-2)).toEqual([SYNCS[at], "release"]);
    },
  );

  it("refuses a regular file at the path, installing and syncing nothing", () => {
    const { log, seams } = transcriptSeams({ node: { kind: "file" } });
    const error = unwrapErr(fenceRetiredWorkstreamRegister({ home: HOME, seams }));

    expect(error.message).toBe(
      `${PATH} holds a regular file where the retired workstream register was — the register lives in the store and nothing imports a file, so move it aside, then re-enter what it held with \`workstreams put\``,
    );
    expect(log).toEqual([`lock ${HOME}`, `inspect ${PATH}`, "release"]);
  });

  it("answers a failed inspection as an outage, and a held lock without inspecting at all", () => {
    const failing = transcriptSeams({ failAt: `inspect ${PATH}`, node: { kind: "absent" } });
    const held = transcriptSeams({ lock: err("held by pid 4242"), node: { kind: "absent" } });

    expect(unwrapErr(fenceRetiredWorkstreamRegister({ home: HOME, seams: failing.seams })).code).toBe(
      "WORKSTREAM_STORE_UNAVAILABLE",
    );
    expect(unwrapErr(fenceRetiredWorkstreamRegister({ home: HOME, seams: held.seams })).message).toBe(
      `the store could not take the workstreams-register lock to fence ${PATH}: held by pid 4242`,
    );
    expect(held.log).toEqual([`lock ${HOME}`]);
  });
});

describe("fenceRetiredWorkstreamRegister on a real filesystem", () => {
  let home = "";

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  const seams = productionRetiredRegisterSeams({ nowIso: () => NOW });

  /**
   * A throwaway home holding no register.
   *
   * @returns the home
   */
  const freshHome = (): string => {
    home = mkdtempSync(join(tmpdir(), "retired-register-"));
    return home;
  };

  it("stands an owner-only directory holding exactly the marker, and confirms it on the next open", () => {
    const at = freshHome();
    const path = join(at, "workstreams", "register.json");

    expect(unwrap(fenceRetiredWorkstreamRegister({ home: at, seams }))).toBe(undefined);
    expect(unwrap(fenceRetiredWorkstreamRegister({ home: at, seams }))).toBe(undefined);
    expect(statSync(path).isDirectory()).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(path, "RETIRED"), "utf8")).toBe(RETIRED_REGISTER_MARKER);
  });

  it("makes the old writer's staged rename and the old reader's read both fail, leaving the tombstone standing", () => {
    const at = freshHome();
    const path = join(at, "workstreams", "register.json");
    unwrap(fenceRetiredWorkstreamRegister({ home: at, seams }));

    expect(() => {
      writeFileAtomic({ contents: "{}\n", dirMode: 0o700, fileMode: 0o600, path });
    }).toThrow(/EISDIR|ENOTEMPTY|EEXIST/u);
    expect(() => readFileSync(path, "utf8")).toThrow(/EISDIR/u);
    expect(readFileSync(join(path, "RETIRED"), "utf8")).toBe(RETIRED_REGISTER_MARKER);
  });

  it("refuses the old register file, a link and a foreign directory, changing none of them", () => {
    const at = freshHome();
    const path = join(at, "workstreams", "register.json");
    mkdirSync(join(at, "workstreams"));
    writeFileSync(path, '{"schemaVersion":1}');
    const file = unwrapErr(fenceRetiredWorkstreamRegister({ home: at, seams }));
    rmSync(path);
    symlinkSync(join(at, "nowhere"), path);
    const link = unwrapErr(fenceRetiredWorkstreamRegister({ home: at, seams }));
    rmSync(path);
    mkdirSync(path);
    writeFileSync(join(path, "notes.md"), "kept");
    const foreign = unwrapErr(fenceRetiredWorkstreamRegister({ home: at, seams }));

    expect([file, link, foreign].map((one) => [one.code, "found" in one ? one.found : ""])).toEqual([
      ["WORKSTREAM_RETIRED_REGISTER_PRESENT", "a regular file"],
      ["WORKSTREAM_RETIRED_REGISTER_PRESENT", "a symbolic link"],
      ["WORKSTREAM_RETIRED_REGISTER_PRESENT", "a directory holding notes.md"],
    ]);
    expect(readFileSync(join(path, "notes.md"), "utf8")).toBe("kept");
  });

  it("refuses a RETIRED link to a file holding the exact marker, leaving the link and its target unchanged", () => {
    const at = freshHome();
    const path = join(at, "workstreams", "register.json");
    const decoy = join(at, "decoy");
    mkdirSync(path, { recursive: true });
    writeFileSync(decoy, RETIRED_REGISTER_MARKER);
    symlinkSync(decoy, join(path, "RETIRED"));
    const error = unwrapErr(fenceRetiredWorkstreamRegister({ home: at, seams }));

    expect([error.code, "found" in error ? error.found : ""]).toEqual([
      "WORKSTREAM_RETIRED_REGISTER_PRESENT",
      "a directory whose RETIRED is not a regular file",
    ]);
    expect(lstatSync(join(path, "RETIRED")).isSymbolicLink()).toBe(true);
    expect(readFileSync(decoy, "utf8")).toBe(RETIRED_REGISTER_MARKER);
  });

  it("refuses to sync a marker or a tombstone that is a link, so one swapped in after the look is an error", () => {
    const at = freshHome();
    const decoy = join(at, "decoy");
    const decoyDirectory = join(at, "decoy-directory");
    writeFileSync(decoy, RETIRED_REGISTER_MARKER);
    mkdirSync(decoyDirectory);
    symlinkSync(decoy, join(at, "RETIRED"));
    symlinkSync(decoyDirectory, join(at, "register.json"));

    expect(() => {
      seams.syncFile({ path: join(at, "RETIRED") });
    }).toThrow(/ELOOP|EMLINK/u);
    expect(() => {
      seams.syncDirectory({ followLink: false, path: join(at, "register.json") });
    }).toThrow(/ELOOP|EMLINK|ENOTDIR/u);
    expect(seams.syncDirectory({ followLink: true, path: join(at, "register.json") })).toBe(undefined);
  });
});
