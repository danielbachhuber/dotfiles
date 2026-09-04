import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocSource } from "../sources.js";
import type { DocRef } from "../types.js";
import { run } from "./shell.js";

/**
 * Caches each reference doc's text next to the week's data, so an agent
 * preparing the journal entry can read them without re-hitting the API.
 * Pulling "open threads" out of them is a judgment call left to the agent.
 */
export async function fetchDocs(
  weekDir: string,
  config: { docs: DocSource[]; fetchDocScript: string },
): Promise<DocRef[]> {
  const cacheDir = join(weekDir, "docs");
  await mkdir(cacheDir, { recursive: true });

  // Sequential: gws holds a single keyring session, and parallel calls contend on it.
  const out: DocRef[] = [];
  for (const doc of config.docs) {
    const ref: DocRef = {
      id: doc.id,
      label: doc.label,
      url: `https://docs.google.com/document/d/${doc.id}/edit`,
    };
    try {
      const text = await run(config.fetchDocScript, [doc.id]);
      const name = `${slug(doc.label)}.txt`;
      await writeFile(join(cacheDir, name), text, "utf8");
      ref.cachedPath = join("docs", name);
    } catch (err: any) {
      ref.error = err?.message ?? String(err);
    }
    out.push(ref);
  }

  // A per-doc error alone shouldn't fail the source, but every doc failing is an
  // auth or connectivity problem, and the page must not call that "ok".
  const failed = out.filter((doc) => doc.error !== undefined);
  if (failed.length === out.length && out.length > 0) {
    throw new Error(`all ${out.length} docs failed — ${failed[0].error}`);
  }
  return out;
}

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
