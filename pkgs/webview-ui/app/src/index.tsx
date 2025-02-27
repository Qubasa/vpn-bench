/* @refresh reload */
import { Portal, render } from "solid-js/web";
import { Navigate, RouteDefinition, Router } from "@solidjs/router";

import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";

import { Layout } from "./layout/layout";

import { Welcome } from "./routes/welcome";
import { Toaster } from "solid-toast";

import { IconVariant } from "./components/icon";
import { Components } from "./routes/components";

export const client = new QueryClient();

const root = document.getElementById("app");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?",
  );
}

if (import.meta.env.DEV) {
  console.log("Development mode");
  // Load the debugger in development mode
  await import("solid-devtools");
}

export type AppRoute = Omit<RouteDefinition, "children"> & {
  label: string;
  icon?: IconVariant;
  children?: AppRoute[];
  hidden?: boolean;
};

export const routes: AppRoute[] = [
  {
    path: "/",
    label: "",
    hidden: true,
    component: () => <Navigate href="/zerotier" />,
  },
  {
    path: "/zerotier",
    label: "Zerotier",
    component: () => <Welcome />,
  },
  {
    path: "/mycelium",
    label: "Mycelium",
    hidden: false,
    component: () => <Welcome />,
  },
  // {
  //   path: "/internal-dev",
  //   label: "Internal (Only visible in dev mode)",
  //   children: [
  //     {
  //       path: "/components",
  //       label: "Components",
  //       hidden: false,
  //       component: () => <Components />,
  //     },
  //   ],
  // },
];

render(
  () => (
    <>
      <Portal mount={document.body}>
        <Toaster position="top-right" containerClassName="z-[9999]" />
      </Portal>
      <QueryClientProvider client={client}>
        <Router root={Layout}>{routes}</Router>
      </QueryClientProvider>
    </>
  ),
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  root!,
);
