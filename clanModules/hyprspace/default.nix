{ hyprspace, packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "hyprspace";

  roles.server = {
    interface = {
      options = {
        blockRfc1918Addresses = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = ''
            If true, blocks RFC1918 addresses using the firewall to stop hyprspace from connecting to it.
            Some providers such as Hetzner will sent out abuse reports if you connect to these addresses.
          '';
        };
      };
    };

    perInstance =
      { settings, ... }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:

          {
            imports = [
              hyprspace.nixosModules.default
            ];
            systemd.services.hyprspace.serviceConfig.IPAddressDeny = lib.mkIf settings.blockRfc1918Addresses [
              "10.0.0.0/8"
              "172.16.0.0/12"
              "192.168.0.0/16"
            ];
            services.hyprspace = {
              enable = true;

              # To get a private key and peer ID, use `hyprspace init`
              privateKeyFile = config.clan.core.vars.generators.hyprspace.files.private-key.path;

              # Same as the config file
              settings.peers =
                let
                  machineDirs = builtins.readDir "${config.clan.core.settings.directory}/vars/per-machine";
                  peers = lib.filterAttrs (
                    name: type:
                    type == "directory"
                    && name != config.clan.core.settings.machine.name
                    && builtins.pathExists "${config.clan.core.settings.directory}/vars/per-machine/${name}/hyprspace/peer-id/value"

                  ) machineDirs;
                in
                lib.mapAttrsToList (
                  name: _:
                  builtins.fromJSON (
                    builtins.readFile "${config.clan.core.settings.directory}/vars/per-machine/${name}/hyprspace/peer-id/value"
                  )
                ) peers;
            };

            networking.firewall.allowedTCPPorts = [ 8001 ];
            networking.firewall.allowedUDPPorts = [ 8001 ];

            clan.core.vars.generators.hyprspace =
              let
                hyprspace-pre-generate = packages.${pkgs.hostPlatform.system}.hyprspace-pre-generate;
              in
              {
                files.private-key = { };
                files.peer-id = {
                  deploy = false;
                  secret = false;
                };
                files.ip = {
                  deploy = false;
                  secret = false;
                };
                runtimeInputs = [
                  hyprspace.packages.${pkgs.hostPlatform.system}.hyprspace
                  pkgs.jq
                  hyprspace-pre-generate
                ];
                script = ''
                  set -x
                  PEER_DATA=$(hyprspace init -c "$out"/hyprspace.json  | tail -n+3 | jq '.name = "${config.clan.core.settings.machine.name}"')
                  jq -r '.privateKey' < "$out"/hyprspace.json > "$out"/private-key

                  echo -n "$PEER_DATA" > "$out"/peer-id
                  PEER_ID=$(echo "$PEER_DATA" | jq '.id' -r)
                  echo "PEER_ID: $PEER_ID" 
                  hyprspace-pre-generate "$PEER_ID" > "$out"/ip
                '';
              };
          };
      };
  };
}
