import { Component, createEffect } from "solid-js";
import { Sidebar } from "@/src/components/Sidebar";

import { RouteSectionProps, useNavigate } from "@solidjs/router";

export const Layout: Component<RouteSectionProps> = (props) => {
  return (
    <div class="h-screen w-full p-4 bg-def-2">
      <div class="drawer h-full lg:drawer-open ">
        <input
          id="toplevel-drawer"
          type="checkbox"
          class="drawer-toggle hidden"
        />
        <label
          for="toplevel-drawer"
          class="btn btn-circle btn-sm fixed left-2 top-6 z-50 border border-gray-200 bg-white shadow-sm lg:hidden"
        >
          <span class="material-icons text-xl text-gray-600">menu</span>
        </label>
        <div class="drawer-content my-2 ml-0 overflow-x-hidden overflow-y-scroll rounded-lg border bg-def-1 border-def-3 lg:ml-8">
          {props.children}
        </div>
        <div class="drawer-side z-40 h-full !overflow-hidden">
          <label
            for="toplevel-drawer"
            aria-label="close sidebar"
            class="drawer-overlay !h-full !overflow-hidden "
          ></label>
          <Sidebar {...props} />
        </div>
      </div>
    </div>
  );
};
