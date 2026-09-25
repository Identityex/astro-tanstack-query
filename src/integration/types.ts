export const injectedTypes = `declare namespace App {
  interface Locals {
    queryClient: import("@tanstack/query-core").QueryClient;
  }
}

declare module "virtual:astro-tanstack-query/config" {
  export const defaultOptions: import("@tanstack/query-core").DefaultOptions;
  export const stateReader: {
    readonly name: string;
    parse(text: string): import("@tanstack/query-core").DehydratedState;
  };
  export const stateWriter: {
    readonly name: string;
    stringify(state: import("@tanstack/query-core").DehydratedState): string;
  };
  export const settings: { emit: "middleware" | "component"; ssrStaleTime: number };
}
`;
