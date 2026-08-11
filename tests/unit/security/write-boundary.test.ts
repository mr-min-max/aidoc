import * as path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type BindingElement,
  type CallExpression,
  type Expression,
  type Identifier,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";

const repositoryRoot = path.resolve(__dirname, "../../..");
const filesystemMutationNames = new Set([
  "appendFile",
  "appendFileSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createWriteStream",
  "fchmod",
  "fchmodSync",
  "fchown",
  "fchownSync",
  "fdatasync",
  "fdatasyncSync",
  "fsync",
  "fsyncSync",
  "ftruncate",
  "ftruncateSync",
  "futimes",
  "futimesSync",
  "link",
  "linkSync",
  "lchmod",
  "lchmodSync",
  "lchown",
  "lchownSync",
  "lutimes",
  "lutimesSync",
  "mkdir",
  "mkdirSync",
  "mkdtemp",
  "mkdtempSync",
  "open",
  "openSync",
  "rename",
  "renameSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "symlink",
  "symlinkSync",
  "truncate",
  "truncateSync",
  "unlink",
  "unlinkSync",
  "utimes",
  "utimesSync",
  "write",
  "writeSync",
  "writev",
  "writevSync",
  "writeFile",
  "writeFileSync",
]);

type FilesystemModule = "fs" | "fs/promises";

type FilesystemBinding =
  | { readonly kind: "namespace"; readonly module: FilesystemModule }
  | { readonly kind: "named"; readonly mutation: string };

interface FilesystemBindings {
  readonly roles: Map<Node, FilesystemBinding>;
}

function moduleKind(moduleSpecifier: string): FilesystemModule | undefined {
  if (moduleSpecifier === "fs" || moduleSpecifier === "node:fs") return "fs";
  if (
    moduleSpecifier === "fs/promises" ||
    moduleSpecifier === "node:fs/promises"
  ) {
    return "fs/promises";
  }
  return undefined;
}

function namespaceBinding(module: FilesystemModule): FilesystemBinding {
  return { kind: "namespace", module };
}

function addBinding(
  bindings: FilesystemBindings,
  identifier: Identifier,
  binding: FilesystemBinding,
): void {
  bindings.roles.set(identifier, binding);
  const symbol = identifier.getSymbol();
  for (const declaration of symbol?.getDeclarations() ?? []) {
    bindings.roles.set(declaration, binding);
  }
}

function addImportBindings(
  sourceFile: SourceFile,
  bindings: FilesystemBindings,
): void {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const module = moduleKind(declaration.getModuleSpecifierValue());
    if (module === undefined) continue;

    const clause = declaration.getImportClause();
    if (clause === undefined || clause.isTypeOnly()) continue;

    const namespaceImport = clause.getNamespaceImport();
    if (namespaceImport !== undefined) {
      addBinding(bindings, namespaceImport, namespaceBinding(module));
    }

    const namedBindings = clause.getNamedBindings();
    if (!namedBindings || !Node.isNamedImports(namedBindings)) continue;

    for (const specifier of namedBindings.getElements()) {
      if (specifier.isTypeOnly()) continue;
      const importedName = specifier.getNameNode().getText();
      const localName = specifier.getAliasNode() ?? specifier.getNameNode();
      if (!Node.isIdentifier(localName)) continue;

      if (module === "fs" && importedName === "promises") {
        addBinding(bindings, localName, namespaceBinding("fs/promises"));
      } else if (filesystemMutationNames.has(importedName)) {
        addBinding(bindings, localName, {
          kind: "named",
          mutation: importedName,
        });
      }
    }
  }

  for (const declaration of sourceFile.getDescendantsOfKind(
    SyntaxKind.ImportEqualsDeclaration,
  )) {
    const externalModule = declaration
      .getModuleReference()
      .getFirstDescendantByKind(SyntaxKind.StringLiteral);
    const module =
      externalModule === undefined
        ? undefined
        : moduleKind(externalModule.getLiteralValue());
    if (module === undefined) continue;
    addBinding(bindings, declaration.getNameNode(), namespaceBinding(module));
  }
}

function isRequireCall(expression: Expression): FilesystemModule | undefined {
  if (!Node.isCallExpression(expression)) return undefined;
  const callee = expression.getExpression();
  if (!Node.isIdentifier(callee) || callee.getText() !== "require") {
    return undefined;
  }
  const [argument] = expression.getArguments();
  if (!argument || !Node.isStringLiteral(argument)) return undefined;
  return moduleKind(argument.getLiteralValue());
}

