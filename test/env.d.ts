// Allow importing migration SQL as a raw string in tests (Vite ?raw suffix).
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
