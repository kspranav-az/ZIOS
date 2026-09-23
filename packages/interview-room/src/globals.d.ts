/**
 * Ambient declarations for static assets imported from @zios/ui sources
 * (consumed here as TypeScript source, so its asset imports typecheck in
 * this program — mirrors packages/ui/src/assets.d.ts).
 */
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