function requiredModuleBinding(
  expression: Expression,
): FilesystemBinding | undefined {
  const requiredModule = isRequireCall(expression);
  if (requiredModule !== undefined) return namespaceBinding(requiredModule);

  if (Node.isPropertyAccessExpression(expression)) {
    if (expression.getName() !== "promises") return undefined;
    const receiver = requiredModuleBinding(expression.getExpression());
    if (receiver?.kind === "namespace" && receiver.module === "fs") {
      return namespaceBinding("fs/promises");
    }
  }

  if (Node.isElementAccessExpression(expression)) {
    const argument = expression.getArgumentExpression();
    if (!argument || !Node.isStringLiteral(argument)) return undefined;
    if (argument.getLiteralValue() !== "promises") return undefined;
    const receiver = requiredModuleBinding(expression.getExpression());
    if (receiver?.kind === "namespace" && receiver.module === "fs") {
      return namespaceBinding("fs/promises");
    }
  }

  return undefined;
}

function bindingPropertyName(element: BindingElement): string {
  const propertyName = element.getPropertyNameNode();
  if (propertyName === undefined) return element.getNameNode().getText();
  return Node.isStringLiteral(propertyName)
    ? propertyName.getLiteralValue()
    : propertyName.getText();
}

function addVariableBinding(
  declaration: VariableDeclaration,
  binding: FilesystemBinding,
  bindings: FilesystemBindings,
): void {
  const name = declaration.getNameNode();
  if (Node.isIdentifier(name)) {
    addBinding(bindings, name, binding);
    return;
  }
  if (!Node.isObjectBindingPattern(name)) return;

  for (const element of name.getElements()) {
    const property = bindingPropertyName(element);
    const localName = element.getNameNode();
    if (!Node.isIdentifier(localName)) continue;

    if (binding.kind === "namespace" && property === "promises") {
      addBinding(bindings, localName, namespaceBinding("fs/promises"));
    } else if (filesystemMutationNames.has(property)) {
      addBinding(bindings, localName, {
        kind: "named",
        mutation: property,
      });
    }
  }
}

function addRequireBindings(
  sourceFile: SourceFile,
  bindings: FilesystemBindings,
): void {
  for (const declaration of sourceFile.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  )) {
    const initializer = declaration.getInitializer();
    if (!initializer) continue;
    const binding = requiredModuleBinding(initializer);
    if (binding === undefined) continue;
    addVariableBinding(declaration, binding, bindings);
  }
}

function collectFilesystemBindings(sourceFile: SourceFile): FilesystemBindings {
  const bindings: FilesystemBindings = { roles: new Map() };
  addImportBindings(sourceFile, bindings);
  addRequireBindings(sourceFile, bindings);
  return bindings;
}

function resolveBinding(
  expression: Expression,
  bindings: FilesystemBindings,
): FilesystemBinding | undefined {
  if (Node.isIdentifier(expression)) {
    const direct = bindings.roles.get(expression);
    if (direct !== undefined) return direct;
    for (const declaration of expression.getSymbol()?.getDeclarations() ?? []) {
      const binding = bindings.roles.get(declaration);
      if (binding !== undefined) return binding;
    }
    return undefined;
  }

  const required = requiredModuleBinding(expression);
  if (required !== undefined) return required;

  if (Node.isPropertyAccessExpression(expression)) {
    if (expression.getName() !== "promises") return undefined;
    const receiver = resolveBinding(expression.getExpression(), bindings);
    if (receiver?.kind === "namespace" && receiver.module === "fs") {
      return namespaceBinding("fs/promises");
    }
  }

  if (Node.isElementAccessExpression(expression)) {
    const argument = expression.getArgumentExpression();
    if (!argument || !Node.isStringLiteral(argument)) return undefined;
    if (argument.getLiteralValue() !== "promises") return undefined;
    const receiver = resolveBinding(expression.getExpression(), bindings);
    if (receiver?.kind === "namespace" && receiver.module === "fs") {
      return namespaceBinding("fs/promises");
    }
  }

  return undefined;
}

function calledPropertyName(expression: Expression): string | undefined {
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  if (Node.isElementAccessExpression(expression)) {
    const argument = expression.getArgumentExpression();
    return argument && Node.isStringLiteral(argument)
      ? argument.getLiteralValue()
      : undefined;
  }
  return undefined;
}

function filesystemMutationName(
  call: CallExpression,
  bindings: FilesystemBindings,
): string | undefined {
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) {
    const binding = resolveBinding(expression, bindings);
    return binding?.kind === "named" ? binding.mutation : undefined;
  }

  const property = calledPropertyName(expression);
  if (!property || !filesystemMutationNames.has(property)) return undefined;
  const receiver = Node.isPropertyAccessExpression(expression)
    ? expression.getExpression()
    : Node.isElementAccessExpression(expression)
      ? expression.getExpression()
      : undefined;
  if (!receiver) return undefined;
  const binding = resolveBinding(receiver, bindings);
  return binding?.kind === "namespace" ? property : undefined;
}

function scanSourceFile(sourceFile: SourceFile): string[] {
  const bindings = collectFilesystemBindings(sourceFile);
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .flatMap((call) => {
      const mutation = filesystemMutationName(call, bindings);
      return mutation === undefined
        ? []
        : [
            `${sourceFile.getFilePath()}:${call.getStartLineNumber()}:${mutation}`,
          ];
    });
}

