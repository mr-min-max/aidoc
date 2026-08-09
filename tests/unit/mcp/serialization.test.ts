import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { registerProvider } from "../../../src/providers/registry";
import { handleToolCall } from "../../../src/mcp/server";

describe("MCP provider output serialization", () => {
  it("rejects a registered provider object before MCP can serialize it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-mcp-object-"));
    const providerName = `object-mcp-provider-${Date.now()}`;
    const fakeSecret = ["sk", "proj", "S".repeat(32)].join("-");
    let serializationCalls = 0;
    const unsafeOutput = {
      toString: () => "# harmless",
      toJSON: () => {
        serializationCalls += 1;
        return fakeSecret;
      },
    };

    registerProvider({
      name: providerName,
      available: () => true,
      create: () => ({
        name: providerName,
        generate: async () => unsafeOutput as unknown as string,
      }),
    });
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, ".aidocrc.json"),
      JSON.stringify({ provider: providerName, trustPolicy: "redact" }),
    );
    fs.writeFileSync(
      path.join(root, "src", "index.ts"),
      "export function documented(): string { return 'safe'; }\n",
    );

    try {
      await expect(
        handleToolCall("generate_readme", { directory: root }),
      ).rejects.toMatchObject({ code: "TRUST_INVALID_PROVIDER_OUTPUT" });
      expect(serializationCalls).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
