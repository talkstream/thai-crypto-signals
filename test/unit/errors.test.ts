import { describe, expect, it } from 'vitest';
import { DecimalParseError, PayloadValidationError } from '../../src/domain/errors';

describe('error messages (optional context branches)', () => {
  it('DecimalParseError includes the symbol only when provided', () => {
    expect(new DecimalParseError('x').message).not.toContain(' for ');
    expect(new DecimalParseError('x', 'BTC_THB').message).toContain('for BTC_THB');
  });

  it('PayloadValidationError includes the endpoint only when provided', () => {
    expect(new PayloadValidationError('bad').message).not.toContain(' for ');
    expect(new PayloadValidationError('bad', '/api/v3/market/ticker').message).toContain(
      'for /api/v3/market/ticker',
    );
  });
});
