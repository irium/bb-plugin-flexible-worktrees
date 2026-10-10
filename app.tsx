import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { DEFAULT_PATH_TEMPLATE, inputsSchema, type Inputs, type RemoteChoices, type DestinationPreview } from "./inputs";
import { WorktreePicker, type Checkout } from "./WorktreePicker";
import { TemplateReference } from "./TemplateReference";
import type { rpcContract } from "./server";

function InputsForm(props: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [form, setForm] = useState<Inputs>(() => inputsSchema.safeParse(props.value ?? {}).data ?? inputsSchema.parse({}));
  const [choices, setChoices] = useState<Checkout[]>([]);
  const [remoteChoices, setRemoteChoices] = useState<RemoteChoices>({ branches: [], errors: [] });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteRefresh, setRemoteRefresh] = useState(0);
  const [pathTemplate, setPathTemplate] = useState(DEFAULT_PATH_TEMPLATE);
  const [preview, setPreview] = useState<{ key: string; value?: DestinationPreview; error?: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const hostId = props.target.kind === "existing-host" ? props.target.hostId : null;
  const previewKey = JSON.stringify([props.projectId, hostId, form, refresh]);
  const needsPreview = form.mode !== "existing" && Boolean(props.projectId && hostId);
  const currentPreview = preview?.key === previewKey ? preview : null;
  const previewLoading = needsPreview && inputsSchema.safeParse(form).success && !currentPreview;
  const previewError = needsPreview ? currentPreview?.error ?? "" : "";
  useEffect(() => {
    const parsed = inputsSchema.safeParse(form);
    onChange.current(!parsed.success ? { status: "blocked", reason: parsed.error.issues[0]!.message }
      : previewError ? { status: "blocked", reason: previewError }
      : previewLoading ? { status: "blocked", reason: "Resolving worktree destination…" }
      : { status: "ready", value: parsed.data });
  }, [form, previewError, previewLoading]);
  useEffect(() => {
    const parsed = inputsSchema.safeParse(form);
    if (!needsPreview || !parsed.success || !props.projectId || !hostId) return;
    let active = true;
    const projectId = props.projectId;
    const timer = setTimeout(() => {
      rpc.call("preview", { projectId, hostId, inputs: parsed.data }).then(value => {
        if (active) setPreview({ key: previewKey, value });
      }).catch(e => {
        if (active) setPreview({ key: previewKey, error: `Couldn’t resolve destination: ${String(e)}` });
      });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [previewKey]);
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(Boolean(props.projectId && hostId));
    if (props.projectId && hostId) {
      rpc.call("choices", { projectId: props.projectId, hostId }).then(result => {
        if (active) { setChoices(result.worktrees); setPathTemplate(result.pathTemplate); }
      }).catch(e => { if (active) setError(String(e)); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [props.projectId, hostId, refresh]);
  const remoteMode = form.mode === "remote-branch";
  useEffect(() => {
    if (!remoteMode || !props.projectId || !hostId) return;
    let active = true;
    setRemoteLoading(true);
    setRemoteChoices({ branches: [], errors: [] });
    rpc.call("remoteBranches", { projectId: props.projectId, hostId }).then(result => {
      if (active) setRemoteChoices(result);
    }).catch(() => {
      if (active) setRemoteChoices({ branches: [], errors: ["Couldn’t load remote branches. Check the connection and refresh."] });
    }).finally(() => { if (active) setRemoteLoading(false); });
    return () => { active = false; };
  }, [remoteMode, props.projectId, hostId, remoteRefresh]);
  return <WorktreePicker form={form} choices={choices} pathTemplate={pathTemplate}
    preview={currentPreview?.value ?? null} previewLoading={previewLoading} previewError={previewError} error={error} loading={loading}
    remoteChoices={remoteChoices} remoteLoading={remoteLoading} onRefreshRemote={() => setRemoteRefresh(n => n + 1)}
    onChange={setForm} onRefresh={() => setRefresh(n => n + 1)} />;
}
export default definePluginApp(app => {
  app.slots.settingsSection({
    id: "template-reference", title: "Template reference",
    component: TemplateReference,
  });
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: "flexible-worktrees",
    component: props => <InputsForm key={`${props.projectId}:${props.target.kind === "existing-host" ? props.target.hostId : "new"}`} {...props} />,
  });
});
