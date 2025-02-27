import { setActiveURI } from "@/src/App";
import { Button } from "@/src/components/button";

import { useNavigate } from "@solidjs/router";

export const Welcome = () => {
  return (
    <div class="hero min-h-[calc(100vh-10rem)]">
      <div class="hero-content mb-32 text-center">
        <div class="max-w-md">
          <h1 class="text-5xl font-bold">Welcome to Clan</h1>
          <p class="py-6">Own the services you use.</p>
          <div class="flex flex-col items-start gap-2">
            
          </div>
        </div>
      </div>
    </div>
  );
};
