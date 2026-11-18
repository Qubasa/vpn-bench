import { For, type JSX, Show } from "solid-js";
import { nonMeshTag } from "@/src/vpnKind";

export const formatNumber = (value: number, digits: number): string =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** A VPN name; references that are not mesh VPNs in grey italics with their tag. */
export const VpnName = (props: { vpn: string }) => (
  <Show when={nonMeshTag(props.vpn)} fallback={<span>{props.vpn}</span>}>
    {(tag) => (
      <span class="italic text-gray-500">
        {props.vpn} ({tag()})
      </span>
    )}
  </Show>
);

export const WinnerNames = (props: { vpns: readonly string[] }) => (
  <Show
    when={props.vpns.length > 0}
    fallback={<span class="text-gray-500">no mesh VPN qualified</span>}
  >
    <strong>{props.vpns.join(", ")}</strong>
    {props.vpns.length > 1 && " (tie)"}
  </Show>
);

export const Card = (props: {
  title: string;
  question: string;
  children: JSX.Element;
}) => (
  <section class="mb-6 rounded-lg border border-gray-200 bg-white p-4">
    <h3 class="text-lg font-semibold">{props.title}</h3>
    <p class="mb-3 text-sm text-gray-600">{props.question}</p>
    {props.children}
  </section>
);

export const Caveats = (props: { items: readonly string[] }) => (
  <Show when={props.items.length > 0}>
    <ul class="mt-3 list-disc pl-5 text-xs text-gray-600">
      <For each={props.items}>{(item) => <li>{item}</li>}</For>
    </ul>
  </Show>
);
