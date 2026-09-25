import { from } from "solid-js";
import { $thing } from "../../queries/thing";

export default function ThingCard() {
  // Solid core's from(), not @nanostores/solid's useStore: that binding reconciles each update into
  // the previous value, and here the previous value is TanStack Query's cached data. The initial
  // value types the accessor as always defined.
  const thing = from($thing, $thing.get());
  return (
    <div data-island="solid">Solid: {thing().isPending ? "pending" : thing().data?.value}</div>
  );
}
