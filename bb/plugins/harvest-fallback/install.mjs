/**
 * Materializes this package as `node_modules/bb-plugin-harvest` in the plugin
 * that ran it, but only when the real one is not there.
 *
 * The plugins depend on the Harvest plugin by `file:` path. On a machine where
 * that checkout is absent, `npm install` leaves a dangling symlink and says
 * nothing — the failure surfaces much later, as an unresolvable import that
 * stops `bb plugin build` outright. Every sweep plugin already has a
 * fully-supported "Harvest unavailable" state; this makes the missing checkout
 * reach that state instead of the build.
 *
 * Run as a plugin's postinstall: `node ../harvest-fallback/install.mjs`.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(process.cwd(), "node_modules", "bb-plugin-harvest");

/**
 * True when `target` resolves to something with files in it.
 *
 * A dangling symlink is the case this exists for: `existsSync` follows links
 * and returns false, while `lstatSync` sees the link itself. Both have to be
 * checked, or the broken link is left in place and the copy never happens.
 */
function realPackagePresent() {
  if (!existsSync(target)) return false;
  try {
    return readdirSync(target).length > 0;
  } catch {
    return false;
  }
}

/** True when the copy already sitting there is this fallback, not the real one. */
function fallbackAlreadyInstalled() {
  return existsSync(join(target, ".harvest-fallback"));
}

if (realPackagePresent() && !fallbackAlreadyInstalled()) {
  process.exit(0);
}

// A dangling symlink has to go before anything can be written at the path.
try {
  if (lstatSync(target, { throwIfNoEntry: false })) rmSync(target, { force: true, recursive: true });
} catch {
  // Nothing there, or nothing removable. The copy below reports either way.
}

mkdirSync(target, { recursive: true });
for (const entry of readdirSync(here)) {
  if (entry === "install.mjs" || entry === "node_modules") continue;
  cpSync(join(here, entry), join(target, entry), { recursive: true });
}
// The marker that lets a later run tell its own copy from a real checkout, so
// the real package is picked up as soon as it appears.
cpSync(join(here, "package.json"), join(target, ".harvest-fallback"));

console.warn(
  "[harvest-fallback] bb-plugin-harvest is not checked out; " +
    "building without Harvest timers. Clone it to ~/projects/harvest-bb-plugin " +
    "and re-run npm install to restore them.",
);
