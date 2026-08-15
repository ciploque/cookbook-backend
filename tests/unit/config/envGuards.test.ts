import { describe, it, expect } from 'vitest';
import { assertProductionOrigins } from '../../../src/config/envGuards';

describe('assertProductionOrigins()', () => {
  it('rejects a wildcard origin in production', () => {
    expect(assertProductionOrigins('production', '*')).toMatch(/not permitted/);
    expect(assertProductionOrigins('production', '  *  ')).toMatch(/not permitted/);
  });

  it('allows an explicit allowlist in production', () => {
    expect(
      assertProductionOrigins('production', 'https://app.example.com,https://admin.example.com'),
    ).toBeNull();
  });

  it('allows a wildcard outside production (dev/test convenience)', () => {
    expect(assertProductionOrigins('development', '*')).toBeNull();
    expect(assertProductionOrigins('test', '*')).toBeNull();
  });
});
