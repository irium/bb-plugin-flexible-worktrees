import { expect, it, vi } from "vitest";
import { createFakePluginHost, makeMessageDispatchHookContext, makeThreadResponse, makeHostResponse, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { inputsSchema } from "./contract";

it("registers retention policy and makes cleanup non-destructive", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flexible-worktrees" });
  plugin(bb);
  const provider = harness.registrations.environmentProviders.get("flexible-worktrees")!;
  expect(provider.policy.retireGraceMs).toBeNull();
  expect(await provider.remove({ environment: null, hostId: null, path: null, pathKey: "key", resource: null, attempt: 1, report: { step() {}, log() {} }, signal: new AbortController().signal })).toEqual({ status: "removed" });
  expect(harness.experimental_hostRpcCalls).toHaveLength(0);
  await harness.lifecycle.dispose();
});

it.each(["existing", "remote-branch"])("claims the canonical path before allowing mutations in %s mode", async mode => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flexible-worktrees",
    experimental_callHostRpc: async ({ method }) => {
      if (method !== "plan") throw new Error("Must not mutate when claim failed");
      return { mode, source: "/repo", path: "/canonical/repo", branch: "", base: "", pathKey: "key" };
    },
  });
  plugin(bb);
  const fixture = makeMessageDispatchHookContext();
  const claim = vi.fn(async () => false);
  const result = await harness.registrations.environmentProviders.get("flexible-worktrees")!.create({
    project: fixture.project!, host: makeHostResponse(), projectCheckout: { path: "/repo", experimental_ownsPath: false },
    gitRemote: null, inputs: inputsSchema.parse({ mode, checkout: "/repo", remoteBranch: "colleague/review" }),
    thread: makeThreadResponse(), suggestedBranchName: "bb/test", attempt: 1, pathKey: "key", rebuild: false,
    previous: null, experimental_claimPath: claim, report: { step() {}, log() {} }, signal: new AbortController().signal,
  });
  expect(result.status).toBe("failed");
  expect(claim).toHaveBeenCalledWith("/canonical/repo");
  await harness.lifecycle.dispose();
});

it("uses project defaults consistently for choices, preview, and creation on the selected host", async () => {
  const fixture = makeMessageDispatchHookContext();
  const host = makeHostResponse();
  const project = { ...fixture.project!, gitRemoteUrl: "git@github.com:team/repo.git", sources: [
    { id: "source-other", projectId: fixture.project!.id, hostId: host.id, isDefault: false, path: "/other", type: "local_path" as const, createdAt: 0, updatedAt: 0 },
    { id: "source-default", projectId: fixture.project!.id, hostId: host.id, isDefault: true, path: "/repo", type: "local_path" as const, createdAt: 0, updatedAt: 0 },
  ] };
  const planned = { mode: "new-branch" as const, source: "/repo", path: "/resolved/feature", branch: "feature", base: "HEAD", pathKey: "key" };
  const { bb, harness } = createFakePluginHost({
    pluginId: "flexible-worktrees",
    settings: { pathTemplate: "~/global/{branch}", projectOverrides: '{"github.com/team/*":"~/team/{repo}.{branch}"}' },
    sdk: { projects: { get: async () => project } },
    experimental_callHostRpc: async ({ method }) => {
      if (method === "list") return [{ path: "/repo", branch: "main" }];
      if (method === "preview") return { path: planned.path, root: "/resolved", folder: "feature", automaticBranch: false, automaticFolder: false };
      if (method === "plan") return planned;
      if (method === "create") return { path: planned.path };
      throw new Error(`Unexpected method ${method}`);
    },
  });
  plugin(bb);
  const scope = { projectId: project.id, hostId: host.id };
  expect(await harness.behavior.callRpc("choices", scope)).toEqual({ worktrees: [{ path: "/repo", branch: "main" }], pathTemplate: "~/team/{repo}.{branch}" });
  const inputs = inputsSchema.parse({ branch: "feature" });
  await harness.behavior.callRpc("preview", { ...scope, inputs });
  expect(harness.experimental_hostRpcCalls.find(c => c.method === "preview")).toMatchObject({ hostId: host.id, input: { source: "/repo", pathTemplate: "~/team/{repo}.{branch}" } });
  const claim = vi.fn(async () => true);
  const result = await harness.registrations.environmentProviders.get("flexible-worktrees")!.create({
    project, host, projectCheckout: { path: "/repo", experimental_ownsPath: false }, gitRemote: null,
    inputs, thread: makeThreadResponse(), suggestedBranchName: "bb/test", attempt: 1, pathKey: "key", rebuild: false,
    previous: null, experimental_claimPath: claim, report: { step() {}, log() {} }, signal: new AbortController().signal,
  });
  expect(result.status).toBe("created");
  expect(claim).toHaveBeenCalledWith(planned.path);
  expect(harness.experimental_hostRpcCalls.find(c => c.method === "plan")).toMatchObject({ input: { source: "/repo", pathTemplate: "~/team/{repo}.{branch}", pathKey: "key" } });
  await harness.behavior.setSettings({ projectOverrides: JSON.stringify({ [project.id]: "~/project/{pathKey}" }) });
  expect(await harness.behavior.callRpc("choices", scope)).toMatchObject({ pathTemplate: "~/project/{pathKey}" });
  await harness.behavior.callRpc("preview", { ...scope, inputs });
  expect(harness.experimental_hostRpcCalls.at(-1)).toMatchObject({ input: { pathTemplate: "~/project/{pathKey}" } });
  await harness.lifecycle.dispose();
});

it("rejects invalid destination settings before saving them", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flexible-worktrees" });
  plugin(bb);
  await expect(harness.behavior.setSettings({ projectOverrides: '{"project":false}' })).rejects.toThrow();
  await expect(harness.behavior.setSettings({ pathTemplate: "{unknown}" })).rejects.toThrow();
  await harness.behavior.setSettings({ pathTemplate: "" });
  await harness.behavior.setSettings({ pathTemplate: "../{repo}.{branch}" });
  await harness.lifecycle.dispose();
});

it("exposes only the path template and project overrides, with concise field help", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flexible-worktrees" });
  plugin(bb);
  const descriptors = harness.registrations.settingsDescriptors;
  expect(Object.keys(descriptors)).toEqual(["pathTemplate", "projectOverrides"]);
  expect(descriptors.pathTemplate.default).toBe("~/worktrees/{pathKey}");
  expect(descriptors.pathTemplate.description).toContain("Blank uses ~/worktrees/{pathKey}");
  await harness.lifecycle.dispose();
});

it("uses only public SDK entrypoints", async () => {
  const result = await experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^vitest$/, /^@testing-library\//, /^react(?:-dom)?(?:\/|$)/, /^@radix-ui\//, /^@hugeicons\//, /^class-variance-authority$/, /^clsx$/, /^tailwind-merge$/, /^@\//] });
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
