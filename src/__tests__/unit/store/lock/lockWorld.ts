/**
 * A fake cluster and home for the store lock's tests, behaving like the real one where it matters: a login works
 * only with the role's current password, the default door closes only once the managed block is in the file and
 * reloaded, a create fails on an existing role, and the revoke empties the grant read-back. Plain fakes passed in
 * as deps — no mocks. The real cluster is proven by the throwaway-stack run.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { PublishedPort } from "../../../../store/dockerPublication.js";
import { type StoreLockError, StoreLockErrors } from "../../../../store/lock/errors.js";
import { HBA_BLOCK_BEGIN, type LoadedHbaRule } from "../../../../store/lock/hba.js";
import type { LoginAttempt } from "../../../../store/lock/macLogin.js";
import { type LockDeps, type LockReport, reconcileLock } from "../../../../store/lock/reconcile.js";

export const START = "2026-11-03 09:00:00+00";
const GATEWAY = "172.18.0.1";
export const STACK = { dbPort: 55322, projectId: "acme" };
export const HOME = "/home/acme";
export const SHIPPED = ["local all all peer", "host  all  all  172.16.0.0/12  scram-sha-256", ""].join("\n");

/** The fake cluster and home, mutated by the deps. */
export interface World {
  roleExists: boolean;
  roleMarked: boolean;
  rolePassword: string | null;
  hba: string;
  loadedHba: string;
  strays: number;
  grants: string[];
  defaults: string[];
  pending: string | null;
  storeUrl: string | null;
  backups: number;
  roleScripts: string[];
  released: boolean;
  /** How many times the stack lock was taken — `released` alone cannot say it never was. */
  held: number;
  /** How many times the stack network's gateway was read. */
  gatewayReads: number;
  /** What `docker port` reports for the database container. */
  publications: readonly PublishedPort[];
  backupFails: boolean;
  /** A hand-added `trust` rule: the server admits the login role on any password until the lock's rule loads. */
  trusting: boolean;
  /** Sessions from the Mac open as the login role, on whatever password it had when they opened. */
  loginSessions: number;
  storeUrlWrites: number;
  /** How many role changes had run at each in-place sync of a reused parked password. */
  pendingSyncs: number[];
  /** Passwords parked for OTHER stacks sharing this home, by `project_id`; `pending` is this stack's own. */
  otherStacksPending: Record<string, string>;
}

/**
 * A fresh stack: no role, the shipped rules, stray rights and one stray session.
 *
 * @param over fields that differ
 * @returns the world
 */
export const world = (over: Partial<World> = {}): World => ({
  backupFails: false,
  backups: 0,
  defaults: ["postgres|TRUNCATE|anon"],
  gatewayReads: 0,
  grants: ["docs|TRUNCATE|anon"],
  hba: SHIPPED,
  held: 0,
  loadedHba: SHIPPED,
  loginSessions: 0,
  otherStacksPending: {},
  pending: null,
  pendingSyncs: [],
  publications: [
    { hostIp: "127.0.0.1", port: STACK.dbPort },
    { hostIp: "::1", port: STACK.dbPort },
  ],
  released: false,
  roleExists: false,
  roleMarked: false,
  rolePassword: null,
  roleScripts: [],
  storeUrl: null,
  storeUrlWrites: 0,
  strays: 1,
  trusting: false,
  ...over,
});

/**
 * The rules the fake server parsed out of its loaded file.
 *
 * @param text the file
 * @returns the host rules, as `pg_hba_file_rules` reports them
 */
const parsedRules = ({ text }: { text: string }): readonly LoadedHbaRule[] =>
  text
    .split("\n")
    .map((line, index) => ({ fields: line.trim().split(/\s+/), lineNumber: index + 1 }))
    .filter(({ fields }) => fields[0] === "host")
    .map(({ fields, lineNumber }) => ({
      address: fields[3]!,
      authMethod: fields[4]!,
      error: null,
      lineNumber,
      netmask: null,
      type: "host",
      userNames: [fields[2]!],
    }));

/**
 * A Mac login against one world: the default credentials until the managed block loads, the login role on its
 * current password (or any, behind a `trust` rule that has not been replaced).
 *
 * @param state the world it reads
 * @returns the login
 */
const loginOver =
  (state: World) =>
  async ({ url }: { url: string }): Promise<LoginAttempt> => {
    const parsed = new URL(url);
    const locked = state.loadedHba.includes(HBA_BLOCK_BEGIN);
    if (parsed.username === "postgres") {
      return locked
        ? { byRule: true, kind: "refused", why: "pg_hba.conf rejects connection" }
        : { currentUser: "postgres", kind: "accepted", postmasterStart: START, sessionUser: "postgres" };
    }
    if (state.roleExists && (parsed.password === state.rolePassword || (state.trusting && !locked))) {
      return { currentUser: "postgres", kind: "accepted", postmasterStart: START, sessionUser: "slopweaver_login" };
    }
    return { byRule: false, kind: "refused", why: "password authentication failed" };
  };

/**
 * The deps over one world.
 *
 * @param state the world they read and change
 * @returns every effect the lock performs
 */
