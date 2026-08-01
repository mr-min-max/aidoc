import {
  ClassDeclaration,
  ConstructorDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  GetAccessorDeclaration,
  InterfaceDeclaration,
  MethodSignature,
  Node,
  Project,
  PropertyDeclaration,
  SetAccessorDeclaration,
  SourceFile,
  Scope,
  MethodDeclaration,
  ParameterDeclaration,
  FileSystemRefreshResult,
  SyntaxKind,
  TypeAliasDeclaration,
} from "ts-morph";
import { sha256Hex } from "../impact/canonical";
import {
  ContractFacet,
  ParserModuleSnapshot,
  ParserSymbolSnapshot,
  SymbolKind,
} from "../impact/types";
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

  /** Creates a value-free public API snapshot from in-memory source text. */
  async snapshot(
    filePath: string,
    source: string,
  ): Promise<ParserModuleSnapshot> {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true },
    });
    const sourceFile = project.createSourceFile(filePath, source);
    const diagnostics = project
      .getProgram()
      .getSyntacticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      throw new Error("TypeScript syntax error.");
    }

    return {
      language: "typescript",
      dependencyFingerprint: fingerprint(
        sortNormalized([
          ...sourceFile
            .getImportDeclarations()
            .map((declaration) =>
              normalizeAst(declaration.getModuleSpecifier()),
            ),
          ...sourceFile
            .getExportDeclarations()
            .map((declaration) => declaration.getModuleSpecifier())
            .filter(isPresent)
            .map((specifier) => normalizeAst(specifier)),
        ]),
      ),
      symbols: extractSnapshotSymbols(sourceFile),
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

type AstTuple = [kind: number, text: string | null, children: AstTuple[]];
type CallableDeclaration = FunctionDeclaration | MethodDeclaration;
type PublicMethodDeclaration = MethodDeclaration | MethodSignature;
type PublicClassMember =
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | MethodDeclaration
  | PropertyDeclaration
  | SetAccessorDeclaration;
const CONTRACT_FACET_ORDER: ContractFacet[] = [
  "parameters",
  "return",
  "inheritance",
  "members",
  "modifiers",
];
const DOCUMENTATION_EXCLUSIONS = new Set<SyntaxKind>([SyntaxKind.JSDoc]);

function extractSnapshotSymbols(
  sourceFile: SourceFile,
): ParserSymbolSnapshot[] {
  const symbols: ParserSymbolSnapshot[] = [];
  const methodContributions = new Map<string, MethodSnapshotContribution[]>();

  for (const declarations of groupByName(
    sourceFile.getFunctions().filter((declaration) => declaration.isExported()),
  ).values()) {
    const overloadGroup = expandCallableDeclarations(declarations);
    symbols.push(
      callableSnapshot(
        "function",
        overloadGroup[0].getName() ?? "anonymous",
        overloadGroup,
      ),
    );
  }

  for (const declaration of sourceFile
    .getClasses()
    .filter((candidate) => candidate.isExported())) {
    const className = declaration.getName() ?? "anonymous";
    symbols.push(classSnapshot(declaration, className));

    const publicMethods = declaration.getMethods().filter(isPublicClassMember);
    for (const [methodIdentity, methods] of groupByMethodIdentity(
      publicMethods,
    )) {
      const overloadGroup = expandCallableDeclarations(methods);
      addMethodContribution(
        methodContributions,
        callableSnapshot(
          "method",
          `${className}.${methodIdentity}`,
          overloadGroup,
        ),
        true,
      );
    }
  }

  for (const declarations of groupByName(
    sourceFile.getInterfaces().filter((candidate) => candidate.isExported()),
  ).values()) {
    const interfaceName = declarations[0].getName();
    symbols.push(interfaceSnapshot(declarations));
    for (const [methodIdentity, methods] of groupByMethodIdentity(
      declarations.flatMap((declaration) => declaration.getMethods()),
    )) {
      addMethodContribution(
        methodContributions,
        interfaceMethodSnapshot(`${interfaceName}.${methodIdentity}`, methods),
        false,
      );
    }
  }
  for (const declaration of sourceFile
    .getTypeAliases()
    .filter((candidate) => candidate.isExported())) {
    symbols.push(typeAliasSnapshot(declaration));
  }
  for (const declarations of groupByName(
    sourceFile.getEnums().filter((candidate) => candidate.isExported()),
  ).values()) {
    symbols.push(enumSnapshot(declarations));
  }
  for (const contributions of methodContributions.values()) {
    symbols.push(mergeMethodContributions(contributions));
  }

  return symbols.sort(
    (left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.qualifiedName, right.qualifiedName),
  );
}

interface MethodSnapshotContribution {
  snapshot: ParserSymbolSnapshot;
  hasClassImplementation: boolean;
}

function addMethodContribution(
  contributions: Map<string, MethodSnapshotContribution[]>,
  snapshot: ParserSymbolSnapshot,
  hasClassImplementation: boolean,
): void {
  const contribution = { snapshot, hasClassImplementation };
  const existing = contributions.get(snapshot.qualifiedName);
  if (existing === undefined) {
    contributions.set(snapshot.qualifiedName, [contribution]);
  } else {
    existing.push(contribution);
  }
}

function mergeMethodContributions(
  contributions: MethodSnapshotContribution[],
): ParserSymbolSnapshot {
  if (contributions.length === 1) return contributions[0].snapshot;

  const contractFacets: Partial<Record<ContractFacet, string>> = {};
  for (const facet of CONTRACT_FACET_ORDER) {
    const hashes = uniqueSorted(
      contributions.flatMap(({ snapshot }) => {
        const hash = snapshot.contractFacets[facet];
        return hash === undefined ? [] : [hash];
      }),
    );
    if (hashes.length > 0) {
      contractFacets[facet] =
        hashes.length === 1 ? hashes[0] : fingerprint(hashes);
    }
  }

  const contracts = uniqueSorted(
    contributions.map(({ snapshot }) => snapshot.contractFingerprint),
  );
  const implementations = uniqueSorted(
    contributions
      .filter(({ hasClassImplementation }) => hasClassImplementation)
      .map(({ snapshot }) => snapshot.implementationFingerprint),
  );
  const documentation = uniqueSorted(
    contributions.flatMap(({ snapshot }) =>
      snapshot.documentationFingerprint === null
        ? []
        : [snapshot.documentationFingerprint],
    ),
  );

  return {
    language: "typescript",
    kind: "method",
    qualifiedName: contributions[0].snapshot.qualifiedName,
    contractFacets,
    contractFingerprint:
      contracts.length === 1
        ? contracts[0]
        : fingerprint(["mergedMethodContracts", contracts]),
    implementationFingerprint:
      implementations.length === 0
        ? fingerprint([])
        : implementations.length === 1
          ? implementations[0]
          : fingerprint(["mergedMethodImplementations", implementations]),
    documentationFingerprint:
      documentation.length === 0
        ? null
        : documentation.length === 1
          ? documentation[0]
          : fingerprint(documentation),
  };
}

function callableSnapshot(
  kind: "function" | "method",
  qualifiedName: string,
  declarations: CallableDeclaration[],
): ParserSymbolSnapshot {
  const contractDeclarations = declarations.some((declaration) =>
    declaration.isOverload(),
  )
    ? declarations.filter((declaration) => declaration.isOverload())
    : declarations;
  const parameterShapes = sortNormalized(
    contractDeclarations.map((declaration) => [
      declaration
        .getTypeParameters()
        .map((parameter) => normalizeAst(parameter)),
      declaration.getParameters().map((parameter) => normalizeAst(parameter)),
    ]),
  );
  const returnShapes = sortNormalized(
    contractDeclarations.map((declaration) => {
      const returnType = declaration.getReturnTypeNode();
      return returnType === undefined ? null : normalizeAst(returnType);
    }),
  );
  const modifierShapes = sortNormalized(
    contractDeclarations.map((declaration) => [
      declaration.getModifiers().map((modifier) => normalizeAst(modifier)),
      declaration.isGenerator(),
      Node.isQuestionTokenable(declaration) &&
        declaration.getQuestionTokenNode() !== undefined,
    ]),
  );
  const signatureShapes = sortNormalized(
    contractDeclarations.map(normalizeDeclarationContract),
  );
  const contractFacets: Partial<Record<ContractFacet, string>> = {
    parameters: fingerprint(parameterShapes),
    modifiers: fingerprint(modifierShapes),
  };
  if (
    contractDeclarations.some((declaration) => declaration.getReturnTypeNode())
  ) {
    contractFacets.return = fingerprint(returnShapes);
  }

  return {
    language: "typescript",
    kind,
    qualifiedName,
    contractFacets,
    contractFingerprint: fingerprint(["callable", signatureShapes]),
    implementationFingerprint: fingerprint(
      sortNormalized(
        declarations.flatMap((declaration) => {
          const body = declaration.getBody();
          if (body === undefined) return [];
          return [
            [
              contractDeclarations.length === declarations.length
                ? null
                : runtimeCallableDeclarationShape(declaration),
              normalizeAst(body),
            ],
          ];
        }),
      ),
    ),
    documentationFingerprint: documentationFingerprint(declarations),
  };
}

function interfaceMethodSnapshot(
  qualifiedName: string,
  declarations: MethodSignature[],
): ParserSymbolSnapshot {
  const parameterShapes = sortNormalized(
    declarations.map((declaration) => [
      declaration
        .getTypeParameters()
        .map((parameter) => normalizeAst(parameter)),
      declaration.getParameters().map((parameter) => normalizeAst(parameter)),
    ]),
  );
  const returnShapes = sortNormalized(
    declarations.map((declaration) => {
      const returnType = declaration.getReturnTypeNode();
      return returnType === undefined ? null : normalizeAst(returnType);
    }),
  );
  const modifierShapes = sortNormalized(
    declarations.map((declaration) => [
      declaration.getQuestionTokenNode() !== undefined,
    ]),
  );
  const signatureShapes = sortNormalized(
    declarations.map(normalizeDeclarationContract),
  );
  const contractFacets: Partial<Record<ContractFacet, string>> = {
    parameters: fingerprint(parameterShapes),
    modifiers: fingerprint(modifierShapes),
  };
  if (declarations.some((declaration) => declaration.getReturnTypeNode())) {
    contractFacets.return = fingerprint(returnShapes);
  }

  return {
    language: "typescript",
    kind: "method",
    qualifiedName,
    contractFacets,
    contractFingerprint: fingerprint(["callable", signatureShapes]),
    implementationFingerprint: fingerprint([]),
    documentationFingerprint: documentationFingerprint(declarations),
  };
}

function classSnapshot(
  declaration: ClassDeclaration,
  qualifiedName: string,
): ParserSymbolSnapshot {
  const modifierShape = declaration
    .getModifiers()
    .map((modifier) => normalizeAst(modifier));
  const inheritanceShape = declaration
    .getHeritageClauses()
    .map((clause) => normalizeAst(clause));
  const memberShape = publicClassMemberShapes(declaration);
  const contractFacets: Partial<Record<ContractFacet, string>> = {
    members: fingerprint(memberShape),
    modifiers: fingerprint(modifierShape),
  };
  if (inheritanceShape.length > 0) {
    contractFacets.inheritance = fingerprint(inheritanceShape);
  }

  return {
    language: "typescript",
    kind: "class",
    qualifiedName,
    contractFacets,
    contractFingerprint: combinedContractFingerprint("class", contractFacets),
    implementationFingerprint: fingerprint(
      classImplementationShape(declaration),
    ),
    documentationFingerprint: documentationFingerprint([
      declaration,
      ...expandCallableDeclarations(
        declaration.getMethods().filter(isPublicClassMember),
      ),
      ...declaration.getProperties().filter(isPublicClassMember),
      ...declaration.getGetAccessors().filter(isPublicClassMember),
      ...declaration.getSetAccessors().filter(isPublicClassMember),
      ...expandConstructorDeclarations(
        declaration.getConstructors().filter(isPublicClassMember),
      ),
    ]),
  };
}

function interfaceSnapshot(
  declarations: InterfaceDeclaration[],
): ParserSymbolSnapshot {
  const modifiers = uniqueNormalized(
    declarations.flatMap((declaration) =>
      declaration.getModifiers().map((modifier) => normalizeAst(modifier)),
    ),
  );
  const inheritance = uniqueNormalized(
    declarations.flatMap((declaration) =>
      declaration
        .getExtends()
        .map((heritageType) => normalizeAst(heritageType)),
    ),
  );
  const members = uniqueNormalized(
    declarations.flatMap((declaration) => [
      ...declaration
        .getTypeParameters()
        .map((parameter) => normalizeAst(parameter)),
      ...declaration.getMembers().map(normalizeDeclarationContract),
    ]),
  );
  const contractFacets: Partial<Record<ContractFacet, string>> = {
    members: fingerprint(members),
    modifiers: fingerprint(modifiers),
  };
  if (inheritance.length > 0) {
    contractFacets.inheritance = fingerprint(inheritance);
  }

  return declarationSnapshot(
    "interface",
    declarations[0].getName(),
    contractFacets,
    documentationFingerprint(
      declarations.flatMap((declaration) => [
        declaration,
        ...declaration.getMembers(),
      ]),
    ),
  );
}

function typeAliasSnapshot(
  declaration: TypeAliasDeclaration,
): ParserSymbolSnapshot {
  const contractFacets: Partial<Record<ContractFacet, string>> = {
    members: fingerprint([
      declaration
        .getTypeParameters()
        .map((parameter) => normalizeAst(parameter)),
      normalizeAst(declaration.getTypeNodeOrThrow()),
    ]),
    modifiers: fingerprint(
      declaration.getModifiers().map((modifier) => normalizeAst(modifier)),
    ),
  };
  return declarationSnapshot(
    "type",
    declaration.getName(),
    contractFacets,
    documentationFingerprint([declaration]),
  );
}

function enumSnapshot(declarations: EnumDeclaration[]): ParserSymbolSnapshot {
  const contractFacets: Partial<Record<ContractFacet, string>> = {
    members: fingerprint(
      sortNormalized(
        declarations.map((declaration) =>
          declaration.getMembers().map(normalizeDeclarationContract),
        ),
      ),
    ),
    modifiers: fingerprint(
      sortNormalized(
        declarations.map((declaration) =>
          declaration.getModifiers().map((modifier) => normalizeAst(modifier)),
        ),
      ),
    ),
  };
  return declarationSnapshot(
    "enum",
    declarations[0].getName(),
    contractFacets,
    documentationFingerprint(
      declarations.flatMap((declaration) => [
        declaration,
        ...declaration.getMembers(),
      ]),
    ),
  );
}

function declarationSnapshot(
  kind: SymbolKind,
  qualifiedName: string,
  contractFacets: Partial<Record<ContractFacet, string>>,
  docs: string | null,
): ParserSymbolSnapshot {
  return {
    language: "typescript",
    kind,
    qualifiedName,
    contractFacets,
    contractFingerprint: combinedContractFingerprint(kind, contractFacets),
    implementationFingerprint: fingerprint([]),
    documentationFingerprint: docs,
  };
}

function publicClassMemberShapes(declaration: ClassDeclaration): unknown[] {
  const shapes: unknown[] = [
    [
      "typeParameters",
      declaration
        .getTypeParameters()
        .map((parameter) => normalizeAst(parameter)),
    ],
  ];

  for (const [methodIdentity, methods] of groupByMethodIdentity(
    declaration.getMethods().filter(isPublicClassMember),
  )) {
    const overloadGroup = expandCallableDeclarations(methods);
    const contracts = overloadGroup.some((method) => method.isOverload())
      ? overloadGroup.filter((method) => method.isOverload())
      : overloadGroup;
    shapes.push([
      "method",
      methodIdentity,
      sortNormalized(contracts.map(normalizeDeclarationContract)),
    ]);
  }
  for (const property of declaration
    .getProperties()
    .filter(isPublicClassMember)) {
    shapes.push([
      "property",
      normalizeAst(property.getNameNode()),
      property.getTypeNode() === undefined
        ? null
        : normalizeAst(property.getTypeNodeOrThrow()),
      property.getQuestionTokenNode() !== undefined,
      property.getExclamationTokenNode() !== undefined,
      property.getModifiers().map((modifier) => normalizeAst(modifier)),
    ]);
  }
  for (const accessor of [
    ...declaration.getGetAccessors(),
    ...declaration.getSetAccessors(),
  ].filter(isPublicClassMember)) {
    shapes.push([accessor.getKind(), normalizeDeclarationContract(accessor)]);
  }
  const constructors = declaration
    .getConstructors()
    .filter(isPublicClassMember);
  if (constructors.length > 0) {
    const overloadGroup = expandConstructorDeclarations(constructors);
    const contracts = overloadGroup.some((constructor) =>
      constructor.isOverload(),
    )
      ? overloadGroup.filter((constructor) => constructor.isOverload())
      : overloadGroup;
    shapes.push([
      "constructor",
      sortNormalized(contracts.map(normalizeDeclarationContract)),
    ]);
  }

  return sortNormalized(shapes);
}

function classImplementationShape(declaration: ClassDeclaration): unknown[] {
  const parts: unknown[] = [];
  for (const member of declaration.getMembers()) {
    if (Node.isMethodDeclaration(member)) {
      const body = member.getBody();
      if (body === undefined) continue;
      parts.push([
        "method",
        normalizeAst(member.getNameNode()),
        !isPublicClassMember(member) || member.getOverloads().length > 0
          ? runtimeCallableDeclarationShape(member)
          : null,
        normalizeAst(body),
      ]);
      continue;
    }
    if (Node.isConstructorDeclaration(member)) {
      const body = member.getBody();
      if (body === undefined) continue;
      parts.push([
        "constructor",
        !isPublicClassMember(member) || member.getOverloads().length > 0
          ? runtimeCallableDeclarationShape(member)
          : null,
        normalizeAst(body),
      ]);
      continue;
    }
    if (
      Node.isGetAccessorDeclaration(member) ||
      Node.isSetAccessorDeclaration(member)
    ) {
      const body = member.getBody();
      if (body === undefined) continue;
      parts.push([
        member.getKind(),
        normalizeAst(member.getNameNode()),
        isPublicClassMember(member)
          ? null
          : runtimeAccessorDeclarationShape(member),
        normalizeAst(body),
      ]);
      continue;
    }
    if (Node.isPropertyDeclaration(member)) {
      const initializer = member.getInitializer();
      parts.push([
        "property",
        normalizeAst(member.getNameNode()),
        member.isStatic(),
        initializer === undefined ? null : normalizeAst(initializer),
      ]);
      continue;
    }
    if (Node.isClassStaticBlockDeclaration(member)) {
      parts.push(["static", normalizeAst(member.getBody())]);
    }
  }
  return parts;
}

function combinedContractFingerprint(
  kind: SymbolKind,
  facets: Partial<Record<ContractFacet, string>>,
): string {
  return fingerprint([
    kind,
    CONTRACT_FACET_ORDER.flatMap((facet) =>
      facets[facet] === undefined ? [] : [[facet, facets[facet]]],
    ),
  ]);
}

function documentationFingerprint(nodes: Node[]): string | null {
  const docs = nodes
    .flatMap((node) => node.getLeadingCommentRanges())
    .map((comment) => comment.getText())
    .sort(compareText);
  return docs.length === 0 ? null : fingerprint(docs);
}

function isPublicClassMember(member: PublicClassMember): boolean {
  const scope = member.getScope();
  if (scope === Scope.Private || scope === Scope.Protected) return false;
  return !(
    Node.hasName(member) && Node.isPrivateIdentifier(member.getNameNode())
  );
}

function groupByName<T extends { getName(): string | undefined }>(
  declarations: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const declaration of declarations) {
    const name = declaration.getName() ?? "anonymous";
    const group = groups.get(name);
    if (group === undefined) groups.set(name, [declaration]);
    else group.push(declaration);
  }
  return groups;
}

