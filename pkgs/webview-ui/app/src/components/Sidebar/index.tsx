import { For, createEffect, Show, type JSX, children } from "solid-js";
import { A, RouteSectionProps } from "@solidjs/router";
import { activeURI } from "@/src/App";
import { createQuery } from "@tanstack/solid-query";

import { AppRoute, routes } from "@/src/index";
import { SidebarHeader } from "./SidebarHeader";
import { SidebarListItem } from "./SidebarListItem";
import { Typography } from "../Typography";
import "./css/sidebar.css";
import Icon, { IconVariant } from "../icon";

export const SidebarSection = (props: {
  title: string;
  icon: IconVariant;
  children: JSX.Element;
}) => {
  const { title, children } = props;

  return (
    <details class="sidebar__section accordeon" open>
      <summary class="accordeon__header">
        <Typography
          class="inline-flex w-full gap-2 uppercase"
          tag="p"
          hierarchy="body"
          size="xs"
          weight="normal"
          color="tertiary"
          inverted={true}
        >
          <Icon icon={props.icon} />
          {title}
          <Icon icon="CaretDown" class="ml-auto" />
        </Typography>
      </summary>
      <div class="accordeon__body">{children}</div>
    </details>
  );
};

export const Sidebar = (props: RouteSectionProps) => {
  createEffect(() => {
    console.log("machines");
    console.log(routes);
  });

  return (
    <div class="sidebar opacity-95">
      <SidebarHeader clanName={"VPN Benchmarks"} />

      <div class="sidebar__body max-h-[calc(100vh-4rem)] overflow-scroll">
        <For each={routes.filter((r) => !r.hidden)}>
          {(route: AppRoute) => (
            <Show
              when={route.children}
              fallback={
                <SidebarListItem href={route.path} title={route.label} />
              }
            >
              {(children) => (
                <SidebarSection
                  title={route.label}
                  icon={route.icon || "Paperclip"}
                >
                  <ul>
                    <For each={children().filter((r) => !r.hidden)}>
                      {(child) => (
                        <SidebarListItem
                          href={`${route.path}${child.path}`}
                          title={child.label}
                        />
                      )}
                    </For>
                  </ul>
                </SidebarSection>
              )}
            </Show>
          )}
        </For>
      </div>
    </div>
  );
};
