import {
  Project,
  SourceFile,
  Scope,
  MethodDeclaration,
  ParameterDeclaration,
  FileSystemRefreshResult,
} from "ts-morph";
import {
  LanguageParser,
  ParsedModule,
  FunctionInfo,
  ClassInfo,
  TypeInfo,
  MethodInfo,
  ImportStatement,
  ParameterInfo,
} from "./types";

// One shared Project for the whole process — avoids re-booting the
// TypeScript compiler for every file (was a major perf bottleneck:
// 100 files meant 100 compiler initializations).
let sharedProject: Project | null = null;

/** Parses TypeScript and JavaScript files using ts-morph AST metadata. */
export class TypeScriptParser implements LanguageParser {
  readonly name = "typescript";
  readonly supportedExtensions = [".ts", ".tsx", ".js", ".jsx"];

  /** Visible for tests: how many times the Project has been constructed. */
  static sharedProjectCount = 0;

  private getProject(): Project {
    if (!sharedProject) {
      sharedProject = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: true },
      });
      TypeScriptParser.sharedProjectCount++;
    }
    return sharedProject;
  }

  /** Parses a source file into exported functions, classes, types, and imports. */
  async parse(filePath: string): Promise<ParsedModule> {
    const project = this.getProject();
    let sourceFile = project.getSourceFile(filePath);
    if (sourceFile) {
      const refreshResult = await sourceFile.refreshFromFileSystem();
      if (refreshResult === FileSystemRefreshResult.Deleted) {
        throw new Error(`File not found: ${filePath}`);
      }
    } else {
      sourceFile = project.addSourceFileAtPath(filePath);
    }
    const diagnostics = project
      .getProgram()
      .getSyntacticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      project.removeSourceFile(sourceFile);
      // Compiler diagnostics can quote source fragments. Keep the parser boundary
      // value-free so analyzer, freshness, CLI, and MCP consumers stay safe.
      throw new Error("TypeScript syntax error.");
    }

    return {
      filePath,
      language: "typescript",
      functions: this.extractFunctions(sourceFile),
      classes: this.extractClasses(sourceFile),
      types: this.extractTypes(sourceFile),
      imports: this.extractImports(sourceFile),
    };
  }

  private extractFunctions(sf: SourceFile): FunctionInfo[] {
    return sf
      .getFunctions()
      .filter((f) => f.isExported())
      .map((f) => {
        const params = f.getParameters().map(
          (p) =>
            ({
              name: p.getName(),
              type: p.getType().getText(p),
              isOptional: p.isOptional(),
              defaultValue: p.getInitializer()?.getText(),
            }) as ParameterInfo,
        );

        const jsDocs = f.getJsDocs();
        const existingDoc =
          jsDocs.length > 0 ? jsDocs[0].getDescription().trim() : undefined;

        return {
          name: f.getName() || "anonymous",
          parameters: params,
          returnType: f.getReturnType().getText(f),
          isAsync: f.isAsync(),
          isExported: true,
          lineRange: [f.getStartLineNumber(), f.getEndLineNumber()] as [
            number,
            number,
          ],
          existingDoc,
          signature: f.getText().split("{")[0].trim(),
        } as FunctionInfo;
      });
  }

  private extractClasses(sf: SourceFile): ClassInfo[] {
    return sf
      .getClasses()
      .filter((c) => c.isExported())
      .map((c) => {
        const jsDocs = c.getJsDocs();
        const existingDoc =
          jsDocs.length > 0 ? jsDocs[0].getDescription().trim() : undefined;
        const extendsClause = c.getExtends();

        return {
          name: c.getName() || "anonymous",
          extends: extendsClause?.getText(),
          implements: c.getImplements().map((i) => i.getText()),
          methods: c.getMethods().map((m) => this.mapMethod(m)),
          properties: c.getProperties().map((p) => ({
            name: p.getName(),
            type: p.getType().getText(p),
            visibility: this.getScope(p.getScope()),
            isStatic: p.isStatic(),
            isReadonly: p.isReadonly(),
          })),
          isExported: true,
          lineRange: [c.getStartLineNumber(), c.getEndLineNumber()] as [
            number,
            number,
          ],
          existingDoc,
        } as ClassInfo;
      });
  }

  private mapMethod(m: MethodDeclaration): MethodInfo {
    return {
      name: m.getName(),
      parameters: m.getParameters().map(
        (p: ParameterDeclaration) =>
          ({
            name: p.getName(),
            type: p.getType().getText(p),
            isOptional: p.isOptional(),
          }) as ParameterInfo,
      ),
      returnType: m.getReturnType().getText(m),
      isAsync: m.isAsync(),
      isExported: true,
      lineRange: [m.getStartLineNumber(), m.getEndLineNumber()] as [
        number,
        number,
      ],
      existingDoc: m.getJsDocs()[0]?.getDescription().trim(),
      signature: m.getText().split("{")[0].trim(),
      visibility: this.getScope(m.getScope()),
      isStatic: m.isStatic(),
    };
  }

  private getScope(scope?: Scope): "public" | "private" | "protected" {
    if (scope === Scope.Private) return "private";
    if (scope === Scope.Protected) return "protected";
    return "public";
  }

  private extractTypes(sf: SourceFile): TypeInfo[] {
    const types: TypeInfo[] = [];

    sf.getInterfaces()
      .filter((i) => i.isExported())
      .forEach((i) => {
        types.push({
          name: i.getName(),
          kind: "interface",
          isExported: true,
          properties: i.getProperties().map((p) => ({
            name: p.getName(),
            type: p.getType().getText(p),
            isOptional: p.hasQuestionToken(),
          })),
          lineRange: [i.getStartLineNumber(), i.getEndLineNumber()],
          existingDoc: i.getJsDocs()[0]?.getDescription().trim(),
        });
      });

    sf.getTypeAliases()
      .filter((t) => t.isExported())
      .forEach((t) => {
        types.push({
          name: t.getName(),
          kind: "type",
          isExported: true,
          properties: [],
          lineRange: [t.getStartLineNumber(), t.getEndLineNumber()],
          existingDoc: t.getJsDocs()[0]?.getDescription().trim(),
        });
      });

    sf.getEnums()
      .filter((e) => e.isExported())
      .forEach((e) => {
        types.push({
          name: e.getName(),
          kind: "enum",
          isExported: true,
          properties: e.getMembers().map((m) => ({
            name: m.getName(),
            type: m.getValue()?.toString(),
            isOptional: false,
          })),
          lineRange: [e.getStartLineNumber(), e.getEndLineNumber()],
          existingDoc: e.getJsDocs()[0]?.getDescription().trim(),
        });
      });

    return types;
  }

  private extractImports(sf: SourceFile): ImportStatement[] {
    return sf.getImportDeclarations().map((imp) => ({
      source: imp.getModuleSpecifierValue(),
      names: imp.getNamedImports().map((n) => n.getName()),
      isDefault: !!imp.getDefaultImport(),
    }));
  }
}
