import { useStore } from "@nanostores/react";
import { $thing } from "../../queries/thing";

export default function ThingCard() {
  const { data, isPending } = useStore($thing);
  return <div data-island="react">React: {isPending ? "pending" : data?.value}</div>;
}
