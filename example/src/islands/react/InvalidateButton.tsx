import { $thing } from "../../queries/thing";

export default function InvalidateButton() {
  return <button onClick={() => void $thing.invalidate()}>invalidate</button>;
}
