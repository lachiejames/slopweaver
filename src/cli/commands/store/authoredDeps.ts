/**
 * Every seam `store authored-list`, `authored-show` and `authored-restore` touch, and the real ones — so
 * `./authoredRun.ts` is driven whole in a test by passing fakes, and production is this one object.
 */
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { slopweaverHome } from "../../../homeDir.js";
import { connectStore } from "../../../store/client.js";
import type { StoreError } from "../../../store/errors.js";
import type { StoredAuthoredVersion } from "../../../store/fleet/authoredFile.js";
import { readAuthoredAbsent, readAuthoredBody, readAuthoredVersions } from "../../../store/fleet/authoredStore.js";
import {
  createAuthoredFile,
  createFileUnderRoot,
  fileSha256,
  writeShownBody,
} from "../../../store/fleet/authoredWrite.js";
import { claudeProjectsForHome } from "../../../store/fleet/claudeMemorySync.js";

/** An open store, narrowed to the reads these verbs make. */
export interface AuthoredStoreSession {
  readonly versions: (args: {
    directory?: string;
    relativePath?: string;
  }) => Promise<Result<readonly StoredAuthoredVersion[], StoreError>>;
  readonly body: (args: { bodySha256: string }) => Promise<Result<Buffer | undefined, StoreError>>;
  /** The stored paths the last whole-home import did not find on disk. */
  readonly absent: () => Promise<Result<ReadonlySet<string>, StoreError>>;
  readonly close: () => Promise<void>;
}

/** Everything the three verbs touch outside themselves, injected so a test drives the whole thing. */
export interface AuthoredVerbDeps {
  readonly defaultHome: () => string;
  /** Open the home's selected store, or say it selects none. */
  readonly openStore: (args: {
    home: string;
  }) => Promise<Result<{ kind: "open"; session: AuthoredStoreSession } | { kind: "no-store" }, StoreError>>;
  /** The sha-256 of the file at an absolute path, or `undefined` when nothing is there. */
  readonly fileSha256: (args: { path: string }) => string | undefined;
  /** Write exact bytes to the `--out` file `show` was given, replacing it. Throws on failure. */
  readonly writeFile: (args: { path: string; bytes: Buffer }) => void;
  /**
   * CREATE a file restore decided was absent, and set its mtime. Throws when anything is already at the path —
   * a file that appeared since the plan, or a symbolic link even to nowhere — and when the directory it lands
   * in resolves outside `root`, so neither a race nor a link can turn a restore into an overwrite or a write
   * outside the home.
   */
  readonly createFile: (args: { root: string; path: string; bytes: Buffer; modifiedAt: Date }) => void;
  /**
   * Claude Code's `~/.claude/projects`, where restore writes the mirrored auto-memory back — or `undefined` when
   * the home is not `~/.slopweaver` itself, so a rehearsal never writes into the operator's real corpora.
   */
  readonly claudeProjectsFor: (args: { home: string }) => string | undefined;
  /**
   * {@link createFile} for a root that may not exist yet — an auto-memory corpus on a fresh machine: the root is
   * made first, and a path already there is `exists`, never replaced.
   */
  readonly createUnderRoot: (args: {
    root: string;
    path: string;
    bytes: Uint8Array;
    modifiedAt: Date;
  }) => Result<"created" | "exists">;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real seams: the resolved home, the selected store, the filesystem and the two output channels.
 *
 * @param env the environment the store selection is read from — `store recover` passes one naming the
 *   database it just restored, so the read never lands on a store the home already selected
 * @returns the production dependencies for all three verbs
 */
export function productionAuthoredVerbDeps({
  env,
}: { env?: Readonly<Record<string, string | undefined>> } = {}): AuthoredVerbDeps {
  return {
    claudeProjectsFor: claudeProjectsForHome,
    createFile: createAuthoredFile,
    createUnderRoot: createFileUnderRoot,
    defaultHome: () => slopweaverHome(),
    fileSha256,
    openStore: async ({ home }) => {
      const opened = await connectStore({ home, ...(env === undefined ? {} : { env }) });
      if (opened.isErr()) {
        if (opened.error.code === "STORE_URL_MISSING") {
          return ok({ kind: "no-store" });
        }
        return err(opened.error);
      }
      const client = opened.value;
      return ok({
        kind: "open",
        session: {
          absent: () => readAuthoredAbsent({ client }),
          body: ({ bodySha256 }) => readAuthoredBody({ bodySha256, client }),
          close: () => client.close(),
          versions: (filter) => readAuthoredVersions({ client, ...filter }),
        },
      });
    },
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeFile: writeShownBody,
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}
