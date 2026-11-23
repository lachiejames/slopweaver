/**
 * The one spelling of the per-root mirror key, shared by every test that checks the two files carrying it.
 *
 * `hooks/hooks.json` is static text that can only substitute a variable, and `scripts/plugin-mirror-sync.sh`
 * has to compute the SAME directory in shell. Nothing at runtime compares them — a seat whose two halves
 * disagree simply looks for its mirror where nobody built one and every hook exits 127, non-blocking and
 * silent, which is the failure it is meant to prevent. So the comparison is a test, and this constant
 * is the third party both are checked against rather than each being checked against the other.
 */

/**
 * The raw environment expression that names a seat's plugin root, spelled as both files spell it.
 *
 * The RAW value, never `resolve_plugin_root`'s answer: that helper deliberately falls back when the variable
 * names a directory that no longer exists, and a fallback the static `hooks.json` cannot reproduce is a key
 * mismatch by construction.
 */
export const MIRROR_KEY_EXPRESSION = "${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-/_unkeyed}}";

/** The path component every mirrored hook command carries, under which each root gets its own tree. */
export const MIRROR_KEYED_PREFIX = `/mirror/by-root${MIRROR_KEY_EXPRESSION}/current/`;
