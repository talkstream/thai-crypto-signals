import type { Clock, Rng } from '../domain/ports';

// The ONLY place wall-clock and randomness enter the system (CI-guarded). Everything else
// takes Clock/Rng by injection so behaviour stays deterministic and testable.

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class SystemRng implements Rng {
  nextUnit(): number {
    return Math.random();
  }
}
