/**
 * The install's signing: mint the app's one identity the first time, sign every build with it, read the requirement
 * back, and clear macOS's grants when the requirement changed. Why: `../../../desktop/signing.ts`. Every effect goes
 * through {@link InstallSeams}.
 *
 * The keychain is a file of its own with an empty password, never added to the owner's keychain search list, so signing
 * raises no prompt and nothing else on the Mac sees the key. Its protection is the file's mode (0600), the same as
 * every secret in the state home. Measured on this sequence: no prompt, the electron-builder
 * entitlements kept, `codesign --verify --deep --strict` passing, `security list-keychains -d user` unchanged.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { type DesktopInstallError, DesktopInstallErrors } from "../../../desktop/errors.js";
import { BUNDLE_ID } from "../../../desktop/installPlan.js";
import {
  certificateArgs,
  certificateSha1,
  designatedRequirement,
  identityRequirement,
  recordedRequirement,
  SIGNING_NAME,
} from "../../../desktop/signing.js";
import { attempt } from "./installProcess.js";
import type { InstallSeams, ProgramCall } from "./installSeams.js";

/** One file step of the signing or the grant record, a throw turned into the words that say what failed — never the install's REPLACE_FAILED, which names the app. */
function fileStep<T>({ act, what }: { act: () => T; what: string }): Result<T> {
  try {
    return ok(act());
  } catch (cause) {
    return err([`${what}: ${cause instanceof Error ? cause.message : "refused"}`]);
  }
}

/** The keychain tool. */
const SECURITY = "/usr/bin/security";

/** The program runs that make the keychain and put the identity in it, in order. */
function mintCalls({
  keychain,
  keyPath,
  certPath,
}: {
  keychain: string;
  keyPath: string;
  certPath: string;
}): readonly ProgramCall[] {
  return [
    { args: certificateArgs({ certPath, keyPath }), command: "/usr/bin/openssl" },
    { args: ["create-keychain", "-p", "", keychain], command: SECURITY },
    { args: ["600", keychain], command: "/bin/chmod" },
    // No settings: the keychain never locks itself on a timeout or on sleep.
    { args: ["set-keychain-settings", keychain], command: SECURITY },
    { args: ["unlock-keychain", "-p", "", keychain], command: SECURITY },
    { args: ["import", keyPath, "-k", keychain, "-T", "/usr/bin/codesign"], command: SECURITY },
    { args: ["import", certPath, "-k", keychain], command: SECURITY },
    { args: ["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", "", keychain], command: SECURITY },
  ];
}

/** Make the keychain and its identity; a keychain left half made is deleted, so the next run mints afresh. */
function mint({ seams, keychain }: { seams: InstallSeams; keychain: string }): Result<void, DesktopInstallError> {
  const folder = fileStep({ act: () => seams.tempFolder(), what: "could not make a temporary folder for the key" });
  if (folder.isErr()) {
    return err(DesktopInstallErrors.signingFailed({ detail: folder.error.join("; "), keychain }));
  }
  let failed: string | undefined;
  try {
    const calls = mintCalls({
      certPath: join(folder.value, "cert.pem"),
      keyPath: join(folder.value, "key.pem"),
      keychain,
    });
    for (const call of calls) {
      const ran = seams.run(call);
      if (ran.isErr()) {
        failed = ran.error.message;
        break;
      }
    }
  } finally {
    // The key's only copy outside the keychain goes whatever happened.
    attempt({
      act: () => {
        seams.remove({ path: folder.value });
      },
      what: "could not delete the temporary key",
    });
  }
  if (failed === undefined) {
    seams.out({ line: `signing: minted the app's own identity in ${keychain}` });
    return ok(undefined);
  }
  // `delete-keychain` also drops it from the search list should macOS ever have added it; the remove covers a file
  // `security` no longer recognises. Either failing leaves a file the next run's `find-certificate` refuses by name.
  seams.run({ args: ["delete-keychain", keychain], command: SECURITY });
  attempt({
    act: () => {
      seams.remove({ path: keychain });
    },
    what: "could not delete the half-made keychain",
  });
  return err(DesktopInstallErrors.signingFailed({ detail: failed, keychain }));
}

/**
 * The identity every build is signed with, minted the first time and unlocked every time.
 *
 * @param keychain the keychain file holding it
 * @returns the certificate's SHA-1, or SIGNING_FAILED
 */
export function signingIdentity({
  seams,
  keychain,
}: {
  seams: InstallSeams;
  keychain: string;
}): Result<string, DesktopInstallError> {
  if (!seams.exists({ path: keychain })) {
    const minted = mint({ keychain, seams });
    if (minted.isErr()) {
      return err(minted.error);
    }
  }
  const failed = ({ detail }: { detail: string }): Result<string, DesktopInstallError> =>
    err(DesktopInstallErrors.signingFailed({ detail, keychain }));
  const unlocked = seams.run({ args: ["unlock-keychain", "-p", "", keychain], command: SECURITY });
  if (unlocked.isErr()) {
    return failed({ detail: unlocked.error.message });
  }
  const found = seams.run({ args: ["find-certificate", "-c", SIGNING_NAME, "-Z", keychain], command: SECURITY });
  if (found.isErr()) {
    return failed({ detail: found.error.message });
  }
  const sha1 = certificateSha1({ text: found.value });
  if (sha1 === undefined) {
    return failed({ detail: `the keychain names no SHA-1 for ${SIGNING_NAME}` });
  }
  return ok(sha1);
}

