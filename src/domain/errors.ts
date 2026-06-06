// Tagged domain errors. Each carries a stable `tag` for branching and observability.

export class DecimalParseError extends Error {
  readonly tag = 'DecimalParse' as const;
  constructor(
    readonly raw: string,
    readonly symbol = '',
  ) {
    super(`invalid decimal "${raw}"${symbol ? ` for ${symbol}` : ''}`);
    this.name = 'DecimalParseError';
  }
}

export class ScaleOverflowError extends Error {
  readonly tag = 'ScaleOverflow' as const;
  constructor(
    readonly symbol: string,
    readonly scale: number,
    readonly raw: string,
  ) {
    super(`scaled value for ${symbol} ("${raw}" @ scale ${scale}) exceeds lossless range (2^53-1)`);
    this.name = 'ScaleOverflowError';
  }
}

export class PayloadValidationError extends Error {
  readonly tag = 'PayloadValidation' as const;
  constructor(
    readonly detail: string,
    readonly endpoint = '',
  ) {
    super(`payload validation failed${endpoint ? ` for ${endpoint}` : ''}: ${detail}`);
    this.name = 'PayloadValidationError';
  }
}

export class SymbolNotInCatalogError extends Error {
  readonly tag = 'SymbolNotInCatalog' as const;
  constructor(readonly symbol: string) {
    super(`symbol not in catalog: ${symbol}`);
    this.name = 'SymbolNotInCatalogError';
  }
}

export class BitkubUnreachableError extends Error {
  readonly tag = 'BitkubUnreachable' as const;
  constructor(readonly cause_: unknown) {
    super('bitkub unreachable');
    this.name = 'BitkubUnreachableError';
  }
}

export class BitkubTimeoutError extends Error {
  readonly tag = 'BitkubTimeout' as const;
  constructor(readonly observedName: string) {
    super(`bitkub request timed out (${observedName})`);
    this.name = 'BitkubTimeoutError';
  }
}

export class BitkubRateLimitedError extends Error {
  readonly tag = 'BitkubRateLimited' as const;
  constructor(readonly retryAfterMs: number) {
    super(`bitkub rate limited; retry after ${retryAfterMs}ms`);
    this.name = 'BitkubRateLimitedError';
  }
}

export class BitkubHttpError extends Error {
  readonly tag = 'BitkubHttp' as const;
  constructor(readonly status: number) {
    super(`bitkub responded with HTTP ${status}`);
    this.name = 'BitkubHttpError';
  }
}
