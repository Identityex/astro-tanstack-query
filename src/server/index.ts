export { injectState, stateScript, warnOnLatePrefetch } from "./emit";
export type { EmitOptions } from "./emit";
// The read side of the scope the middleware establishes. Unlike getQueryClient() it answers
// undefined outside a request instead of throwing, so custom middleware can probe for one.
export { currentScope } from "./scope";
export type { RequestScope } from "../query/scope-reader";
