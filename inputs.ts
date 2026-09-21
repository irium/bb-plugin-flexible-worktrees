import { z } from "zod";

// Shared with the browser: keep SDK runtime imports out of this module.
const text = z.string().trim().max(4096).refine(s => !/[\0\r\n]/.test(s), "Must be a single line");
export const inputsSchema = z.object({
  mode: z.enum(["existing", "new-branch", "existing-branch", "remote-branch"]).default("new-branch"),
  checkout: text.default(""),
  root: text.default(""),
  folder: text.refine(s => !s || (s !== "." && s !== ".." && !/[\\/]/.test(s)), "Use one folder name, not a path").default(""),
  branch: text.default(""),
  base: text.default("HEAD"),
  remote: text.default("origin"),
  remoteBranch: text.default(""),
}).strict().superRefine((v, ctx) => {
  if (v.mode === "remote-branch" && (!v.remote || !v.remoteBranch)) ctx.addIssue({ code: "custom", path: ["remoteBranch"], message: "Enter a remote and branch name" });
  if (v.mode === "existing" && !v.checkout) ctx.addIssue({ code: "custom", path: ["checkout"], message: "Choose or enter an existing checkout" });
  if (v.mode === "existing-branch" && !v.branch) ctx.addIssue({ code: "custom", path: ["branch"], message: "Enter an existing local branch" });
});
export type Inputs = z.infer<typeof inputsSchema>;
export const planSchema = z.object({
  mode: z.enum(["existing", "new-branch", "existing-branch", "remote-branch"]),
  remote: z.string().optional(), remoteBranch: z.string().optional(),
  source: z.string(), path: z.string(), branch: z.string(), base: z.string(), pathKey: z.string(),
}).strict();
export type Plan = z.infer<typeof planSchema>;

export const remoteChoicesSchema = z.object({
  branches: z.array(z.object({ remote: z.string(), branch: z.string() })),
  errors: z.array(z.string()),
});
export type RemoteChoices = z.infer<typeof remoteChoicesSchema>;