function groupByMethodIdentity<T extends PublicMethodDeclaration>(
  declarations: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const declaration of declarations) {
    const identity = safeMethodIdentity(declaration);
    const group = groups.get(identity);
    if (group === undefined) groups.set(identity, [declaration]);
    else group.push(declaration);
  }
  return groups;
}

function safeMethodIdentity(declaration: PublicMethodDeclaration): string {
  const name = declaration.getNameNode();
  if (Node.isIdentifier(name)) return name.getText();
  return `[computed:${fingerprint(["methodName", normalizeAst(name)])}]`;
}

function expandCallableDeclarations(
  declarations: CallableDeclaration[],
): CallableDeclaration[] {
  return uniqueNodes(
    declarations.flatMap((declaration) => [
      ...declaration.getOverloads(),
      declaration,
    ]),
  );
}

function expandConstructorDeclarations(
  declarations: ConstructorDeclaration[],
): ConstructorDeclaration[] {
  return uniqueNodes(
    declarations.flatMap((declaration) => [
      ...declaration.getOverloads(),
      declaration,
    ]),
  );
}

function uniqueNodes<T extends Node>(nodes: T[]): T[] {
  const unique = new Map<number, T>();
  for (const node of nodes) unique.set(node.getStart(), node);
  return [...unique.values()];
}

