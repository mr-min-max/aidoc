import {
  LanguageParser,
  ParsedModule,
  FunctionInfo,
  ClassInfo,
  ImportStatement,
  MethodInfo,
} from "./types";
import { execFile } from "child_process";
import * as fs from "fs";
import { getSafeAllowlistedErrorCode } from "../security/diagnostics";
import {
  ContractFacet,
  ParserModuleSnapshot,
  ParserSymbolSnapshot,
} from "../impact/types";

const PYTHON_UNAVAILABLE_CODES = new Set(["ENOENT"]);

interface PythonProcessOptions {
  timeout: number;
  maxBuffer: number;
  input?: string;
}

type PythonProcessRunner = (
  command: string,
  args: string[],
  options: PythonProcessOptions,
) => Promise<{ stdout: string; stderr: string }>;

const runPythonProcess: PythonProcessRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
    child.stdin?.end(options.input);
  });

/** Creates a fixed parser error without retaining untrusted process stderr as its cause. */
function createSafeParserError(message: string, causeMessage: string): Error {
  return new Error(message, { cause: new Error(causeMessage) });
}

/**
 * Python AST analysis script.
 * Uses Python's built-in `ast` module for real AST parsing — no heavy native dependencies.
 * This follows the AGENTS.md principle: "AST First, LLM Second".
 */
