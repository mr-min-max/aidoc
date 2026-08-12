import { z } from "zod";
import { listProviders } from "../providers/registry";
import { getProviderProfile } from "../providers/profiles";
import { TRUST_POLICIES } from "../security/types";

export const ConfigSchema = z.object({
  provider: z
    .string()
    .default("auto")
    .refine(
      (val: string) =>
        val === "auto" ||
        getProviderProfile(val) !== undefined ||
        listProviders().some((p) => p.name === val),
      {
        message:
          "Unknown provider. Run `aidoc` with a registered provider name.",
      },
    ),
  model: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  providerBaseUrl: z.string().min(1).optional(),
  allowLocalHttp: z.boolean().default(false),
  qwenRegion: z
    .enum([
      "china-beijing",
      "china-hongkong",
      "singapore",
      "japan-tokyo",
      "germany-frankfurt",
      "us-virginia",
    ])
    .optional(),
  qwenWorkspaceId: z.string().min(1).optional(),
  trustPolicy: z.enum(TRUST_POLICIES).default("redact"),
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
      "**/tests/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/package-lock.json",
      "**/yarn.lock",
    ]),
  language: z.string().default("en"),
  outputDir: z.string().default("./docs"),
  maxContextBytes: z.number().int().min(1024).max(1048576).default(12000),
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
