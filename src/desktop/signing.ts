/**
 * The signing identity every install of the desktop app carries, as pure decisions over what the install read.
 *
 * Why it exists, measured: an ad-hoc signed app's designated requirement IS its cdhash, which changes on
 * every rebuild. macOS keeps a Screen Recording grant as a row naming the bundle id AND the requirement of the build
 * the owner granted, so System Settings showed Slopweaver ON while tccd refused the new build and asked again — and
 * the owner's toggling off and on rewrote the row's state, never its requirement. Re-check it with
 * `codesign -d -r- /Applications/Slopweaver.app` (an ad-hoc build prints `designated => cdhash H"…"`).
 *
 * So every install is signed with ONE self-signed certificate kept in a keychain file of its own, whose requirement
 * — `identifier "<bundle id>" and certificate leaf = H"<sha1>"` — is the same on every rebuild, and whenever the
 * requirement does change (the first signed install, a lost keychain) the install clears every macOS grant pinned to
 * the old one, so the next ask is a real one rather than a toggle that does nothing. The effects are
 * `cli/commands/desktop/installSigning.ts`'s.
 */
import { BUNDLE_ID } from "./installPlan.js";

/** The certificate's common name, which the keychain is searched by. */
export const SIGNING_NAME = "Slopweaver Local Signing";

/**
 * How long the certificate is valid. Past it a new one is NOT minted by itself: the install fails at the signing
 * step, and deleting the keychain file mints a fresh one (one more ask per permission).
 */
const SIGNING_DAYS = 3650;

/**
 * The `/usr/bin/openssl` (LibreSSL) arguments that mint the key and its certificate: a code-signing leaf, never a CA.
 *
 * @param keyPath where the private key is written, in a temporary folder deleted straight after
 * @param certPath where the certificate is written, beside it
 * @returns the argv after the program name
 */
export function certificateArgs({ keyPath, certPath }: { keyPath: string; certPath: string }): readonly string[] {
  return [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    String(SIGNING_DAYS),
    "-subj",
    `/CN=${SIGNING_NAME}`,
    "-addext",
    "basicConstraints=critical,CA:false",
    "-addext",
    "keyUsage=critical,digitalSignature",
    "-addext",
    "extendedKeyUsage=critical,codeSigning",
  ];
}

/**
 * The certificate's SHA-1, from `security find-certificate -Z`, which is what `codesign --sign` and the requirement
 * both name it by.
 *
 * @param text what `security find-certificate -c <name> -Z <keychain>` printed
 * @returns forty uppercase hex digits, or `undefined` when the output carries no SHA-1 line
 */
export function certificateSha1({ text }: { text: string }): string | undefined {
  const match = /^SHA-1 hash: ([0-9A-F]{40})$/mu.exec(text);
  return match?.[1];
}

/**
 * The designated requirement, from `codesign -d -r- <bundle>`'s stdout, which prefixes it `# designated => `.
 *
 * @param text what codesign printed
 * @returns the requirement after the arrow, or `undefined` when there is none
 */
export function designatedRequirement({ text }: { text: string }): string | undefined {
  const line = text.split("\n").find((each) => each.includes("designated => "));
  if (line === undefined) {
    return undefined;
  }
  return line.slice(line.indexOf("designated => ") + "designated => ".length).trim();
}

/**
 * The requirement a build signed by the identity carries — the one a grant made to it is pinned to.
 *
 * @param sha1 the certificate's SHA-1, as {@link certificateSha1} read it
 * @returns the requirement, in the spelling codesign prints
 */
export function identityRequirement({ sha1 }: { sha1: string }): string {
  return `identifier "${BUNDLE_ID}" and certificate leaf = H"${sha1.toLowerCase()}"`;
}

/**
 * The requirement the install last cleared the app's grants for, from the file it records that in.
 *
 * @param text the file's contents
 * @returns the requirement, or `undefined` when the file is empty
 */
export function recordedRequirement({ text }: { text: string }): string | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Whether the grants macOS holds for the app must be cleared before the new build opens: whenever the last clear
 * that SUCCEEDED was for a different requirement, or none is recorded — the first signed install included, since a
 * grant can outlive the build it was made to, and a stale one is exactly what Settings shows as on while refusing.
 * The record alone is not enough, so the build being replaced is read too: an old build put back by a later run's
 * recovery, or installed by an older checkout's install that writes no record, may have been granted under its own
 * requirement while the record still names the identity. Either signal clears; an unread replaced build is no signal,
 * since the record already covers a build this install made.
 *
 * @param recorded the requirement the grants were last cleared for, `undefined` when none is recorded
 * @param replaced the requirement of the build being replaced, `undefined` when there is none or it could not be read
 * @param next the new build's requirement
 * @returns true when the grants are to be cleared
 */
export function grantsNeedReset({
  recorded,
  replaced,
  next,
}: {
  recorded: string | undefined;
  replaced: string | undefined;
  next: string;
}): boolean {
  if (recorded !== next) {
    return true;
  }
  return replaced !== undefined && replaced !== next;
}
