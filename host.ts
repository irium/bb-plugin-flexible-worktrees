import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract";
import { create, list, plan, preview, remoteBranches } from "./worktrees";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    remoteBranches: ({ source }, ctx) => remoteBranches(source, ctx.signal),
    list: ({ source }, ctx) => list(source, ctx.signal),
    preview: (args, ctx) => preview(args, ctx.signal),
    plan: (args, ctx) => plan(args, ctx.signal),
    create: (args, ctx) => create(args, ctx.experimental_paths.dataDir, ctx.signal),
  },
});
