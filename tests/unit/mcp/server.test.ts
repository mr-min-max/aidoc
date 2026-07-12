import * as path from "path";
import { fileURLToPath } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, handleToolCall } from "../../../src/mcp/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures");

describe("MCP handleToolCall", () => {
  it("runs analyze_codebase end-to-end without an LLM", async () => {
    const result = (await handleToolCall("analyze_codebase", {
      directory: FIXTURES_DIR,
    })) as { totalModules: number; totalFunctions: number };

    expect(result.totalModules).toBeGreaterThan(0);
    expect(result.totalFunctions).toBeGreaterThan(0);
  });

  it("throws on an unknown tool", async () => {
    await expect(handleToolCall("no_such_tool", {})).rejects.toThrow(
      "Unknown tool",
    );
  });
});

describe("MCP server over a real client/transport", () => {
  it("advertises its tools via the official SDK handshake", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "analyze_codebase",
        "generate_readme",
        "generate_api_docs",
        "generate_diagram",
        "check_docs_freshness",
      ]),
    );

    // Every tool advertises a JSON Schema derived from its Zod definition.
    const analyze = tools.find((t) => t.name === "analyze_codebase")!;
    expect(analyze.inputSchema.type).toBe("object");
    expect(
      (analyze.inputSchema.properties as Record<string, unknown>).directory,
    ).toBeDefined();

    await client.close();
    await server.close();
  });

  it("invokes analyze_codebase through the client and returns text content", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const result = await client.callTool({
      name: "analyze_codebase",
      arguments: { directory: FIXTURES_DIR },
    });

    const content = (
      result.content as Array<{ type: string; text: string }>
    )[0];
    expect(content.type).toBe("text");
    const parsed = JSON.parse(content.text);
    expect(parsed.totalModules).toBeGreaterThan(0);

    await client.close();
    await server.close();
  });

  it("surfaces tool errors as an MCP error result", async () => {
    const server = createServer();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    // Missing required `directory` argument -> schema validation error.
    const result = await client.callTool({
      name: "check_docs_freshness",
      arguments: {},
    });
    expect(result.isError).toBe(true);

    await client.close();
    await server.close();
  });
});
