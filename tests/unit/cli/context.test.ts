import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { loadCommandContext, writeDoc } from '../../../src/cli/context';

describe('loadCommandContext', () => {
  it('returns a mock generator when mock is set', async () => {
    const ctx = await loadCommandContext({ mock: true });
    expect(ctx.isMock).toBe(true);
    expect(ctx.generator.constructor.name).toBe('MockGenerator');
  });
});

describe('writeDoc', () => {
  const tmp = path.join(os.tmpdir(), `aidoc-test-${Date.now()}.md`);

  afterEach(() => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } });

  it('creates a new file (no existing, no dry-run)', async () => {
    await writeDoc(tmp, '# Hello\n', {});
    expect(fs.readFileSync(tmp, 'utf8')).toBe('# Hello\n');
  });

  it('dry-run writes nothing', async () => {
    await writeDoc(tmp, '# Hello\n', { dryRun: true });
    expect(fs.existsSync(tmp)).toBe(false);
  });
});