/**
 * A bundle's designated requirement as codesign reads it.
 *
 * @param bundle the app bundle
 * @returns the requirement, or `undefined` when there is no bundle there or codesign could not read one
 */
export function bundleRequirement({ seams, bundle }: { seams: InstallSeams; bundle: string }): string | undefined {
  if (!seams.exists({ path: bundle })) {
    return undefined;
  }
  const read = seams.run({ args: ["-d", "-r-", bundle], command: "/usr/bin/codesign" });
  if (read.isErr()) {
    return undefined;
  }
  return designatedRequirement({ text: read.value });
}

/**
 * Sign the build with the identity — every nested helper and framework too, the entitlements electron-builder gave
 * it kept — and read the requirement back, so an ad-hoc build is never installed unnoticed.
 *
 * @param bundle the built Slopweaver.app
 * @param keychain the keychain the identity is in
 * @param sha1 the identity's certificate
 * @returns the requirement the build now carries, or SIGNING_FAILED
 */
export function signBundle({
  seams,
  bundle,
  keychain,
  sha1,
}: {
  seams: InstallSeams;
  bundle: string;
  keychain: string;
  sha1: string;
}): Result<string, DesktopInstallError> {
  const signed = seams.run({
    args: ["--force", "--deep", "--preserve-metadata=entitlements", "--sign", sha1, "--keychain", keychain, bundle],
    command: "/usr/bin/codesign",
  });
  if (signed.isErr()) {
    return err(DesktopInstallErrors.signingFailed({ detail: signed.error.message, keychain }));
  }
  const expected = identityRequirement({ sha1 });
  const carried = bundleRequirement({ bundle, seams });
  if (carried === undefined) {
    return err(
      DesktopInstallErrors.signingFailed({ detail: `the signed build's requirement could not be read`, keychain }),
    );
  }
  if (carried !== expected) {
    return err(
      DesktopInstallErrors.signingFailed({
        detail: `the signed build's requirement reads ${carried}, not ${expected}`,
        keychain,
      }),
    );
  }
  return ok(carried);
}

/**
 * The requirement the app's grants were last cleared for, as recorded. An unreadable record is said, and counts as
 * none: the cost is one more ask per permission, never a stale grant kept.
 *
 * @param record the file the requirement is recorded in
 * @returns the requirement, or `undefined` when none is recorded or the record cannot be read
 */
export function grantedRequirement({ seams, record }: { seams: InstallSeams; record: string }): string | undefined {
  const read = fileStep({
    act: () =>
      seams.exists({ path: record }) ? recordedRequirement({ text: seams.readText({ path: record }) }) : undefined,
    what: `could not read ${record}`,
  });
  if (read.isErr()) {
    seams.out({ line: `permissions: ${read.error.join("; ")}, so the app's macOS grants are cleared once more` });
    return undefined;
  }
  return read.value;
}

/**
 * Clear every grant macOS holds for the app — Microphone, System Audio Recording, Screen Recording, Automation — once its requirement has
 * changed: each is pinned to the old one, so Settings would show it on while macOS refused the new build. Run while
 * no copy is open, before the new build's first launch asks for anything. Never fatal, and never recorded here: the
 * clear is recorded by {@link recordGrantClear} only once the new build is kept, so a failed clear, or a rollback that
 * put an old build back to be granted afresh, leaves the clear owed by the next install.
 *
 * @returns the line to print, and whether the grants were cleared
 */
export function resetGrants({ seams }: { seams: InstallSeams }): { readonly line: string; readonly cleared: boolean } {
  const reset = seams.run({ args: ["reset", "All", BUNDLE_ID], command: "/usr/bin/tccutil" });
  if (reset.isErr()) {
    return {
      cleared: false,
      line:
        `permissions: could not clear the old build's macOS grants (${reset.error.message}), so the next install ` +
        "tries again — meanwhile, if the voice cannot see the screen while Settings shows Slopweaver on, remove it " +
        "under Privacy & Security › Screen & System Audio Recording with − and let the next look ask",
    };
  }
  return {
    cleared: true,
    line: "permissions: the app's signature changed, so its old macOS grants were cleared — the microphone, System Audio Recording and Screen Recording are asked for once more, then kept across rebuilds",
  };
}

/**
 * Record that the grants were cleared for the build now kept installed.
 *
 * @param requirement the kept build's requirement
 * @param record the file it is recorded in
 * @returns a line to print when the record could not be written, else `undefined`
 */
export function recordGrantClear({
  seams,
  requirement,
  record,
}: {
  seams: InstallSeams;
  requirement: string;
  record: string;
}): string | undefined {
  const written = fileStep({
    act: () => {
      seams.writeText({ path: record, text: `${requirement}\n` });
    },
    what: `could not record the cleared requirement in ${record}`,
  });
  if (written.isOk()) {
    return undefined;
  }
  return `permissions: ${written.error.join("; ")}, so the next install clears the grants once more`;
}
