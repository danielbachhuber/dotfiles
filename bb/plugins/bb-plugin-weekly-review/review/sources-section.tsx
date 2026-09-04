// The sources editor, rendered on this plugin's page in Tools.
//
// It is here rather than in bb's declarative settings because what a week is
// gathered from identifies a person — a repository, a username, a list of 1:1
// documents — and that belongs in the plugin's database, which bb keeps
// outside the checkout.
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { DocSource } from "./sources.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

type Sources = {
  repo: string;
  author: string;
  harvestProjectId: string;
  docs: DocSource[];
};

const FIELDS = [
  {
    key: "repo" as const,
    label: "GitHub repository",
    placeholder: "owner/name",
    hint: "Pull requests, reviews, and issues are scoped to this repository.",
  },
  {
    key: "author" as const,
    label: "GitHub username",
    placeholder: "octocat",
    hint: "Whose authorship, reviews, and assignments count as yours.",
  },
  {
    key: "harvestProjectId" as const,
    label: "Harvest project id",
    placeholder: "Every project",
    hint: "Leave blank to gather time entries across all projects.",
  },
];

export function SourcesSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [sources, setSources] = useState<Sources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [docId, setDocId] = useState("");
  const [docLabel, setDocLabel] = useState("");

  const report = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause));
  }, []);

  useEffect(() => {
    rpc.call("sources_get", null).then(setSources, report);
  }, [rpc, report]);

  const save = useCallback(
    async (patch: Partial<Sources>) => {
      setSaving(true);
      setError(null);
      try {
        setSources(await rpc.call("sources_set", patch));
      } catch (cause) {
        report(cause);
      } finally {
        setSaving(false);
      }
    },
    [rpc, report],
  );

  const addDoc = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = docId.trim();
    if (id === "" || sources === null) return;
    void save({
      docs: [...sources.docs, { id, label: docLabel.trim() === "" ? id : docLabel.trim() }],
    });
    setDocId("");
    setDocLabel("");
  };

  if (sources === null) {
    return <p className="text-sm text-muted-foreground">Loading sources…</p>;
  }

  return (
    <div className="space-y-4">
      {FIELDS.map((field) => (
        <div key={field.key} className="space-y-1">
          <label
            htmlFor={`weekly-review-${field.key}`}
            className="text-sm font-medium text-foreground"
          >
            {field.label}
          </label>
          <Input
            id={`weekly-review-${field.key}`}
            defaultValue={sources[field.key]}
            placeholder={field.placeholder}
            // Saved on blur rather than per keystroke: each save is a database
            // write and a status recheck.
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next !== sources[field.key]) void save({ [field.key]: next });
            }}
          />
          <p className="text-xs text-muted-foreground">{field.hint}</p>
        </div>
      ))}

      <div className="space-y-1">
        <span className="text-sm font-medium text-foreground">Reference docs</span>
        <p className="text-xs text-muted-foreground">
          Cached as text beside each week, so an agent can read them without re-fetching.
        </p>
        {sources.docs.length === 0 ? null : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card px-3">
            {sources.docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{doc.label}</span>
                <span className="hidden shrink-0 truncate font-mono text-xs text-muted-foreground sm:block sm:max-w-48">
                  {doc.id}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${doc.label}`}
                  disabled={saving}
                  onClick={() =>
                    void save({ docs: sources.docs.filter((other) => other.id !== doc.id) })
                  }
                >
                  <Icon name="Trash2" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addDoc} className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            value={docId}
            onChange={(event) => setDocId(event.target.value)}
            placeholder="Google Doc id"
            aria-label="Google Doc id"
            className="w-56"
          />
          <Input
            value={docLabel}
            onChange={(event) => setDocLabel(event.target.value)}
            placeholder="Label"
            aria-label="Label"
            className="w-40"
          />
          <Button type="submit" variant="outline" disabled={saving || docId.trim() === ""}>
            <Icon name="Plus" className="size-4" />
            Add
          </Button>
        </form>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