export const depsOver = (state: World): LockDeps => {
  const login = loginOver(state);
  return {
    ...sqlOver(state),
    ...homeOver(state),
    holdStackLock: () => {
      state.held += 1;
      return ok({
        release: () => {
          state.released = true;
        },
      });
    },
    hostIsLocal: async () => true,
    installHbaFile: ({ text }) => {
      state.hba = text;
      return ok(undefined);
    },
    loginUntilRefused: login,
    postmasterStartOverSocket: () => ok(START),
    progress: () => {},
    publishedPorts: () => ok(state.publications),
    randomBytes: ({ size }) => new Uint8Array(size).fill(state.roleScripts.length + 7),
    readHbaFile: () => ok({ path: "/etc/postgresql/pg_hba.conf", text: state.hba }),
    readRules: () => ok(parsedRules({ text: state.loadedHba })),
    reloadAndReadRules: () => {
      state.loadedHba = state.hba;
      return ok(parsedRules({ text: state.loadedHba }));
    },
    stackGateway: () => {
      state.gatewayReads += 1;
      return ok(GATEWAY);
    },
    tryLogin: login,
  };
};

/**
 * The admin SQL over one world: the role, its marker, the sessions from the Mac and the API roles' rights.
 *
 * @param state the world they read and change
 * @returns the two admin effects
 */
const sqlOver = (state: World): Pick<LockDeps, "adminCount" | "adminSql"> => ({
  adminCount: ({ query }) => {
    if (query.includes("pg_shdescription")) {
      return ok(state.roleExists && state.roleMarked ? 1 : 0);
    }
    if (query.includes("pg_roles")) {
      return ok(state.roleExists ? 1 : 0);
    }
    const withLogin = !query.includes("usename");
    const count = state.strays + (withLogin ? state.loginSessions : 0);
    if (query.includes("pg_terminate_backend")) {
      state.strays = 0;
      state.loginSessions = withLogin ? 0 : state.loginSessions;
    }
    return ok(count);
  },
  adminSql: ({ script }) => {
    if (script.includes("create role")) {
      if (state.roleExists) {
        return err(StoreLockErrors.stepFailed({ detail: "role already exists", step: "creating the login role" }));
      }
      state.roleExists = true;
    }
    if (script.includes("comment on role slopweaver_login")) {
      state.roleMarked = true;
    }
    if (script.includes("alter role slopweaver_login with login")) {
      state.roleScripts.push(script.includes("create role") ? "create" : "rotate");
      state.rolePassword = state.pending;
      return ok("");
    }
    if (script.includes("revoke all")) {
      state.grants = [];
      state.defaults = [];
      return ok("");
    }
    if (script.includes("has_table_privilege")) {
      return ok(state.grants.join("\n"));
    }
    if (script.includes("pg_default_acl")) {
      return ok(state.defaults.join("\n"));
    }
    return ok("");
  },
});

/**
 * The home's side over one world: the parked password per stack, store-url, and the pre-lock backup.
 *
 * @param state the world they read and change
 * @returns the home's effects
 */
const homeOver = (
  state: World,
): Pick<
  LockDeps,
  "clearPending" | "readPending" | "syncPending" | "takeBackup" | "writePending" | "writeStoreUrl"
> => ({
  clearPending: ({ projectId }) => {
    if (projectId === STACK.projectId) {
      state.pending = null;
      return;
    }
    state.otherStacksPending = Object.fromEntries(
      Object.entries(state.otherStacksPending).filter(([id]) => id !== projectId),
    );
  },
  readPending: ({ projectId }) => {
    if (projectId === STACK.projectId) {
      return state.pending;
    }
    return projectId in state.otherStacksPending ? state.otherStacksPending[projectId]! : null;
  },
  syncPending: () => {
    state.pendingSyncs.push(state.roleScripts.length);
    return ok(undefined);
  },
  takeBackup: async ({ currentUrl }) => {
    if (state.backupFails) {
      return err(StoreLockErrors.backupGateFailed({ reasons: ["the rehearsal disagreed"] }));
    }
    state.backups += 1;
    return ok({ database: new URL(currentUrl).pathname.slice(1), kind: "empty" });
  },
  writePending: ({ password, projectId }) => {
    if (projectId === STACK.projectId) {
      state.pending = password;
      return ok(undefined);
    }
    state.otherStacksPending = { ...state.otherStacksPending, [projectId]: password };
    return ok(undefined);
  },
  writeStoreUrl: ({ url }) => {
    state.storeUrl = url;
    state.storeUrlWrites += 1;
    return ok(undefined);
  },
});

/**
 * Run the lock over a world.
 *
 * @param state the world
 * @param rotate whether `--rotate` was passed
 * @returns the run's result
 */
export const lock = async ({
  state,
  rotate = false,
}: {
  state: World;
  rotate?: boolean;
}): Promise<Result<LockReport, StoreLockError>> =>
  reconcileLock({
    deps: depsOver(state),
    request: {
      home: HOME,
      rotate,
      selection: state.storeUrl === null ? null : { origin: "secret", url: state.storeUrl },
      stack: STACK,
    },
  });
