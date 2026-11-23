/**
 * Which credential SHAPE one field name is exempt from, named one field at a time.
 *
 * ## Why an exemption mechanism exists at all
 *
 * Device-inventory fields that look like keys but are not keys would keep this atlas permanently
 * unpublishable, so the owner's rule is an exemption: there is no reason to treat something as a sensitive
 * credential and take all the care that implies when it is not one. A bare name set cannot say WHICH shape a
 * field is exempt from — every entry would silently narrow the forty-hex rule and nothing else, so the first
 * field that needed an exemption from a different shape would have nowhere to go. This file is the mechanism
 * that says it, and it sits beside `sensitiveFields.ts` for the same reason that
 * file exists: a judgement about a provider's own field names belongs somewhere a reader can audit in one
 * screen, apart from the walk that applies it.
 *
 * ## The rule: exempt by NAME and by SHAPE, never by widening a pattern
 *
 * Anchoring the forty-hex shape to a whole value — so a hash inside a longer string stops matching — was
 * tried when the certificate fields were added and REJECTED, and it stays rejected. It would admit a key
 * pasted into a description and a key wrapped in underscores, both of which `sensitivity.ts`'s own tests
 * pin, and both of which are real leak routes. Narrowing by field costs one name and one shape; narrowing
 * by shape costs the detection everywhere it still works.
 *
 * So an entry here is the smallest exemption that clears the observed hit: the exact field, the exact shape
 * that fired on it, and nothing more. A PEM block, a JWT, or any shape not listed for that field still
 * refuses the whole generation at that position, and the same value under any other name still does.
 *
 * ## Why it is not a pattern over field names
 *
 * For the reason `sensitiveFields.ts` gives in the other direction. A pattern over `*_key_id` would quietly
 * admit whatever JumpCloud calls its next key field, and the list has to stay short enough that a reader
 * can weigh every line of it against the value it is giving up.
 *
 * ## What is deliberately NOT here
 *
 * **`path` is NOT exempt from the AWS access key id shape, and the reason is the whole argument for saying
 * SHAPE as well as field.** A hit there is easy to misread as another benign build id, and it is not one.
 * `GET /api/v2/systeminsights/services` returns a Windows service's full COMMAND LINE in `path`, and any
 * service wrapper launched with credentials passed as `--env` arguments can carry an AWS key pair there.
 * Exempting the field would let such a key pair into a world-readable generation, and only one half of it
 * has a shape any scanner can see.
 *
 * So an exemption is earned by READING the values that fired, never by the field looking innocent. A
 * process command line is not a filesystem path, whatever the provider calls the column.
 *
 * A device-management policy `value` is refused for the neighbouring reason. One can legitimately BE a
 * credential, an MDM profile being a normal place to ship one, so nothing here can tell a benign one from
 * a real one.
 */

/**
 * The closed vocabulary of shape names, so the table below and `sensitivity.ts`'s pattern table cannot
 * drift apart.
 *
 * A typo on either side would otherwise be silent in the worst direction available: an exemption naming a
 * shape that does not exist never fires, so the gate keeps refusing and the atlas keeps not publishing,
 * with nothing anywhere saying why. Spelling the names once as a union makes that a compile error.
 * @internal
 */
export type JumpcloudCredentialShapeName =
  "PEM private key block" | "OpenSSH private key" | "JSON Web Token" | "JumpCloud API key" | "AWS access key id";

