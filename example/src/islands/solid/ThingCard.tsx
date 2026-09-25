import { useStore } from "@nanostores/solid";
import { $thing } from "../../queries/thing";

export default function ThingCard() {
  const thing = useStore($thing);
  return (
    <div data-island="solid">Solid: {thing().isPending ? "pending" : thing().data?.value}</div>
  );
}