function runtimeCallableDeclarationShape(
  declaration: CallableDeclaration | ConstructorDeclaration,
): unknown[] {
  return [
    Node.isAsyncable(declaration) && declaration.isAsync(),
    Node.isGeneratorable(declaration) && declaration.isGenerator(),
    Node.isStaticable(declaration) && declaration.isStatic(),
    Node.isDecoratable(declaration)
      ? declaration.getDecorators().map((decorator) => normalizeAst(decorator))
      : [],
    runtimeParameterShapes(declaration.getParameters()),
  ];
}

function runtimeAccessorDeclarationShape(
  declaration: GetAccessorDeclaration | SetAccessorDeclaration,
): unknown[] {
  return [
    declaration.isStatic(),
    declaration.getDecorators().map((decorator) => normalizeAst(decorator)),
    runtimeParameterShapes(declaration.getParameters()),
  ];
}

function runtimeParameterShapes(parameters: ParameterDeclaration[]): unknown[] {
  return parameters.map((parameter) => {
    const initializer = parameter.getInitializer();
    return [
      normalizeAst(parameter.getNameNode()),
      parameter.isRestParameter(),
      initializer === undefined ? null : normalizeAst(initializer),
      parameter.getDecorators().map((decorator) => normalizeAst(decorator)),
      parameter.isParameterProperty()
        ? parameter.getModifiers().map((modifier) => normalizeAst(modifier))
        : [],
    ];
  });
}

