import { For, type JSX, createMemo } from "solid-js";
import { RouteSectionProps } from "@solidjs/router";

import { AppRoute, routes } from "@/src/index";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarDateSelector } from "./SidebarDateSelector";
import { SidebarListItem } from "./SidebarListItem";
import { Typography } from "../Typography";
import "./css/sidebar.css";
import Icon from "../icon";
import { useAlias } from "@/src/AliasContext";

interface SidebarCategoryProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: JSX.Element;
}

export const SidebarCategory = (props: SidebarCategoryProps) => {
  return (
    <details class="sidebar__category" open={props.defaultOpen}>
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
  const { currentAlias, setCurrentAlias } = useAlias();

  // Filter and group routes by category
  const visibleRoutes = createMemo(() => routes.filter((r) => !r.hidden));

  const vpnRoutes = createMemo(() =>
    visibleRoutes().filter((r) => r.category === "vpn"),
  );

  const analysisRoutes = createMemo(() =>
    visibleRoutes().filter((r) => r.category === "analysis"),
  );

  return (
    <div class="sidebar opacity-95">
      <SidebarHeader clanName={"VPN Benchmarks"} />

      <div class="sidebar__body max-h-[calc(100vh-4rem)] overflow-auto">
        {/* Alias/Date Selector */}
        <SidebarDateSelector
          currentAlias={currentAlias()}
          onAliasChange={setCurrentAlias}
        />

        {/* VPNs Section - Collapsed by default */}
        <SidebarCategory
          title="VPNs"
          count={vpnRoutes().length}
          defaultOpen={false}
        >
          <For each={vpnRoutes()}>
            {(route: AppRoute) => (
              <SidebarListItem href={route.path} title={route.label} />
            )}
          </For>
        </SidebarCategory>

        {/* Analysis Section - Expanded by default */}
        <SidebarCategory title="Analysis" defaultOpen={true}>
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
