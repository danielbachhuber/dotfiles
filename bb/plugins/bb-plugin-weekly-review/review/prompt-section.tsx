// The interpretation prompt, editable on this plugin's page in Tools.
//
// It is the user's own writing about their own work, so it lives in the
// plugin's database beside the sources rather than in a settings string.
import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import type { PromptKind } from "./contract.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";

export function PromptSection({
  kind,
  placeholders,
}: {
  kind: PromptKind;
  placeholders: string;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((next: { prompt: string; isDefault: boolean }) => {
    setPrompt(next.prompt);
    setIsDefault(next.isDefault);
    setDraft(next.prompt);
  }, []);

  useEffect(() => {
    rpc.call("prompt_get", { kind }).then(apply, (cause) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc, apply, kind]);

  const save = async (next: string) => {
    setSaving(true);
    setError(null);
    try {
      apply(await rpc.call("prompt_set", { kind, prompt: next }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  if (prompt === null) {
    return <p className="text-sm text-muted-foreground">Loading the prompt…</p>;
  }

  const dirty = draft !== prompt;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{placeholders}</p>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        rows={18}
        spellCheck={false}
        aria-label="Interpretation prompt"
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <Button onClick={() => void save(draft)} disabled={saving || !dirty}>
          <Icon name="Check" className="size-4" />
          Save
        </Button>
        <Button variant="ghost" onClick={() => setDraft(prompt)} disabled={saving || !dirty}>
          Discard
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => void save("")}
          disabled={saving || isDefault}
        >
          <Icon name="RotateCcw" className="size-4" />
          Restore default
        </Button>
        <span className="text-xs text-muted-foreground">
          {dirty ? "Unsaved" : isDefault ? "Default" : "Edited"}
        </span>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
