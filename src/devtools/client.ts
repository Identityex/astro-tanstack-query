import { pageClient } from "../query/client";

export interface DevtoolsOptions {
  buttonPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "relative";
  position?: "top" | "bottom" | "left" | "right";
  initialIsOpen?: boolean;
}

/** Dev only. Loads @tanstack/query-devtools lazily and mounts it with the page client. */
export async function mountDevtools(
  target: HTMLElement,
  options: DevtoolsOptions = {},
): Promise<() => void> {
  const [{ TanstackQueryDevtools }, { onlineManager }] = await Promise.all([
    import("@tanstack/query-devtools"),
    import("@tanstack/query-core"),
  ]);
  const devtools = new TanstackQueryDevtools({
    client: pageClient(),
    queryFlavor: "Astro",
    version: "5",
    onlineManager,
    buttonPosition: options.buttonPosition ?? "bottom-right",
    position: options.position ?? "bottom",
    initialIsOpen: options.initialIsOpen ?? false,
  });
  devtools.mount(target);
  return () => devtools.unmount();
}
