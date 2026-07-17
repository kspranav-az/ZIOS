/**
 * Ambient declarations for static assets imported from TS sources.
 * Vite bundles these at build time; the declarations satisfy tsc.
 */
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
