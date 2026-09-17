import { z } from "zod";

// Shared with the browser: keep SDK runtime imports out of this module.
const text = z.string().trim().max(4096).refine(s => !/[\0\r\n]/.test(s), "Must be a single line");
export const inputsSchema = z.object({
  mode: z.enum(["existing", "new-branch", "existing-branch"]).default("new-branch"),
  checkout: text.default(""),
  root: text.default(""),
  folder: text.refine(s => !s || (s !== "." && s !== ".." && !/[\\/]/.test(s)), "Use one folder name, not a path").default(""),
  branch: text.default(""),
  base: text.default("HEAD"),
}).strict().superRefine((v, ctx) => {
  if (v.mode === "existing" && !v.checkout) ctx.addIssue({ code: "custom", path: ["checkout"], message: "Choose or enter an existing checkout" });
  if (v.mode === "existing-branch" && !v.branch) ctx.addIssue({ code: "custom", path: ["branch"], message: "Enter an existing local branch" });
});
export type Inputs = z.infer<typeof inputsSchema>;
export const planSchema = z.object({
  mode: z.enum(["existing", "new-branch", "existing-branch"]),
  source: z.string(), path: z.string(), branch: z.string(), base: z.string(), pathKey: z.string(),
}).strict();
export type Plan = z.infer<typeof planSchema>;
