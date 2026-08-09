import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  REQUIRED_TEMPLATE_NAMES,
  resolveTemplatesDir,
} from "../../../src/core/templates";

describe("resolveTemplatesDir", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aidoc-templates-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns the sibling templates directory when every template exists", () => {
    const moduleDir = path.join(root, "core");
    const templatesDir = path.join(root, "templates");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });
    for (const name of REQUIRED_TEMPLATE_NAMES) {
      fs.writeFileSync(path.join(templatesDir, `${name}.hbs`), name);
    }

    expect(resolveTemplatesDir(moduleDir)).toBe(templatesDir);
  });

  it("fails with the missing template names before provider invocation", () => {
    const moduleDir = path.join(root, "core");
    const templatesDir = path.join(root, "templates");
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.mkdirSync(templatesDir, { recursive: true });
    fs.writeFileSync(path.join(templatesDir, "readme.hbs"), "readme");

    expect(() => resolveTemplatesDir(moduleDir)).toThrow(
      /Packaged templates are incomplete/,
    );
    expect(() => resolveTemplatesDir(moduleDir)).toThrow(/api-doc/);
  });
});
