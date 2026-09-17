import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { inputsSchema, planSchema } from "./inputs";
export { inputsSchema, planSchema, type Inputs, type Plan } from "./inputs";

const worktree = z.object({ path: z.string(), branch: z.string() });
export const hostContract = defineRpcContract({
  list: { input: z.object({ source: z.string() }), output: z.array(worktree) },
  plan: {
    input: z.object({ source: z.string(), inputs: inputsSchema, defaultRoot: z.string(), pathKey: z.string(), suggestedBranch: z.string() }),
    output: planSchema,
  },
  create: { input: planSchema, output: z.object({ path: z.string() }) },
});
export const rpcContract = defineRpcContract({
  choices: {
    input: z.object({ projectId: z.string(), hostId: z.string() }).strict(),
    output: z.object({ worktrees: z.array(worktree), defaultRoot: z.string() }),
  },
});
