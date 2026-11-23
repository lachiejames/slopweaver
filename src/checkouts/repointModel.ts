/**
 * `github repoint-plan`'s vocabulary: the facts `./repointReaders.ts` gathers, the actions, unresolved items and
 * observations `./repointPlan.ts` decides, and the part shape each planning stage returns. Types and one pure merge
 * only — nothing here reads or decides.
 */
import type { LinkReplacement } from "./repointLinks.js";

/** One change the switch would make. */
export type RepointAction =
  | {
      readonly kind: "git-remote";
      readonly role: "archive";
      readonly checkout: string;
      /** The git config key, `remote.<name>.url` or `remote.<name>.pushurl`. */
      readonly configKey: string;
      readonly fromUrl: string;
      readonly toUrl: string;
    }
  | {
      readonly kind: "json-field";
      readonly role: "fresh";
      readonly surface: "profile" | "desktop" | "codex-marketplace";
      readonly path: string;
      /** An RFC 6901 JSON pointer to the string field. */
      readonly pointer: string;
      readonly from: string;
      readonly to: string;
      readonly expectedSha256: string;
    }
  | {
      readonly kind: "text-replacements";
      readonly role: "historical-link";
      readonly path: string;
      readonly expectedSha256: string;
      readonly replacements: readonly LinkReplacement[];
    }
  | {
      readonly kind: "plist-string";
      readonly role: "fresh";
      readonly path: string;
      readonly keyPath: readonly string[];
      readonly from: string;
      readonly to: string;
      readonly expectedSha256: string;
    };

/** Something the plan could not decide, which keeps it incomplete. */
export interface RepointUnresolved {
  readonly surface: string;
  readonly locator: string;
  readonly reason: string;
}

/** Something disclosed rather than changed. */
export interface RepointObservation {
  readonly surface: string;
  readonly locator: string;
  readonly disposition: "archive" | "fresh" | "unchanged" | "running-process";
  readonly detail: string;
}

/** What the invocation asked for. */
export interface RepositoryRepointRequest {
  readonly repository: string;
  readonly archiveName: string;
  readonly newCheckout: string | undefined;
}

/** A file read whole: its path, its sha-256 and the one string field the plan may move. */
export interface ReadField {
  readonly path: string;
  readonly sha256: string;
  readonly value: string;
}

/** A surface that was absent, unreadable, or read. */
type Surface<T> =
  | { readonly kind: "absent"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string }
  | ({ readonly kind: "read" } & T);

/** One declared main checkout, as git reported it. */
export type CheckoutFacts =
  | {
      readonly kind: "read";
      readonly path: string;
      /** Git's own top level for `path`, symlinks resolved, so a link to the same directory still overlaps. */
      readonly toplevel: string;
      /** Every `remote.<name>.url` / `remote.<name>.pushurl` line. */
      readonly remoteConfig: readonly { readonly key: string; readonly url: string }[];
      readonly worktrees: readonly { readonly path: string; readonly branch: string | null }[];
    }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/** Everything `./repointReaders.ts` read. */
export interface RepositoryRepointFacts {
  readonly generatedAtIso: string;
  readonly pushRoot: string | null;
  readonly profile: Surface<{
    readonly path: string;
    readonly sha256: string;
    readonly mainCheckouts: readonly string[];
  }>;
  readonly checkouts: readonly CheckoutFacts[];
  readonly newCheckout:
    | { readonly kind: "not-given" }
    | { readonly kind: "unreadable"; readonly path: string; readonly why: string }
    | {
        readonly kind: "read";
        readonly path: string;
        readonly toplevel: string;
        readonly remoteConfig: readonly { readonly key: string; readonly url: string }[];
        readonly headRoots: readonly string[];
      };
  readonly desktop: Surface<ReadField & { readonly pointer: string }>;
  readonly marketplace: Surface<ReadField & { readonly pointer: string }>;
  readonly launchAgents: readonly (
    | {
        readonly kind: "read";
        readonly path: string;
        readonly sha256: string;
        readonly strings: readonly { readonly keyPath: readonly string[]; readonly value: string }[];
      }
    | { readonly kind: "unreadable"; readonly path: string; readonly why: string }
  )[];
  readonly links: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly replacements: readonly LinkReplacement[];
  }[];
  readonly linkResidue: readonly { readonly locator: string; readonly why: string }[];
  /** Authored files that are not UTF-8 (images, say) whose raw bytes name no link of the repository. */
  readonly nonTextFilesWithoutLinks: number;
}

/** What one planning stage contributes, each list in the order the stage found it. */
export interface RepointPart {
  readonly actions: readonly RepointAction[];
  readonly unresolved: readonly RepointUnresolved[];
  readonly observations: readonly RepointObservation[];
}

/**
 * Join stage parts into one, keeping each list's items in stage order.
 *
 * @param parts the stages' contributions, earliest first
 * @returns every action, unresolved item and observation, each list concatenated in the order given
 */
export function mergeRepointParts({ parts }: { parts: readonly Partial<RepointPart>[] }): RepointPart {
  const actions: RepointAction[] = [];
  const observations: RepointObservation[] = [];
  const unresolved: RepointUnresolved[] = [];
  for (const part of parts) {
    if (part.actions !== undefined) {
      actions.push(...part.actions);
    }
    if (part.observations !== undefined) {
      observations.push(...part.observations);
    }
    if (part.unresolved !== undefined) {
      unresolved.push(...part.unresolved);
    }
  }
  return { actions, observations, unresolved };
}
