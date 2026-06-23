import { LanguageParser, ParsedModule } from './types';

export class PythonParser implements LanguageParser {
  readonly name = 'python';
  readonly supportedExtensions = ['.py'];

  async parse(filePath: string): Promise<ParsedModule> {
    // В MVP мы возвращаем заглушку, но архитектура уже позволяет
    // легко добавить tree-sitter-python позже.
    return {
      filePath,
      language: 'python',
      functions: [],
      classes: [],
      types: [],
      imports: [],
    };
  }
}
