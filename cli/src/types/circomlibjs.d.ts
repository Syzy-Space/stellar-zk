declare module "circomlibjs" {
  export function buildPoseidon(): Promise<unknown>;
  export function buildBabyjub(): Promise<unknown>;
  export function buildEddsa(): Promise<unknown>;
}
