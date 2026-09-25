import { useStore } from "@nanostores/react";
import { $secret } from "../../queries/secret";

export default function SecretCard() {
  const { data } = useStore($secret);
  return <div data-island="react-secret">react-secret: {data ?? "none"}</div>;
}
