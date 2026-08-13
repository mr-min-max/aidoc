import { Generator } from "../../../src/core/generator";
import {
  renderUpdateGenerationEnvelope,
  type UpdateGenerationEnvelope,
} from "../../../src/core/update-preparation";
import { TrustGateway } from "../../../src/security/gateway";
import type {
  GenerateOptions,
  LLMProvider,
} from "../../../src/providers/types";
import type { ImpactProviderContext } from "../../../src/impact/types";
import * as path from "node:path";

const templatesDir = path.resolve(__dirname, "../../../src/templates");

function impactContext(): ImpactProviderContext {
  return {
    schemaVersion: "aidoc.impact-context.v1",
    impactDigest: "a".repeat(64),
    summary: {
      totalChanges: 1,
      publicApiChanges: 1,
      potentiallyBreaking: 1,
      reviewRequired: 0,
      informational: 0,
      unmapped: 0,
      byCategory: {
        added: 0,
        removed: 0,
        moved: 0,
        "contract-changed": 1,
        "implementation-changed": 0,
        "documentation-changed": 0,
        "dependency-changed": 0,
      },
    },
    changes: [
      {
        id: "typescript:src/index.ts#function:transform",
        category: "contract-changed",
        risk: "potentially-breaking",
        path: "src/index.ts",
        kind: "function",
        qualifiedName: "transform",
        changedContractFacets: ["parameters", "return"],
      },
    ],
    documentation: [
      {
        changeId: "typescript:src/index.ts#function:transform",
        directReferences: [
          {
            file: "README.md",
            section: "API",
            slug: "api",
            reason: "code-span",
          },
        ],
        recommendations: [],
        unmapped: false,
      },
    ],
    omittedRecords: 0,
  };
}

class RecordingProvider implements LLMProvider {
  readonly name = "recording";
  readonly calls: Array<{ prompt: string; options: GenerateOptions }> = [];

  async generate(
    prompt: string,
    options: GenerateOptions = {},
  ): Promise<string> {
    this.calls.push({ prompt, options });
    return "# Updated\n";
  }
}

describe("renderUpdateGenerationEnvelope", () => {
  it("matches Generator's approved update input exactly", async () => {
    const provider = new RecordingProvider();
    const generator = new Generator(provider, templatesDir);
    const input = {
      existingDoc: "# Existing\n\n## API\n\nUse transform.\n",
      impactPlan: impactContext(),
    };

    await generator.generateUpdate(input);
    const envelope = renderUpdateGenerationEnvelope({
      templatesDir,
      existingDoc: input.existingDoc,
      impactPlan: input.impactPlan,
    });
    const inspectionProvider = new RecordingProvider();
    const gateway = new TrustGateway(inspectionProvider, {
      policy: "redact",
      origin: "mcp",
    });
    const approved = gateway.approveInputEnvelope(envelope);

    expect(provider.calls[0]).toEqual({
      prompt: approved.prompt,
      options: {
        temperature: 0.2,
        systemPrompt: approved.systemPrompt,
      },
    });
  });

  it("returns the narrow update envelope shape without provider access", () => {
    const envelope = renderUpdateGenerationEnvelope({
      templatesDir,
      existingDoc: "# Existing\n",
      impactPlan: impactContext(),
    });

    expect(envelope).toEqual<UpdateGenerationEnvelope>({
      operation: "update",
      systemPrompt:
        "You are a documentation updater. Preserve the existing structure and only modify sections affected by code changes.",
      prompt: expect.any(String),
    });
  });

  it("uses a value-free diagnostic when the template directory is missing", () => {
    const templatesDir = "/Users/alice/private/project/templates";

    expect(() =>
      renderUpdateGenerationEnvelope({
        templatesDir,
        existingDoc: "# Existing\n",
        impactPlan: impactContext(),
      }),
    ).toThrow("Template not found.");

    try {
      renderUpdateGenerationEnvelope({
        templatesDir,
        existingDoc: "# Existing\n",
        impactPlan: impactContext(),
      });
    } catch (error: unknown) {
      expect(String(error)).not.toContain(templatesDir);
    }
  });
});