/**
 * Every exemption this atlas holds, with the measurement that earned each one.
 *
 * MEASURED against the live tenancy, reproduced against the resume journal a walk leaves behind:
 *
 * ```bash
 * slopweaver atlas jumpcloud sync   # and read the refusals it prints
 * ```
 *
 * - `sha1`, `subject_key_id`, `authority_key_id` — `GET /api/v2/systeminsights/certificates` returns all
 *   three as forty hex characters, which is exactly the JumpCloud API key shape, on every certificate row
 *   a walk reads. Without the exemption System Insights is permanently unsyncable, which is the opposite of
 *   the completeness this atlas exists for.
 * - `path` — `GET /api/v2/systeminsights/apps` returns filesystem paths whose segments are build hashes, a
 *   Raycast update directory named after a forty-hex commit among them. A device inventory is full of
 *   paths and none of THOSE is a secret. The forty-hex shape only, and the next entry says why.
 * - `udid` — `GET /api/v2/applemdms/{id}/devices` returns an Apple device UDID, which on older hardware is
 *   exactly forty hex characters. A device identifier the vendor prints in its own console is not a
 *   credential, and without this the Apple MDM family alone kept the whole generation refused.
 * - `bundle_version`, `info_string` — `GET /api/v2/systeminsights/apps` returns a macOS bundle's
 *   `CFBundleVersion` and `CFBundleGetInfoString`, and an application built from source sets both to its
 *   own commit. Measured over a walk, the hex values run from an abbreviated commit up to a full
 *   forty-character one, which is what a git describe looks like and is not what any credential looks
 *   like. Reproduce the distribution over a walk's journal with:
 *
 *   ```bash
 *   python3 -c "import json,re,collections; c=collections.Counter(); [c.update([len(r['bundle_version'])]) for l in open('$SLOPWEAVER_HOME/atlas/jumpcloud/_resume.jsonl') for r in (json.loads(l).get('records') or []) if isinstance(r,dict) and re.fullmatch(r'[0-9a-f]{7,}', str(r.get('bundle_version','')))]; print(sorted(c.items()))"
 *   ```
 *
 * MEASURED, and it is the entry that most needed its values read rather than its name trusted:
 *
 * - `downloadUrl` — `GET /api/v2/software/catalog/apps/{objectId}` returns each catalogued application's
 *   PUBLIC vendor download link under each `softwareApp/settings` entry, and some of those links carry a
 *   build hash that is forty hex characters. Read across every catalog item a walk listed, the ones that
 *   fired were ordinary public URLs, one under `www.sweetscape.com` and one under
 *   `ardownload2.adobe.com`, beside unrefused ones at `downloads.1password.com` and `static.airtable.com`.
 *   Nothing there is this organisation's. This one operation kept the whole generation refused, and it only
 *   became reachable at all once the page-size negotiation let its parent collection list.
 *
 *   **The residue, stated rather than discovered.** A download URL is a field that COULD one day carry a
 *   signed token, and a signed token of exactly forty hex would now pass here. That is a narrower hole than
 *   it sounds and it is worth naming precisely. The exemption is the forty-hex shape ALONE, so a JWT or a
 *   PEM at the same field still refuses the generation; the value that matters most, this install's own
 *   API key, is matched VERBATIM against `knownSecrets` and never through a shape, so no exemption here can
 *   admit it; and the alternative — denying the field in `sensitiveFields.ts` — was considered and rejected
 *   because a public vendor link is not secret material, and filing it as such would tell the next reader
 *   something false about why it is missing.
 */
const SHAPE_EXEMPT_FIELDS: ReadonlyMap<string, ReadonlySet<JumpcloudCredentialShapeName>> = new Map([
  ["authority_key_id", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["bundle_version", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["downloadUrl", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["info_string", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["path", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["sha1", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["subject_key_id", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
  ["udid", new Set<JumpcloudCredentialShapeName>(["JumpCloud API key"])],
]);

/**
 * Whether one shape is exempt at one field, so a value that merely LOOKS like a key is not treated as one.
 *
 * @param field the provider's own property name the value sits under; a value not under a field — an
 * object KEY, or the document root — is never exempt, because nothing named it
 * @param shape which credential shape fired at that position
 * @returns `true` when the whole generation must NOT be refused over this pair
 */
export function isJumpcloudShapeExempt({
  field,
  shape,
}: {
  field: string | undefined;
  shape: JumpcloudCredentialShapeName;
}): boolean {
  if (field === undefined) {
    return false;
  }
  return SHAPE_EXEMPT_FIELDS.get(field)?.has(shape) === true;
}
