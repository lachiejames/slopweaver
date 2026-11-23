/**
 * The push-root register — which repositories had their history re-cut, and the ONE parentless commit each now
 * accepts. Pure: the schema, the lookup and the record rule. The file lives at `$home/push-roots.json`
 * (`../stateHome/identity.ts`), is read and written by `./pushRootStore.ts`, and is judged by `./pushRootGate.ts`.
 *
 * Why the root lives in state and never in code: which repository was re-cut, and at which commit, is one
 * install's fact, and the codebase carries only the mechanism.
 *
 * A binding never changes once written. Recording a DIFFERENT root for a repository already bound would let the
 * old history back in through the register itself, so it refuses; the same root again is a no-op that keeps the
 * first timestamp.
 */
import { z } from "zod";
import { sameGithubRepository } from "../lib/githubRemote.js";
import { err, ok, type Result } from "../lib/result.js";

/** One re-cut repository and the only root a push to it may carry. */
export interface PushRootBinding {
  /** `owner/name`, as recorded; compared without regard to case, as GitHub resolves it. */
  readonly repository: string;
  /** The fresh history's one parentless commit, forty lowercase hex. */
  readonly rootSha: string;
  /** When the binding was recorded. */
  readonly recordedAtIso: string;
}

/** The whole register, as the file holds it. */
export interface PushRootRegistry {
  readonly bindings: readonly PushRootBinding[];
}

/** A malformed register: present, but not one this module wrote. */
interface PushRootMalformedError {
  readonly code: "PUSH_ROOT_MALFORMED";
  readonly message: string;
}

/** A record that would change an existing binding's root. */
export interface PushRootConflictError {
  readonly code: "PUSH_ROOT_CONFLICT";
  readonly message: string;
  readonly existing: PushRootBinding;
}

/** Why a register could not be parsed, or a binding could not be added. */
export type PushRootRegistryError = PushRootConflictError | PushRootMalformedError;

/** Factories for {@link PushRootRegistryError}. */
const PushRootRegistryErrors = {
  conflict: ({ existing, rootSha }: { existing: PushRootBinding; rootSha: string }): PushRootConflictError => ({
    code: "PUSH_ROOT_CONFLICT",
    existing,
    message:
      `${existing.repository} is already bound to root ${existing.rootSha} (recorded ${existing.recordedAtIso}); ` +
      `refusing to rebind it to ${rootSha}, because a changed root is how old history gets back in`,
  }),
  malformed: ({ why }: { why: string }): PushRootMalformedError => ({
    code: "PUSH_ROOT_MALFORMED",
    message: `the push-root register is malformed: ${why}`,
  }),
} as const;

/** `owner/name`: two non-empty segments, neither `.` nor `..`. */
const REPOSITORY = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/)
  .refine((value) => value.split("/").every((segment) => segment !== "." && segment !== ".."));

/** A full SHA-1 object id. Git's SHA-256 object format is out of scope, as it is for every push verb here. */
const ROOT_SHA = z.string().regex(/^[0-9a-f]{40}$/);

const registrySchema = z
  .object({
    bindings: z.array(
      z.object({ recordedAtIso: z.iso.datetime(), repository: REPOSITORY, rootSha: ROOT_SHA }).strict(),
    ),
  })
  .strict();

/**
 * Whether a string is an `owner/name` a binding may name.
 *
 * @param value the candidate
 * @returns true when it is two non-empty path segments
 */
export function isPushRootRepository({ value }: { value: string }): boolean {
  return REPOSITORY.safeParse(value).success;
}

/**
 * Whether a string is a full lowercase SHA-1 a binding may hold.
 *
 * @param value the candidate
 * @returns true for forty lowercase hex characters
 */
export function isPushRootSha({ value }: { value: string }): boolean {
  return ROOT_SHA.safeParse(value).success;
}

/**
 * Parse a decoded register. A repository bound twice — in any case — is malformed rather than resolved by order,
 * because which row a lookup met first would then decide policy.
 *
 * @param value the decoded JSON
 * @returns the register, or why it is not one
 */
export function parsePushRootRegistry({ value }: { value: unknown }): Result<PushRootRegistry, PushRootRegistryError> {
  const parsed = registrySchema.safeParse(value);
  if (!parsed.success) {
    return err(PushRootRegistryErrors.malformed({ why: parsed.error.issues.map((issue) => issue.message).join("; ") }));
  }
  const seen = new Set<string>();
  for (const binding of parsed.data.bindings) {
    const key = binding.repository.toLowerCase();
    if (seen.has(key)) {
      return err(PushRootRegistryErrors.malformed({ why: `${binding.repository} is bound more than once` }));
    }
    seen.add(key);
  }
  return ok({ bindings: parsed.data.bindings });
}

/**
 * The binding for one repository, if the register holds one.
 *
 * @param registry the parsed register
 * @param repository the `owner/name` a push targets
 * @returns its binding, or undefined when that repository was never re-cut
 */
export function pushRootForRepository({
  registry,
  repository,
}: {
  registry: PushRootRegistry;
  repository: string;
}): PushRootBinding | undefined {
  return registry.bindings.find((binding) => sameGithubRepository({ left: binding.repository, right: repository }));
}

/**
 * Add a binding. The same repository at the same root is a no-op that keeps the first record; a different root
 * refuses.
 *
 * @param registry the register as it stands
 * @param binding the binding to add
 * @returns the register to write, or the conflict
 */
export function recordPushRoot({
  registry,
  binding,
}: {
  registry: PushRootRegistry;
  binding: PushRootBinding;
}): Result<PushRootRegistry, PushRootConflictError> {
  const existing = pushRootForRepository({ registry, repository: binding.repository });
  if (existing === undefined) {
    return ok({ bindings: [...registry.bindings, binding] });
  }
  if (existing.rootSha === binding.rootSha) {
    return ok(registry);
  }
  return err(PushRootRegistryErrors.conflict({ existing, rootSha: binding.rootSha }));
}
