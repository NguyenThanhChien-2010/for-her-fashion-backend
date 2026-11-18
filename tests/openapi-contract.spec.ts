import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

interface OpenApiContract {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
}

describe('OpenAPI contract', () => {
  const contractPath = join(process.cwd(), 'docs', 'for-her-fashion-openapi.yaml');
  const contract = load(readFileSync(contractPath, 'utf8')) as OpenApiContract;

  it('loads the agreed contract and API paths', () => {
    expect(contract.openapi).toBe('3.0.3');
    expect(contract.info.version).toBe('1.0.2');
    expect(Object.keys(contract.paths).length).toBeGreaterThan(0);
  });
});
