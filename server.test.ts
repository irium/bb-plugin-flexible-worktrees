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

it("claims the canonical path before allowing any filesystem mutation", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flexible-worktrees",
    experimental_callHostRpc: async ({ method }) => {
      if (method !== "plan") throw new Error("Must not mutate when claim failed");
      return { mode: "existing", source: "/repo", path: "/canonical/repo", branch: "", base: "", pathKey: "key" };
    },
  });
  plugin(bb);
  const fixture = makeMessageDispatchHookContext();
  const claim = vi.fn(async () => false);
  const result = await harness.registrations.environmentProviders.get("flexible-worktrees")!.create({
    project: fixture.project!, host: makeHostResponse(), projectCheckout: { path: "/repo", experimental_ownsPath: false },
    gitRemote: null, inputs: inputsSchema.parse({ mode: "existing", checkout: "/repo" }),
    thread: makeThreadResponse(), suggestedBranchName: "bb/test", attempt: 1, pathKey: "key", rebuild: false,
    previous: null, experimental_claimPath: claim, report: { step() {}, log() {} }, signal: new AbortController().signal,
  });
  expect(result.status).toBe("failed");
  expect(claim).toHaveBeenCalledWith("/canonical/repo");
  await harness.lifecycle.dispose();
});

it("uses only public SDK entrypoints", async () => {
  const result = await experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^vitest$/, /^@testing-library\//, /^react(?:-dom)?(?:\/|$)/, /^@radix-ui\//, /^@hugeicons\//, /^class-variance-authority$/, /^clsx$/, /^tailwind-merge$/, /^@\//] });
  expect(result.violations).toEqual([]);
  expect(result.privateDependencies).toEqual([]);
});
