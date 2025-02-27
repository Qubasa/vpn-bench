import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

const [activeURI, setActiveURI] = makePersisted(
  createSignal<string | null>(null),
  {
    name: "activeURI",
    storage: localStorage,
  },
);

export { activeURI, setActiveURI };