function productionSourceFiles(): SourceFile[] {
  const project = new Project({
    tsConfigFilePath: path.join(repositoryRoot, "tsconfig.json"),
  });
  return project.getSourceFiles().filter((source) => {
    const relativePath = path.relative(repositoryRoot, source.getFilePath());
    return (
      relativePath.startsWith(`src${path.sep}`) && relativePath.endsWith(".ts")
    );
  });
}

function sourceImports(sourceFile: SourceFile): string[] {
  return sourceFile
    .getImportDeclarations()
    .flatMap((declaration) => [
      declaration.getModuleSpecifierValue(),
      ...declaration
        .getNamedImports()
        .flatMap((specifier) => [
          specifier.getNameNode().getText(),
          ...(specifier.getAliasNode()
            ? [specifier.getAliasNode()!.getText()]
            : []),
        ]),
    ]);
}

describe("repository write structural boundary", () => {
  it("detects filesystem mutations through resolved fs bindings only", () => {
    const sources = productionSourceFiles();
    const violations = sources
      .filter(
        (source) =>
          path.relative(repositoryRoot, source.getFilePath()) !==
          path.join("src", "security", "repository-writer.ts"),
      )
      .flatMap(scanSourceFile);

    expect(violations).toEqual([]);

    const fixtureProject = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const fixture = fixtureProject.createSourceFile(
      "/write-boundary-fixture.ts",
      `import * as fs from "node:fs";
fs.writeFileSync("output.md", "content");
process.stdout.write("diagnostic");
const scope = { open: () => undefined };
scope.open();
`,
    );

    expect(scanSourceFile(fixture)).toEqual([
      expect.stringContaining("/write-boundary-fixture.ts:2:writeFileSync"),
    ]);
  });

  it("covers named aliases, promises namespaces, and require bindings", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const source = project.createSourceFile(
      "/binding-fixture.ts",
      `import { writeFileSync as save } from "node:fs";
import { promises as fsPromises } from "node:fs";
import * as fs from "node:fs";
import fsRequire = require("fs/promises");
const requiredFs = require("node:fs");
const { writeFileSync: saveRequired } = require("node:fs");
const { promises: requiredPromises } = require("node:fs");
save("named", "content");
fsPromises.writeFile("promises", "content");
fs.promises.writeFileSync("namespace-promises", "content");
fsRequire.writeFile("import-equals", "content");
requiredFs.writeFileSync("require-namespace", "content");
saveRequired("require-alias", "content");
requiredPromises.writeFile("require-promises", "content");
`,
    );

    expect(scanSourceFile(source)).toEqual([
      expect.stringContaining(":8:writeFileSync"),
      expect.stringContaining(":9:writeFile"),
      expect.stringContaining(":10:writeFileSync"),
      expect.stringContaining(":11:writeFile"),
      expect.stringContaining(":12:writeFileSync"),
      expect.stringContaining(":13:writeFile"),
      expect.stringContaining(":14:writeFile"),
    ]);
  });

  it("does not treat same-named non-filesystem receivers as mutations", () => {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
    });
    const source = project.createSourceFile(
      "/receiver-fixture.ts",
      `const arbitrary = { open: () => undefined, writeFileSync: () => undefined };
const fs = { open: () => undefined };
class RepositoryWriteScope { static open(): void {} }
process.stdout.write("diagnostic");
arbitrary.open();
arbitrary.writeFileSync();
fs.open();
RepositoryWriteScope.open();
`,
    );

    expect(scanSourceFile(source)).toEqual([]);
  });

  it("keeps read-only command imports and score writes behind output", () => {
    const project = new Project({
      tsConfigFilePath: path.join(repositoryRoot, "tsconfig.json"),
    });
    for (const command of ["check", "plan"]) {
      const source = project.getSourceFileOrThrow(
        path.join(repositoryRoot, "src", "cli", "commands", `${command}.ts`),
      );
      expect(sourceImports(source)).not.toEqual(
        expect.arrayContaining(["repository-writer", "prepareDocumentTarget"]),
      );
      expect(
        source
          .getImportDeclarations()
          .some((declaration) =>
            declaration.getModuleSpecifierValue().includes("repository-writer"),
          ),
      ).toBe(false);
    }

    const score = project.getSourceFileOrThrow(
      path.join(repositoryRoot, "src", "cli", "commands", "score.ts"),
    );
    const targetCalls = score
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter(
        (call) => call.getExpression().getText() === "prepareDocumentTarget",
      );
    expect(targetCalls.length).toBeGreaterThan(0);
    for (const call of targetCalls) {
      const branch = call.getFirstAncestorByKind(SyntaxKind.IfStatement);
      expect(branch).toBeDefined();
      expect(branch!.getExpression().getText()).toBe("options.output");
      expect(branch!.getThenStatement().getDescendants()).toContain(call);
    }
  });
});
