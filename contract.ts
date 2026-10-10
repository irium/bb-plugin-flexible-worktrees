import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { destinationPreviewSchema, inputsSchema, pathDefaultsSchema, planSchema, remoteChoicesSchema } from "./inputs";
export { inputsSchema, planSchema, type Inputs, type Plan } from "./inputs";

const worktree = z.object({ path: z.string(), branch: z.string() });
export const hostContract = defineRpcContract({
  remoteBranches: { input: z.object({ source: z.string() }), output: remoteChoicesSchema },
  list: { input: z.object({ source: z.string() }), output: z.array(worktree) },
  preview: {
    input: pathDefaultsSchema.extend({ source: z.string(), inputs: inputsSchema }),
    output: destinationPreviewSchema,
  },
  plan: {
    input: pathDefaultsSchema.extend({ source: z.string(), inputs: inputsSchema, pathKey: z.string(), suggestedBranch: z.string() }),
    output: planSchema,
  },
  create: { input: planSchema, output: z.object({ path: z.string() }) },
});
export const rpcContract = defineRpcContract({
  preview: {
    input: z.object({ projectId: z.string(), hostId: z.string(), inputs: inputsSchema }).strict(),
    output: destinationPreviewSchema,
  },
  remoteBranches: { input: z.object({ projectId: z.string(), hostId: z.string() }).strict(), output: remoteChoicesSchema },
  choices: {
    input: z.object({ projectId: z.string(), hostId: z.string() }).strict(),
    output: pathDefaultsSchema.extend({ worktrees: z.array(worktree) }),
  },
});
