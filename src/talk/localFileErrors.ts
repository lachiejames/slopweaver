/**
 * Why `slopweaver talk file` could not read or list a path — the local-file read's own typed union, one per
 * bounded module (`.claude/rules/error-handling.md`). `PATH_REFUSED` is the one POLICY refusal among them and
 * is rendered through the `talk-file-credential` hatch row; every other variant is a failure of fact.
 */
import type { WindowInvalidError } from "./errors.js";

/** Which rule a refused path tripped. */
export type LocalRefusalRule =
  /** A credential store: `$SLOPWEAVER_HOME/secrets/`, `~/.ssh`, `~/.aws`, a keychain… */
  | "credential-store"
  /** A file named like a credential: `.env`, `*.pem`, `id_ed25519`… */
  | "credential-name"
  /** A hard link to a file inside a credential store, which no path comparison can see. */
  | "credential-link";

/** The path is not an absolute or `~/` path, or carries a byte no path should. */
export interface LocalPathInvalidError {
  readonly code: "LOCAL_PATH_INVALID";
  readonly message: string;
  readonly path: string;
}

/** The path, or what it resolves to, is somewhere a credential lives. */
export interface PathRefusedError {
  readonly code: "PATH_REFUSED";
  readonly message: string;
  readonly path: string;
  readonly rule: LocalRefusalRule;
}

/**
 * The path, or what it resolves to, is inside a `no-access` path the owner protected (`slopweaver protect`). A
 * separate variant from {@link PathRefusedError} on purpose: that one renders the `talk-file-credential` hatch, and no
 * hatch of this verb lifts the owner's protection.
 */
export interface OwnerProtectedError {
  readonly code: "OWNER_PROTECTED";
  readonly message: string;
  readonly path: string;
  /** The protected path it is inside. */
  readonly protectedPath: string;
}

/** The path is not a regular file (or, for a listing, not a directory). */
export interface NotReadableKindError {
  readonly code: "NOT_READABLE_KIND";
  readonly message: string;
  readonly path: string;
}

/** The window holds a NUL byte: binary, so nothing a voice can say. */
export interface FileBinaryError {
  readonly code: "FILE_BINARY";
  readonly message: string;
  readonly path: string;
  readonly size: number;
}

/** A picture larger than one read carries whole. */
export interface ImageTooLargeError {
  readonly code: "IMAGE_TOO_LARGE";
  readonly message: string;
  readonly path: string;
  readonly size: number;
  readonly max: number;
}

/** A picture asked for from a byte offset: it is read whole, never in windows. */
export interface ImageWindowedError {
  readonly code: "IMAGE_WINDOWED";
  readonly message: string;
  readonly path: string;
  readonly from: number;
}

/** The filesystem refused the read: absent, no permission, a loop, a macOS privacy control. */
export interface FileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** A credential pattern still matched after redaction, so nothing is returned. */
export interface CredentialSurvivedError {
  readonly code: "CREDENTIAL_SURVIVED";
  readonly message: string;
  readonly path: string;
  readonly labels: readonly string[];
}

/** `--words` asked of a file that is not a whole HTML page one read carries. */
export interface NotAPageError {
  readonly code: "NOT_A_PAGE";
  readonly message: string;
  readonly path: string;
}

/** A published page's address whose slug the store holds no published page under. */
export interface PageNotInStoreError {
  readonly code: "PAGE_NOT_IN_STORE";
  readonly message: string;
  readonly path: string;
}

/** A published page's address read while the store could not answer, or answered rows that contradict. */
export interface PageStoreUnreadableError {
  readonly code: "PAGE_STORE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  /** The store's own refusal, in its words. */
  readonly detail: string;
}

/** Every way a local-file read or listing fails. */
export type LocalFileError =
  | NotAPageError
  | PageNotInStoreError
  | PageStoreUnreadableError
  | LocalPathInvalidError
  | PathRefusedError
  | OwnerProtectedError
  | NotReadableKindError
  | FileBinaryError
  | ImageTooLargeError
  | ImageWindowedError
  | FileUnreadableError
  | CredentialSurvivedError
  | WindowInvalidError;

/** What each refusal rule means, in the words the voice says back. */
const RULE_WORDS: Readonly<Record<LocalRefusalRule, string>> = {
  "credential-link": "it is a hard link to a file inside a credential store",
  "credential-name": "its name is a credential file's",
  "credential-store": "it is inside a credential store",
};

