export interface ParameterInfo {
  name: string;
  type?: string;
  isOptional: boolean;
  defaultValue?: string;
}

export interface FunctionInfo {
  name: string;
  parameters: ParameterInfo[];
  returnType?: string;
  isAsync: boolean;
  isExported: boolean;
  lineRange: [number, number];
  existingDoc?: string;
  signature: string;
}

export interface MethodInfo extends FunctionInfo {
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
}

export interface ClassInfo {
  name: string;
  extends?: string;
  implements: string[];
  methods: MethodInfo[];
  properties: PropertyInfo[];
  isExported: boolean;
  lineRange: [number, number];
  existingDoc?: string;
}

export interface PropertyInfo {
  name: string;
  type?: string;
  visibility: 'public' | 'private' | 'protected';
  isStatic: boolean;
  isReadonly: boolean;
}

export interface TypeInfo {
  name: string;
  kind: 'interface' | 'type' | 'enum';
  isExported: boolean;
  properties: { name: string; type?: string; isOptional: boolean }[];
  lineRange: [number, number];
  existingDoc?: string;
}

export interface ImportStatement {
  source: string;
  names: string[];
  isDefault: boolean;
}

export interface ParsedModule {
  filePath: string;
  language: string;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  types: TypeInfo[];
  imports: ImportStatement[];
}

export interface LanguageParser {
  readonly name: string;
  readonly supportedExtensions: string[];
  parse(filePath: string): Promise<ParsedModule>;
}
