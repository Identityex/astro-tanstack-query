declare module "virtual:astro-tanstack-query/config" {
  import type { DefaultOptions, DehydratedState } from "@tanstack/query-core";
  export const defaultOptions: DefaultOptions;
  export const stateReader: {
    readonly name: string;
    parse(text: string): DehydratedState;
  };
  export const stateWriter: {
    readonly name: string;
    stringify(state: DehydratedState): string;
  };
  export const settings: {
    emit: "middleware" | "component";
    ssrStaleTime: number;
    /** `ssr.origin`: what `absoluteUrl()` resolves against on the server. Absent unless set. */
    origin?: string;
  };
  /** True only in a client build, where it folds the server branches away. Never true on a server. */
  export const browserBuild: boolean;
}
