/** A positive-integer `Retry-After` header value in seconds; undefined when absent or invalid. */
export function retryAfterHeader(res: Response): number | undefined {
  const h = Number(res.headers.get('retry-after'));
  return Number.isFinite(h) && h > 0 ? h : undefined;
}
