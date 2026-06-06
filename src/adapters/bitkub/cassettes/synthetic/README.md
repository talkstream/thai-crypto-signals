# Synthetic cassettes

Hand-authored edge cases (NOT recorded from the live API) used to drive deterministic
tests of the validation, scaling, and failure paths. Recorded **real** payloads live in
the parent directory (`../ticker.json`, `../symbols.json`, `../servertime.txt`,
`../status.json`).

| File | Exercises |
| --- | --- |
| `ticker-sparse.json` | per-entry tolerance: good entry + one-sided (zero bid/ask → null) + a malformed entry that must be skipped |
| `ticker-malformed.json` | envelope violation: payload is not a JSON array → `PayloadValidationError` |
| `ticker-drift.json` | a symbol absent from the catalog → counted as drift and skipped |
| `ticker-overflow.json` | `BABYDOGE_THB` (price_scale 13) with an integer-part ≥ 1,000,000 → scaled value exceeds the 2^53-1 lossless range → `ScaleOverflow` |
| `rate-limited-429.json` | representative body returned alongside an HTTP 429 (the adapter keys off the status, not the body) |
