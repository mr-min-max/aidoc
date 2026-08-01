import {
  canonicalStringify,
  compareChangeKeys,
  sha256Hex,
  toPlanError,
} from "../../../src/impact/canonical";
import { PlanFailure, type SymbolChange } from "../../../src/impact/types";

describe("impact canonical contracts", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalStringify({ z: 1, a: { d: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"d":2},"z":1}',
    );
    expect(canonicalStringify({ values: [{ z: 1, a: 2 }, 3] })).toBe(
      '{"values":[{"a":2,"z":1},3]}',
    );
    expect(canonicalStringify({ 2: "two", 10: "ten" })).toBe(
      '{"10":"ten","2":"two"}',
    );
  });

  it("omits undefined object fields", () => {
    expect(canonicalStringify({ present: 1, absent: undefined })).toBe(
      '{"present":1}',
    );
  });

  it("encodes sparse array holes as null to produce valid JSON", () => {
    const sparse = new Array<string>(2);
    sparse[1] = "kept";

    const serialized = canonicalStringify(sparse);

    expect(serialized).toBe('[null,"kept"]');
    expect(JSON.parse(serialized)).toEqual([null, "kept"]);
  });

  it("rejects values that cannot have a stable JSON representation", () => {
    expect(() => canonicalStringify(Number.POSITIVE_INFINITY)).toThrow(
      "Cannot canonicalize non-finite number.",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(
      "Cannot canonicalize cyclic value.",
    );
  });

  it("produces lowercase SHA-256 digests", () => {
    expect(sha256Hex("stable")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails closed without exposing a hostile thrown value", () => {
    const secret = ["sk", "proj", "A".repeat(32)].join("-");
    const hostile = new Proxy(new Error("unused"), {
      get() {
        throw new Error(secret);
      },
    });

    expect(toPlanError(hostile)).toEqual({
      code: "PLAN_SOURCE_READ_FAILED",
      message: "Documentation impact planning failed.",
    });
    expect(JSON.stringify(toPlanError(hostile))).not.toContain(secret);
  });

  it("fails closed when a proxy wraps a trusted PlanFailure", () => {
    const secret = ["sk", "proj", "B".repeat(32)].join("-");
    const failure = new PlanFailure(
      "PLAN_PARSE_FAILED",
      "Could not parse changed supported source.",
      "src/broken.py",
    );
    const hostile = new Proxy(failure, {
      get(target, property, receiver) {
        return property === "message"
          ? secret
          : Reflect.get(target, property, receiver);
      },
    });

    expect(toPlanError(hostile)).toEqual({
      code: "PLAN_SOURCE_READ_FAILED",
      message: "Documentation impact planning failed.",
    });
    expect(JSON.stringify(toPlanError(hostile))).not.toContain(secret);
  });

  it("exposes only a trusted PlanFailure public payload", () => {
    const failure = new PlanFailure(
      "PLAN_PARSE_FAILED",
      "Could not parse changed supported source.",
      "src/broken.py",
    );

    expect(toPlanError(failure)).toEqual({
      code: "PLAN_PARSE_FAILED",
      message: "Could not parse changed supported source.",
      path: "src/broken.py",
    });
    expect(Object.keys(failure).sort()).toEqual(["code", "message", "path"]);
    expect("cause" in failure).toBe(false);
  });

  it("normalizes safe relative failure paths and omits unsafe paths", () => {
    expect(
      toPlanError(
        new PlanFailure(
          "PLAN_PARSE_FAILED",
          "Could not parse changed supported source.",
          "src\\nested\\..\\broken.py",
        ),
      ),
    ).toMatchObject({ path: "src/broken.py" });

    expect(
      toPlanError(
        new PlanFailure(
          "PLAN_PARSE_FAILED",
          "Could not parse changed supported source.",
          "/private/project/secret.py",
        ),
      ),
    ).not.toHaveProperty("path");
  });

  it("orders change keys by path, kind, qualified name, category, and id", () => {
    const change = (overrides: Partial<SymbolChange>): SymbolChange => ({
      scope: "symbol",
      id: "typescript:src/z.ts#function:z",
      category: "added",
      risk: "informational",
      language: "typescript",
      path: "src/z.ts",
      kind: "function",
      qualifiedName: "z",
      digest: "a".repeat(64),
      ...overrides,
    });
    const changes = [
      change({ id: "b", category: "removed" }),
      change({ id: "a", category: "removed" }),
      change({ id: "c", category: "added" }),
      change({ id: "d", qualifiedName: "a" }),
      change({ id: "e", kind: "class" }),
      change({ id: "f", path: "src/a.ts" }),
    ];

    expect(changes.sort(compareChangeKeys).map(({ id }) => id)).toEqual([
      "f",
      "e",
      "d",
      "c",
      "a",
      "b",
    ]);
  });
});
