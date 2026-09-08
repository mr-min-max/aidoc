export function decl(a: number): string {
  return String(a);
}
/** Fetches a thing. */
export const arrow = async (id: string): Promise<string> => id;
export const fnExpr = function (x: boolean) {
  return !x;
};
export const CONFIG = { retries: 3, timeoutMs: 5000 };
export const VERSION: string = "1.0.0";
export let counter = 0;
counter += 1;
const internal = (n: number) => n + counter;
export { internal as exposed };
export default (argv: string[]) => argv.length;
export class Svc {
  run(): void {}
}
export interface Opts {
  a?: number;
}
export type Id = string;
export enum Mode {
  A,
  B,
}