const PYTHON_AST_SCRIPT = `
import ast
import copy
import hashlib
import json
import sys

CALLABLE_NODES = (ast.FunctionDef, ast.AsyncFunctionDef)

def ast_payload(node):
    return ast.dump(node, annotate_fields=True, include_attributes=False)

def hash_payload(payload):
    serialized = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':')
    )
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()

def is_docstring_statement(node):
    return (
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    )

class DocumentationStripper(ast.NodeTransformer):
    def strip_body(self, node):
        self.generic_visit(node)
        if node.body and is_docstring_statement(node.body[0]):
            node.body = node.body[1:]
        return node

    def visit_Module(self, node):
        return self.strip_body(node)

    def visit_FunctionDef(self, node):
        return self.strip_body(node)

    def visit_AsyncFunctionDef(self, node):
        return self.strip_body(node)

    def visit_ClassDef(self, node):
        return self.strip_body(node)

def body_payload(statements):
    module = ast.Module(body=copy.deepcopy(statements), type_ignores=[])
    stripped = DocumentationStripper().visit(module)
    return ast_payload(stripped)

def node_without_documentation_payload(node):
    module = ast.Module(body=[copy.deepcopy(node)], type_ignores=[])
    stripped = DocumentationStripper().visit(module)
    return ast_payload(stripped)

def documentation_fingerprint(node):
    documentation = ast.get_docstring(node, clean=False)
    if documentation is None:
        return None
    return hash_payload({'documentation': documentation})

def drop_bound_method_receiver(arguments):
    positional = arguments.posonlyargs + arguments.args
    if not positional:
        return arguments

    default_start = len(positional) - len(arguments.defaults)
    if default_start == 0 and arguments.defaults:
        arguments.defaults = arguments.defaults[1:]
    if arguments.posonlyargs:
        arguments.posonlyargs = arguments.posonlyargs[1:]
    else:
        arguments.args = arguments.args[1:]
    return arguments

def decorator_terminal_name(decorator):
    if isinstance(decorator, ast.Name):
        return decorator.id
    if isinstance(decorator, ast.Attribute):
        return decorator.attr
    return None

def is_static_method(node):
    return any(
        decorator_terminal_name(decorator) == 'staticmethod'
        for decorator in node.decorator_list
    )

def callable_contract_payloads(node, is_method=False):
    arguments = copy.deepcopy(node.args)
    if is_method and not is_static_method(node):
        arguments = drop_bound_method_receiver(arguments)

    payloads = {
        'parameters': ast_payload(arguments),
        'modifiers': {
            'async': isinstance(node, ast.AsyncFunctionDef),
            'decorators': [ast_payload(item) for item in node.decorator_list],
            'typeComment': getattr(node, 'type_comment', None),
            'typeParameters': [
                ast_payload(item) for item in getattr(node, 'type_params', [])
            ],
        },
    }
    if node.returns is not None:
        payloads['return'] = ast_payload(node.returns)
    return payloads

def build_symbol(kind, qualified_name, contract_payloads, implementation, node):
    contract_facets = {
        name: hash_payload(payload)
        for name, payload in contract_payloads.items()
    }
    return {
        'language': 'python',
        'kind': kind,
        'qualifiedName': qualified_name,
        'contractFacets': contract_facets,
        'contractFingerprint': hash_payload(contract_payloads),
        'implementationFingerprint': hash_payload(implementation),
        'documentationFingerprint': documentation_fingerprint(node),
    }

def callable_symbol(node, kind, qualified_name, is_method=False):
    return build_symbol(
        kind,
        qualified_name,
        callable_contract_payloads(node, is_method),
        body_payload(node.body),
        node,
    )

def public_assignment_names(target):
    if isinstance(target, ast.Name) and not target.id.startswith('_'):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for item in target.elts:
            names.extend(public_assignment_names(item))
        return names
    return []

def class_member_contracts(node):
    members = []
    for item in node.body:
        if isinstance(item, CALLABLE_NODES) and not item.name.startswith('_'):
            members.append({
                'kind': 'method',
                'name': item.name,
                'contract': callable_contract_payloads(item, True),
            })
        elif isinstance(item, ast.AnnAssign):
            for name in public_assignment_names(item.target):
                members.append({
                    'kind': 'property',
                    'name': name,
                    'annotation': ast_payload(item.annotation),
                    'default': (
                        ast_payload(item.value) if item.value is not None else None
                    ),
                })
        elif isinstance(item, ast.Assign):
            names = []
            for target in item.targets:
                names.extend(public_assignment_names(target))
            for name in names:
                members.append({
                    'kind': 'property',
                    'name': name,
                    'annotation': None,
                    'default': ast_payload(item.value),
                })

    return sorted(
        members,
        key=lambda item: json.dumps(
            item,
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':')
        )
    )

def class_implementation_payload(node):
    entries = []
    body = node.body[1:] if node.body and is_docstring_statement(node.body[0]) else node.body
    for item in body:
        if isinstance(item, CALLABLE_NODES) and not item.name.startswith('_'):
            entries.append({
                'kind': 'method',
                'name': item.name,
                'body': body_payload(item.body),
            })
        elif isinstance(item, ast.AnnAssign):
            names = public_assignment_names(item.target)
            if names:
                entries.append({
                    'kind': 'property',
                    'names': names,
                    'value': ast_payload(item.value) if item.value is not None else None,
                })
            else:
                entries.append(node_without_documentation_payload(item))
        elif isinstance(item, ast.Assign):
            names = []
            for target in item.targets:
                names.extend(public_assignment_names(target))
            if names:
                entries.append({
                    'kind': 'property',
                    'names': names,
                    'value': ast_payload(item.value),
                })
            else:
                entries.append(node_without_documentation_payload(item))
        else:
            entries.append(node_without_documentation_payload(item))
    return entries

def class_symbol(node):
    contract_payloads = {
        'inheritance': {
            'bases': [ast_payload(item) for item in node.bases],
            'keywords': [ast_payload(item) for item in node.keywords],
        },
        'members': class_member_contracts(node),
        'modifiers': {
            'decorators': [ast_payload(item) for item in node.decorator_list],
            'typeParameters': [
                ast_payload(item) for item in getattr(node, 'type_params', [])
            ],
        },
    }
    return build_symbol(
        'class',
        node.name,
        contract_payloads,
        class_implementation_payload(node),
        node,
    )

def dependency_modules(tree):
    modules = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            modules.append('.' * node.level + (node.module or ''))
    return sorted(modules)

def snapshot_source(filepath, source):
    tree = ast.parse(source, filename=filepath)
    symbols = []
    for node in tree.body:
        if isinstance(node, CALLABLE_NODES):
            if not node.name.startswith('_'):
                symbols.append(callable_symbol(node, 'function', node.name))
        elif isinstance(node, ast.ClassDef):
            if node.name.startswith('_'):
                continue
            symbols.append(class_symbol(node))
            for item in node.body:
                if isinstance(item, CALLABLE_NODES) and not item.name.startswith('_'):
                    symbols.append(
                        callable_symbol(
                            item,
                            'method',
                            node.name + '.' + item.name,
                            True,
                        )
                    )

    symbols.sort(key=lambda item: (item['kind'], item['qualifiedName']))
    return {
        'language': 'python',
        'dependencyFingerprint': hash_payload(dependency_modules(tree)),
        'symbols': symbols,
    }

def analyze_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as source_file:
        source = source_file.read()

    tree = ast.parse(source, filename=filepath)
    result = {
        'functions': [],
        'classes': [],
        'imports': []
    }

    for node in ast.iter_child_nodes(tree):
        if isinstance(node, ast.FunctionDef) or isinstance(node, ast.AsyncFunctionDef):
            if node.name.startswith('_'):
                continue
            func = extract_function(node)
            func['isAsync'] = isinstance(node, ast.AsyncFunctionDef)
            result['functions'].append(func)

        elif isinstance(node, ast.ClassDef):
            if node.name.startswith('_'):
                continue
            result['classes'].append(extract_class(node))

        elif isinstance(node, ast.Import):
            for alias in node.names:
                result['imports'].append({
                    'source': alias.name,
                    'names': [alias.asname or alias.name],
                    'isDefault': True
                })

        elif isinstance(node, ast.ImportFrom):
            module = node.module or ''
            names = [alias.name for alias in node.names]
            result['imports'].append({
                'source': module,
                'names': names,
                'isDefault': False
            })

    return result

def extract_function(node):
    params = []
    for arg in node.args.args:
        if arg.arg == 'self':
            continue
        param = {
            'name': arg.arg,
            'type': '',
            'isOptional': False
        }
        if arg.annotation:
            param['type'] = ast.unparse(arg.annotation)
        params.append(param)

    # Check for defaults (optional params)
    num_defaults = len(node.args.defaults)
    if num_defaults > 0:
        for i in range(num_defaults):
            idx = len(params) - num_defaults + i
            if 0 <= idx < len(params):
                params[idx]['isOptional'] = True
                params[idx]['defaultValue'] = ast.unparse(node.args.defaults[i])

    return_type = ''
    if node.returns:
        return_type = ast.unparse(node.returns)

    docstring = ast.get_docstring(node) or ''

    return {
        'name': node.name,
        'parameters': params,
        'returnType': return_type,
        'isAsync': False,
        'isExported': not node.name.startswith('_'),
        'lineRange': [node.lineno, node.end_lineno or node.lineno],
        'existingDoc': docstring if docstring else None,
        'signature': f"def {node.name}({', '.join(p['name'] for p in params)})"
    }

def extract_class(node):
    bases = [ast.unparse(b) for b in node.bases]
    docstring = ast.get_docstring(node) or ''

    methods = []
    properties = []

    for item in node.body:
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if item.name.startswith('__') and item.name != '__init__':
                continue
            method = extract_function(item)
            method['isAsync'] = isinstance(item, ast.AsyncFunctionDef)
            method['visibility'] = 'private' if item.name.startswith('_') else 'public'
            method['isStatic'] = any(
                isinstance(d, ast.Name) and d.id == 'staticmethod'
                for d in item.decorators if hasattr(item, 'decorators')
            ) if hasattr(item, 'decorators') else False
            methods.append(method)

    return {
        'name': node.name,
        'extends': bases[0] if bases else None,
        'implements': bases[1:] if len(bases) > 1 else [],
        'methods': methods,
        'properties': properties,
        'isExported': not node.name.startswith('_'),
        'lineRange': [node.lineno, node.end_lineno or node.lineno],
        'existingDoc': docstring if docstring else None
    }

def emit(value):
    sys.stdout.write(json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':')
    ))

if __name__ == '__main__':
    operation = sys.argv[1]
    if operation == 'module':
        emit(analyze_file(sys.argv[2]))
    elif operation == 'snapshot':
        emit(snapshot_source(sys.argv[2], sys.stdin.read()))
    else:
        raise RuntimeError('Unsupported Python parser operation.')
`;

