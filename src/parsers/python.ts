import {
  LanguageParser,
  ParsedModule,
  FunctionInfo,
  ClassInfo,
  ImportStatement,
  MethodInfo,
} from "./types";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

/**
 * Python AST analysis script.
 * Uses Python's built-in `ast` module for real AST parsing — no heavy native dependencies.
 * This follows the AGENTS.md principle: "AST First, LLM Second".
 */
const PYTHON_AST_SCRIPT = `
import ast
import json
import sys

def analyze_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        source = f.read()

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

    print(json.dumps(result))

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

if __name__ == '__main__':
    analyze_file(sys.argv[1])
`;

export class PythonParser implements LanguageParser {
  readonly name = "python";
  readonly supportedExtensions = [".py"];

  async parse(filePath: string): Promise<ParsedModule> {
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    try {
      const { stdout } = await execFileAsync(
        "python3",
        ["-c", PYTHON_AST_SCRIPT, filePath],
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
      // Graceful fallback: if Python is not available, return empty module
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT") || message.includes("not found")) {
        console.warn(
          "⚠️  Python 3 not found. Install Python 3 to enable Python file analysis.\n" +
            "   Skipping Python parsing for: " +
            filePath,
        );
        return this.emptyModule(filePath);
      }
      throw new Error(`Failed to parse Python file ${filePath}: ${message}`, {
        cause: error,
      });
    }
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

  private emptyModule(filePath: string): ParsedModule {
    return {
      filePath,
      language: "python",
      functions: [],
      classes: [],
      types: [],
      imports: [],
    };
  }
}
