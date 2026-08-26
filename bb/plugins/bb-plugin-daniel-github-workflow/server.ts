import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MIGRATIONS } from "./shared/store.js";
import { registerPullRequests } from "./prs/register.js";

export { rpcContract } from "./prs/contract.js";

/**
 * Wiring only. Each domain registers its own sweep, rpc methods and links; the
 * settings and the database are shared, which is the whole point of the merge.
 */
export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    syncIntervalMinutes: {
      type: "select",
      label: "Sync interval (minutes)",
      options: ["2", "5", "15"],
      default: "5",
    },
    ghPath: {
      type: "string",
      label: "Path to the gh CLI",
      default: "gh",
    },
    modelByAction: {
      type: "string",
      label: "Model by action",
      experimental_multiline: true,
      // A JSON object keyed by flag: {"conflict": "claude-sonnet-5"}.
      // An unlisted flag takes the provider's default model. Blank restores
      // the defaults.
      default: '{\n  "conflict": "claude-sonnet-5"\n}',
    },
    permissionMode: {
      type: "select",
      label: "Permission mode for spawned threads",
      // accept-edits sandboxes the workspace and routes every escalation to
      // the user, so a thread stops at its first shell command. auto keeps
      // that same sandbox with automatic approval, which is enough to do the
      // work but not to finish it: the sandbox blocks network egress, so the
      // commit lands and the push fails with a proxy authentication error.
      // full bypasses the sandbox and the approval, and is the only mode that
      // carries a resolution through to the PR unattended.
      options: ["accept-edits", "auto", "full"],
      default: "full",
    },
    providerId: {
      type: "string",
      label: "Provider for spawned threads",
      // The skills these prompts route to (resolve-merge-conflicts,
      // address-code-review, pr-sweep) are Claude Code user skills, so they
      // are invisible to a thread running on any other provider. Spawning on
      // bb's default provider produced threads that reported the skill "was
      // not installed" and improvised the workflow instead. Blank falls back
      // to bb's default.
      default: "claude-code",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, MIGRATIONS);

  registerPullRequests(bb, settings, db as never);
}
