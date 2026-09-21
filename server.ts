import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, inputsSchema, rpcContract } from "./contract";
export { rpcContract } from "./contract";

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    defaultRoot: {
      type: "string", label: "Default worktree parent directory ({repo} = repository name)",
      default: "~/dev/worktrees/{repo}",
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    async remoteBranches({ projectId, hostId }) {
      const project = await bb.sdk.projects.get({ projectId });
      const sources = project.sources.filter(s => s.hostId === hostId);
      if (!sources.length) throw new Error("This project has no checkout on the selected machine");
      const results = await Promise.all(sources.map(source => host.call("remoteBranches", { source: source.path }, { hostId, timeoutMs: 180_000 })));
      return {
        branches: [...new Map(results.flatMap(r => r.branches).map(row => [JSON.stringify([row.remote, row.branch]), row])).values()],
        errors: [...new Set(results.flatMap(r => r.errors))],
      };
    },
    async choices({ projectId, hostId }) {
      const project = await bb.sdk.projects.get({ projectId });
      const sources = project.sources.filter(s => s.hostId === hostId);
      if (!sources.length) throw new Error("This project has no checkout on the selected machine");
      const lists = await Promise.all(sources.map(source => host.call("list", { source: source.path }, { hostId })));
      return {
        worktrees: [...new Map(lists.flat().map(row => [row.path, row])).values()],
        defaultRoot: (await settings.get()).defaultRoot,
      };
    },
  });
  bb.experimental_environments.register({
    id: "flexible-worktrees", displayName: "Flexible Worktrees",
    description: "Reuse a checkout or create a worktree with your own path and branch. Files are always retained.",
    icon: "FolderGit", requires: { gitCheckout: true }, inputs: inputsSchema,
    policy: { retireGraceMs: null, pathKeys: "per-thread" },
    async create(ctx) {
      const options = { hostId: ctx.host.id, signal: ctx.signal, timeoutMs: 180_000 };
      ctx.report.step("Validating checkout and destination");
      const p = await host.call("plan", {
        source: ctx.projectCheckout.path, inputs: ctx.inputs,
        defaultRoot: (await settings.get()).defaultRoot,
        pathKey: ctx.pathKey, suggestedBranch: ctx.suggestedBranchName,
      }, options);
      if (!await ctx.experimental_claimPath(p.path)) return { status: "failed", message: "Another launch reserved this path. Choose a different directory or reuse its environment." };
      ctx.report.step(p.mode === "existing" ? "Attaching existing checkout (no Git changes)" : `Creating worktree at ${p.path}`);
      const result = await host.call("create", p, options);
      return {
        status: "created", path: result.path, ownsPath: p.mode !== "existing",
        ...(p.mode === "new-branch" ? { mergeBaseBranch: p.base } : {}),
      };
    },
    async remove() {
      // Intentionally non-destructive, including cancellation and explicit environment deletion.
      // User-chosen directories and branches remain available outside BB.
      return { status: "removed" };
    },
  });
}