/** The message of an unreadable path: a permission refusal names macOS privacy controls, the likeliest cause. */
function unreadableMessage({ path, cause }: { path: string; cause: unknown }): string {
  const code: unknown = typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : undefined;
  if (code === "EPERM" || code === "EACCES") {
    return `${path} could not be read: permission denied — macOS may be withholding this folder from the console's terminal (System Settings, Privacy & Security, Files and Folders)`;
  }
  if (code === "ENOENT") {
    return `${path} does not exist`;
  }
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `${path} could not be read: ${detail}`;
}

/** The factories for {@link LocalFileError}. */
export const LocalFileErrors = {
  binary: ({ path, size }: { path: string; size: number }): FileBinaryError => ({
    code: "FILE_BINARY",
    message: `${path} is binary (${String(size)} bytes) and not a PNG, JPEG or WebP — there is no text or picture in it to read`,
    path,
    size,
  }),
  imageTooLarge: ({ path, size, max }: { path: string; size: number; max: number }): ImageTooLargeError => ({
    code: "IMAGE_TOO_LARGE",
    max,
    message: `${path} is a ${String(size)}-byte picture and one read carries a picture up to ${String(max)} bytes`,
    path,
    size,
  }),
  imageWindowed: ({ path, from }: { path: string; from: number }): ImageWindowedError => ({
    code: "IMAGE_WINDOWED",
    from,
    message: `${path} is a picture, read whole — call file_read without from (${String(from)} was given)`,
    path,
  }),
  credentialSurvived: ({ path, labels }: { path: string; labels: readonly string[] }): CredentialSurvivedError => ({
    code: "CREDENTIAL_SURVIVED",
    labels,
    message: `${path} still looked like it held a credential (${labels.join(", ")}) after redaction, so none of it was returned`,
    path,
  }),
  notADirectory: ({ path }: { path: string }): NotReadableKindError => ({
    code: "NOT_READABLE_KIND",
    message: `${path} is not a directory — read it with file_read`,
    path,
  }),
  notAFile: ({ path, kind }: { path: string; kind: string }): NotReadableKindError => {
    let hint = "";
    if (kind === "directory") {
      hint = " — list it with file_list";
    }
    return { code: "NOT_READABLE_KIND", message: `${path} is a ${kind}, not a regular file${hint}`, path };
  },
  pathInvalid: ({ path, why }: { path: string; why: string }): LocalPathInvalidError => ({
    code: "LOCAL_PATH_INVALID",
    message: `${path} is not a path this can read: ${why}`,
    path,
  }),
  ownerProtected: ({
    path,
    protectedPath,
    why,
  }: {
    path: string;
    protectedPath: string;
    why: string;
  }): OwnerProtectedError => ({
    code: "OWNER_PROTECTED",
    message: `${path} is not read: it is inside ${protectedPath}, which the owner protected from every session (${why})`,
    path,
    protectedPath,
  }),
  refused: ({ path, rule }: { path: string; rule: LocalRefusalRule }): PathRefusedError => ({
    code: "PATH_REFUSED",
    message: `${path} is not read: ${RULE_WORDS[rule]}, and a credential never leaves this machine`,
    path,
    rule,
  }),
  unreadable: ({ path, cause }: { path: string; cause: unknown }): FileUnreadableError => ({
    cause,
    code: "FILE_UNREADABLE",
    message: unreadableMessage({ cause, path }),
    path,
  }),
  notAPage: ({ path, why }: { path: string; why: string }): NotAPageError => ({
    code: "NOT_A_PAGE",
    message: `${path} cannot be read as a page's words: ${why}`,
    path,
  }),
  pageNotInStore: ({ path }: { path: string }): PageNotInStoreError => ({
    code: "PAGE_NOT_IN_STORE",
    message: `${path} is a published page's address, and the store holds no published page under it`,
    path,
  }),
  pageStoreUnreadable: ({ path, detail }: { path: string; detail: string }): PageStoreUnreadableError => ({
    code: "PAGE_STORE_UNREADABLE",
    detail,
    message: `${path} is a published page's address, and it could not be read from the store: ${detail}`,
    path,
  }),
} as const;