/** Parses Python files by delegating AST extraction to Python's stdlib ast module. */
export class PythonParser implements LanguageParser {
  readonly name = "python";
  readonly supportedExtensions = [".py"];

  constructor(
    private readonly executePython: PythonProcessRunner = runPythonProcess,
  ) {}

  /** Parses a Python file into exported functions, classes, and imports. */
  async parse(filePath: string): Promise<ParsedModule> {
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      const { stdout } = await this.executePython(
        "python3",
        ["-c", PYTHON_AST_SCRIPT, "module", filePath],
        {
          timeout: 15000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      const data = JSON.parse(stdout.trim());

      return {
        filePath,
        language: "python",
        functions: (data.functions || []).map(this.mapFunction),
        classes: (data.classes || []).map(this.mapClass),
        types: [], // Python doesn't have separate type declarations like TS
        imports: (data.imports || []).map(this.mapImport),
      };
    } catch (error: unknown) {
      if (
        getSafeAllowlistedErrorCode(error, PYTHON_UNAVAILABLE_CODES) ===
        "ENOENT"
      ) {
        throw createSafeParserError(
          "Python parser unavailable: python3 executable was not found",
          "Python executable unavailable.",
        );
      }
      // Preserve the error chain without retaining the child-process error,
      // whose stderr may contain untrusted source text.
      throw createSafeParserError(
        "Failed to parse Python source.",
        "Python parser failed.",
      );
    }
  }

  /** Creates a value-free public API snapshot from in-memory Python source. */
  async snapshot(
    filePath: string,
    source: string,
  ): Promise<ParserModuleSnapshot> {
    try {
      const { stdout } = await this.executePython(
        "python3",
        ["-c", PYTHON_AST_SCRIPT, "snapshot", filePath],
        {
          timeout: 15000,
          maxBuffer: 10 * 1024 * 1024,
          input: source,
        },
      );

      return this.mapSnapshot(JSON.parse(stdout.trim()) as unknown);
    } catch (error: unknown) {
      if (
        getSafeAllowlistedErrorCode(error, PYTHON_UNAVAILABLE_CODES) ===
        "ENOENT"
      ) {
        throw createSafeParserError(
          "Python parser unavailable: python3 executable was not found",
          "Python executable unavailable.",
        );
      }
      throw createSafeParserError(
        "Failed to parse Python source.",
        "Python parser failed.",
      );
    }
  }

  private mapSnapshot(raw: unknown): ParserModuleSnapshot {
    const data = raw as Record<string, unknown>;
    return {
      language: "python",
      dependencyFingerprint: data.dependencyFingerprint as string,
      symbols: ((data.symbols as Array<Record<string, unknown>>) || []).map(
        (symbol): ParserSymbolSnapshot => ({
          language: "python",
          kind: symbol.kind as ParserSymbolSnapshot["kind"],
          qualifiedName: symbol.qualifiedName as string,
          contractFacets: this.mapContractFacets(symbol.contractFacets),
          contractFingerprint: symbol.contractFingerprint as string,
          implementationFingerprint: symbol.implementationFingerprint as string,
          documentationFingerprint:
            symbol.documentationFingerprint === null
              ? null
              : (symbol.documentationFingerprint as string),
        }),
      ),
    };
  }

  private mapContractFacets(
    raw: unknown,
  ): Partial<Record<ContractFacet, string>> {
    const facets = raw as Record<string, unknown>;
    const mapped: Partial<Record<ContractFacet, string>> = {};
    for (const facet of [
      "parameters",
      "return",
      "inheritance",
      "members",
      "modifiers",
    ] as const) {
      if (typeof facets[facet] === "string") {
        mapped[facet] = facets[facet];
      }
    }
    return mapped;
  }

  private mapFunction(raw: Record<string, unknown>): FunctionInfo {
    return {
      name: raw.name as string,
      parameters: (raw.parameters as Array<Record<string, unknown>>).map(
        (p) => ({
          name: p.name as string,
          type: (p.type as string) || undefined,
          isOptional: p.isOptional as boolean,
          defaultValue: p.defaultValue as string | undefined,
        }),
      ),
      returnType: (raw.returnType as string) || "None",
      isAsync: raw.isAsync as boolean,
      isExported: raw.isExported as boolean,
      lineRange: raw.lineRange as [number, number],
      existingDoc: raw.existingDoc as string | undefined,
      signature: raw.signature as string,
    };
  }

  private mapClass(raw: Record<string, unknown>): ClassInfo {
    const methods = ((raw.methods as Array<Record<string, unknown>>) || []).map(
      (m): MethodInfo => ({
        name: m.name as string,
        parameters: (m.parameters as Array<Record<string, unknown>>).map(
          (p) => ({
            name: p.name as string,
            type: (p.type as string) || undefined,
            isOptional: p.isOptional as boolean,
          }),
        ),
        returnType: (m.returnType as string) || "None",
        isAsync: m.isAsync as boolean,
        isExported: true,
        lineRange: m.lineRange as [number, number],
        existingDoc: m.existingDoc as string | undefined,
        signature: m.signature as string,
        visibility:
          (m.visibility as "public" | "private" | "protected") || "public",
        isStatic: (m.isStatic as boolean) || false,
      }),
    );

    return {
      name: raw.name as string,
      extends: raw.extends as string | undefined,
      implements: (raw.implements as string[]) || [],
      methods,
      properties: [],
      isExported: raw.isExported as boolean,
      lineRange: raw.lineRange as [number, number],
      existingDoc: raw.existingDoc as string | undefined,
    };
  }

  private mapImport(raw: Record<string, unknown>): ImportStatement {
    return {
      source: raw.source as string,
      names: raw.names as string[],
      isDefault: raw.isDefault as boolean,
    };
  }
}
