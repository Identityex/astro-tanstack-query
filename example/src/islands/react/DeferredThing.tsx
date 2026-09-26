import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";
import { $deferredThing } from "../../queries/deferred-thing";

export default function DeferredThing() {
  const { data, isPending } = useStore($deferredThing);
  const shown = isPending ? "pending" : data;
  // What the first browser render showed, published once hydration has committed. It matches the
  // server HTML only if the server island's state was in the page cache before this island read.
  const firstRender = useRef(shown);
  const [hydratedWith, setHydratedWith] = useState<string>();
  useEffect(() => setHydratedWith(firstRender.current), []);
  return (
    <div data-island="deferred" data-hydrated-with={hydratedWith}>
      Deferred: {shown}
    </div>
  );
}