function normalizeDeclarationContract(node: Node): AstTuple {
  const body = Node.isBodyable(node) ? node.getBody() : undefined;
  return normalizeAst(
    node,
    DOCUMENTATION_EXCLUSIONS,
    body === undefined ? new Set() : new Set([body]),
  );
}

function normalizeAst(
  node: Node,
  exclusions: ReadonlySet<SyntaxKind> = new Set(),
  excludedNodes: ReadonlySet<Node> = new Set(),
): AstTuple {
  const candidates = node
    .getChildren()
    .filter(
      (child) =>
        (child.getKind() !== SyntaxKind.SemicolonToken ||
          node.getKind() === SyntaxKind.ForStatement) &&
        !exclusions.has(child.getKind()) &&
        !excludedNodes.has(child),
    );
  const children = candidates
    .filter(
      (child, index) =>
        child.getKind() !== SyntaxKind.CommaToken ||
        index !== candidates.length - 1,
    )
    .map((child) => normalizeAst(child, exclusions, excludedNodes));
  return [
    node.getKind(),
    children.length === 0 ? normalizedLeafText(node) : null,
    children,
  ];
}

function normalizedLeafText(node: Node): string {
  if (
    Node.isStringLiteral(node) ||
    Node.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.getLiteralText();
  }
  if (Node.isNumericLiteral(node) || Node.isBigIntLiteral(node)) {
    return String(node.getLiteralValue());
  }
  return node.getText();
}

function fingerprint(value: unknown): string {
  return sha256Hex(JSON.stringify(value));
}

function sortNormalized<T>(values: T[]): T[] {
  return values.sort((left, right) =>
    compareText(JSON.stringify(left), JSON.stringify(right)),
  );
}

function uniqueNormalized<T>(values: T[]): T[] {
  const unique = new Map<string, T>();
  for (const value of values) unique.set(JSON.stringify(value), value);
  return [...unique.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, value]) => value);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
