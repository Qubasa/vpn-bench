import { For, type JSX, createEffect, createMemo } from "solid-js";
import { RouteSectionProps, useLocation } from "@solidjs/router";

import { AppRoute, routes } from "@/src/index";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarDateSelector } from "./SidebarDateSelector";
import { SidebarListItem } from "./SidebarListItem";
import { Typography } from "../Typography";
import "./css/sidebar.css";
import Icon from "../icon";
import { useAlias } from "@/src/AliasContext";
import { getVpnVersion } from "@/src/benchData";

interface SidebarCategoryProps {
  title: string;
  count?: number;
  // Opens the category whenever it turns true. Never closes it, so a
  // category the user expanded by hand stays expanded.
  open?: boolean;
  children: JSX.Element;
}

export const SidebarCategory = (props: SidebarCategoryProps) => {
  let details!: HTMLDetailsElement;

  createEffect(() => {
    if (props.open) {
      details.open = true;
    }
  });

  return (
    <details ref={details} class="sidebar__category">
      <summary class="sidebar__category__header">
        <Typography
          class="inline-flex w-full items-center gap-2 uppercase"
          tag="p"
          hierarchy="body"
          size="xs"
          weight="medium"
          color="tertiary"
          inverted={true}
        >
          <Icon icon="CaretRight" class="sidebar__category__caret" />
          {props.title}
          {props.count !== undefined && (
            <span class="sidebar__category__count">({props.count})</span>
          )}
        </Typography>
      </summary>
      <div class="sidebar__category__body">
        <ul>{props.children}</ul>
      </div>
    </details>
  );
};

export const Sidebar = (props: RouteSectionProps) => {
  const {
    currentAlias,
    setCurrentAlias,
    benchData: aliasBenchData,
  } = useAlias();

  // VPN names present in the current alias's bench data
  const currentVpnNames = createMemo(
    () => new Set(aliasBenchData().map((c) => c.name)),
  );

  // Filter VPN routes to show only those present in the current alias
  const vpnRoutes = createMemo(() =>
    routes.filter(
      (r) => r.category === "vpn" && currentVpnNames().has(r.label),
    ),
  );

  const analysisRoutes = createMemo(() =>
    routes.filter((r) => r.category === "analysis" && !r.hidden),
  );

  const location = useLocation();
  const onVpnRoute = createMemo(() => {
    const path = location.pathname.replace(/\/+$/, "");
    return vpnRoutes().some((r) => r.path === path);
  });

  return (
    <div class="sidebar opacity-95">
      <SidebarHeader clanName={"VPN Benchmarks"} />

      <div class="sidebar__body max-h-[calc(100vh-4rem)] overflow-auto">
        {/* Alias/Date Selector */}
        <SidebarDateSelector
          currentAlias={currentAlias()}
          onAliasChange={setCurrentAlias}
        />

        {/* VPNs Section - Collapsed unless a VPN page is open */}
        <SidebarCategory
          title="VPNs"
          count={vpnRoutes().length}
          open={onVpnRoute()}
        >
          <For each={vpnRoutes()}>
            {(route: AppRoute) => (
              <SidebarListItem
                href={route.path}
                title={route.label}
                version={getVpnVersion(currentAlias(), route.label)}
              />
            )}
          </For>
        </SidebarCategory>

        {/* Analysis Section - Expanded by default */}
        <SidebarCategory title="Analysis" open={true}>
          <For each={analysisRoutes()}>
            {(route: AppRoute) => (
              <SidebarListItem href={route.path} title={route.label} />
            )}
          </For>
        </SidebarCategory>
      </div>
    </div>
  );
};
