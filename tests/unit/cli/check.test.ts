jest.mock("../../../src/core/freshness", () => ({
  checkDocumentationFreshness: jest.fn(),
}));

import { checkDocumentationFreshness } from "../../../src/core/freshness";
import { runCheckCommand } from "../../../src/cli/commands/check";

const checkMock = checkDocumentationFreshness as jest.MockedFunction<
  typeof checkDocumentationFreshness
>;

const report = (status: "clean" | "co-changed" | "stale" | "missing" | "unknown") => ({
  status,
  target: "README.md",
  targetChanged: status === "co-changed",
  referencedSymbols: status === "stale" ? ["createUser"] : [],
  sections: status === "stale" ? [{ section: "API", slug: "api", symbols: ["createUser"] }] : [],
  unmappedSymbols: [],
  sourceFiles: status === "clean" ? [] : ["src/index.ts"],
  message: status,
});

describe("runCheckCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prints one JSON report and returns 1 for stale documentation", async () => {
    checkMock.mockResolvedValue(report("stale"));
    const write = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const code = await runCheckCommand({
      target: "README.md",
      since: "HEAD~1",
      json: true,
    });

    expect(code).toBe(1);
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
      status: "stale",
      target: "README.md",
    });
  });

  it("prints stale sections in text mode and returns 1", async () => {
    const staleReport = {
      ...report("stale"),
      message: "README.md: 1 sections mention changed public symbols and were not updated (API: createUser)",
    };
    checkMock.mockResolvedValue(staleReport);
    const write = jest
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const code = await runCheckCommand({ target: "README.md", since: "HEAD~1" });

    expect(code).toBe(1);
    expect(String(write.mock.calls.map(([value]) => value).join(""))).toBe(
      "README.md: 1 sections mention changed public symbols and were not updated (API: createUser)\n  - API: createUser\n",
    );
  });

  it("returns 2 when the deterministic check cannot be evaluated", async () => {
    checkMock.mockResolvedValue({
      ...report("unknown"),
      message: "Git base is unavailable",
    });
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runCheckCommand({ target: "README.md", since: "missing-ref" }),
    ).resolves.toBe(2);
  });

  it.each([
    ["clean", 0],
    ["co-changed", 0],
    ["missing", 1],
  ] as const)("maps %s to exit code %i", async (status, expected) => {
    checkMock.mockResolvedValue(report(status));
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runCheckCommand({ target: "README.md", since: "base" }),
    ).resolves.toBe(expected);
  });
});
