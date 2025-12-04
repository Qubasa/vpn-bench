{ ... }:
{
  _class = "clan.service";
  manifest.name = "nix-cache-new";

  roles.server = {
    perInstance =
      { ... }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          {
            imports = [
              ../nginx
            ];

            clan.core.vars.generators."harmonia" = {
              files.ca-priv = {
                secret = true;
                owner = "harmonia";
              };
              files.ca-pub = {
                secret = false;
              };
              runtimeInputs = [
                pkgs.coreutils
                pkgs.nix
              ];
              script = ''
                nix-store --generate-binary-cache-key "harmonia-${config.networking.hostName}" "$out"/ca-priv "$out"/ca-pub
              '';
            };

            services.harmonia = {
              enable = true;
              signKeyPaths = [ config.clan.core.vars.generators."harmonia".files.ca-priv.path ];
            };

            environment.systemPackages = with pkgs; [
              hyperfine
            ];

            services.nginx =
              let
                hostName = config.networking.hostName;
              in
              {
                virtualHosts."cache.vpn.${hostName}" = {
                  serverAliases = [
                    "cache.v4.${hostName}"
                    "cache.v6.${hostName}"
                  ];
                  locations."/".extraConfig = ''
                    proxy_pass http://127.0.0.1:5000;
                    proxy_set_header Host $host;
                    proxy_redirect http:// https://;
                    proxy_http_version 1.1;
                    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                    proxy_set_header Upgrade $http_upgrade;
                    proxy_set_header Connection $connection_upgrade;

                  '';
                };
              };
          };
      };
  };

  roles.client = {
    perInstance =
      { roles, ... }:
      {
        nixosModule =
          { config, lib, ... }:
          let
            caPubPath =
              name: "${config.clan.core.settings.directory}/vars/per-machine/${name}/harmonia/ca-pub/value";

            nixCacheServers = lib.mapAttrs (name: _: {
              trusted-public-key =
                if builtins.pathExists (caPubPath name) then builtins.readFile (caPubPath name) else "";
            }) (roles.server.machines or { });
          in
          {
            nix.settings.trusted-public-keys = lib.mapAttrsToList (_: s: s.trusted-public-key) nixCacheServers;
          };
      };
  };
}
