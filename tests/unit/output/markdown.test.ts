import { validateMarkdown, writeMarkdown } from '../../../src/output/markdown';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Markdown Output', () => {
  it('should validate correct markdown', () => {
    const result = validateMarkdown('# Title\n\nSome content\n\n## Section\n\nMore content');
    expect(result.isValid).toBe(true);
  });

  it('should warn on markdown without heading', () => {
    const result = validateMarkdown('Just some text without heading');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('heading');
  });

  it('should detect unclosed code blocks', () => {
    const result = validateMarkdown('# Title\n\n```js\ncode');
    expect(result.warnings.some(w => w.includes('code blocks'))).toBe(true);
  });

  it('should write markdown to file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidoc-test-'));
    const outPath = path.join(tmpDir, 'test.md');
    writeMarkdown(outPath, '# Test\n\nContent');
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf8')).toBe('# Test\n\nContent');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('should create directories if they do not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidoc-test-'));
    const outPath = path.join(tmpDir, 'subdir', 'deep', 'test.md');
    writeMarkdown(outPath, '# Deep\n\nNested');
    expect(fs.existsSync(outPath)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
