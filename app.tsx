import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc, type PluginEnvironmentProviderInputsProps } from "@get-bb/plugin-sdk/app";
import { inputsSchema, type Inputs, type RemoteChoices } from "./inputs";
import { WorktreePicker, type Checkout } from "./WorktreePicker";
import type { rpcContract } from "./server";

function InputsForm(props: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [form, setForm] = useState<Inputs>(() => inputsSchema.safeParse(props.value ?? {}).data ?? inputsSchema.parse({}));
  const [choices, setChoices] = useState<Checkout[]>([]);
  const [remoteChoices, setRemoteChoices] = useState<RemoteChoices>({ branches: [], errors: [] });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteRefresh, setRemoteRefresh] = useState(0);
  const [root, setRoot] = useState("~/dev/worktrees/{repo}");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const hostId = props.target.kind === "existing-host" ? props.target.hostId : null;
  useEffect(() => {
    const parsed = inputsSchema.safeParse(form);
    onChange.current(parsed.success ? { status: "ready", value: parsed.data } : { status: "blocked", reason: parsed.error.issues[0]!.message });
  }, [form]);
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(Boolean(props.projectId && hostId));
    if (props.projectId && hostId) {
      rpc.call("choices", { projectId: props.projectId, hostId }).then(result => {
        if (active) { setChoices(result.worktrees); setRoot(result.defaultRoot); }
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
  return <WorktreePicker form={form} choices={choices} defaultRoot={root} error={error} loading={loading}
    remoteChoices={remoteChoices} remoteLoading={remoteLoading} onRefreshRemote={() => setRemoteRefresh(n => n + 1)}
    onChange={setForm} onRefresh={() => setRefresh(n => n + 1)} />;
}
export default definePluginApp(app => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: "flexible-worktrees",
    component: props => <InputsForm key={`${props.projectId}:${props.target.kind === "existing-host" ? props.target.hostId : "new"}`} {...props} />,
  });
});
