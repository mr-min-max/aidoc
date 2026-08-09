jest.mock("../../../src/core/freshness", () => ({
  checkDocumentationFreshness: jest.fn(),
}));

import { checkDocumentationFreshness } from "../../../src/core/freshness";
import { runCheckCommand } from "../../../src/cli/commands/check";

const checkMock = checkDocumentationFreshness as jest.MockedFunction<
  typeof checkDocumentationFreshness
>;

describe("runCheckCommand", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("prints one JSON report and returns 1 for stale documentation", async () => {
    checkMock.mockResolvedValue({
      status: "stale",
      target: "README.md",
      targetChanged: false,
      sourceFiles: ["src/index.ts"],
      message: "README.md did not co-change",
    });
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

  it("returns 2 when the deterministic check cannot be evaluated", async () => {
    checkMock.mockResolvedValue({
      status: "unknown",
      target: "README.md",
      targetChanged: false,
      sourceFiles: [],
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
    checkMock.mockResolvedValue({
      status,
      target: "README.md",
      targetChanged: status === "co-changed",
      sourceFiles: status === "clean" ? [] : ["src/index.ts"],
      message: status,
    });
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(
      runCheckCommand({ target: "README.md", since: "base" }),
    ).resolves.toBe(expected);
  });
});
