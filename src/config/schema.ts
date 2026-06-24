import { z } from "zod";
import { listProviders } from "../providers/registry";

export const ConfigSchema = z.object({
  provider: z
    .string()
    .default("openai")
    .refine((val: string) => listProviders().some((p) => p.name === val), {
      message: "Unknown provider. Run `aidoc` with a registered provider name.",
    }),
  model: z.string().default("gpt-4o-mini"),
  apiKey: z.string().optional(),
  ollamaHost: z.string().default("http://localhost:11434"),
  include: z
    .array(z.string())
    .default(["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py"]),
  exclude: z
    .array(z.string())
    .default([
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/coverage/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/package-lock.json",
      "**/yarn.lock",
    ]),
  language: z.string().default("en"),
  outputDir: z.string().default("./docs"),
  templates: z.string().optional(),
  readme: z
    .object({
      badges: z.boolean().default(true),
      tableOfContents: z.boolean().default(true),
      installSection: z.boolean().default(true),
      usageExamples: z.boolean().default(true),
    })
    .default({
      badges: true,
      tableOfContents: true,
      installSection: true,
      usageExamples: true,
    }),
});

export type AidocConfig = z.infer<typeof ConfigSchema>;
export const defaultConfig: AidocConfig = ConfigSchema.parse({});
