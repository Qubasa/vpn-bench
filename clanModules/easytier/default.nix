{ easytier-src }:
{ lib, ... }:

let
  inherit (lib)
    substring
    ;

  # the tun interface name is derived from the instance name
  getInterface = instanceName: substring 0 15 instanceName;

in
{
  _class = "clan.service";
  manifest.name = "easytier";
  manifest.description = "Easytier decentralized VPN";
  manifest.categories = [ "Utility" ];

  roles.peer = {
    perInstance =
      {
        instanceName,
        ...
      }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          let

            interface = getInterface instanceName;

            ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
              libraries = [ ];
              doCheck = false;
            } (builtins.readFile ./ipgenv6.py);
          in
          {
            # vars
            clan.core.vars.generators."easytier-${instanceName}-key" = {
              files.shared-secret.secret = true;
              share = true;
              runtimeInputs = [
                pkgs.pwgen
              ];
              script = ''
                pwgen -s 32 1 > $out/shared-secret
              '';
            };

            # firewall
            networking.firewall.allowedTCPPorts = [
              11010
              11011
            ];
            networking.firewall.allowedUDPPorts = [
              11010
              11011
            ];

            clan.core.vars.generators."easytier-${instanceName}-ula" = {
              share = true;
              files.network = {
                secret = false;
                deploy = false;
              };

              runtimeInputs = [
                ipgenv6
                pkgs.coreutils
              ];

              script = ''
                ipgenv6 --generate-prefix | tr -d "\n" > "$out"/network
              '';
            };

            clan.core.vars.generators."easytier-${instanceName}" = {
              files.ip = {
                deploy = false;
                secret = false;
              };
              dependencies = [
                "easytier-${instanceName}-ula"
              ];
              runtimeInputs = [
                pkgs.coreutils
                pkgs.gnused
                pkgs.gnugrep
                ipgenv6
              ];
              script = ''
                ipgenv6 --prefix "$(cat "$in"/easytier-${instanceName}-ula/network)" | tr -d "\n" > "$out"/ip
              '';
            };
            # pre-service to update environment file with network_secret
            systemd.services."easytier-${instanceName}-update-env" = {
              description = "Update EasyTier environment file with shared secret";
              before = [ "easytier-${instanceName}.service" ];
              requiredBy = [ "easytier-${instanceName}.service" ];
              # TODO: upstream systemd CREDENTIALS_DIRECTORY support
              # this is a hack and will lead the VPN to restart on each activation
              # sops should not delete the /run/secrets directory
              partOf = [ "sysinit-reactivation.target" ];
              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
              };
              script = ''
                mkdir -p /run/secrets/easytier
                echo "ET_NETWORK_SECRET=\"$(cat ${
                  config.clan.core.vars.generators."easytier-${instanceName}-key".files.shared-secret.path
                })\"" \
                  > "/run/secrets/easytier/${instanceName}.env"
              '';
            };

            systemd.services."easytier-${instanceName}" = {
              partOf = [
                "easytier-${instanceName}-update-env.service"
              ];
              # exits with 0 sometimes if it cannot connect
              # see https://github.com/EasyTier/EasyTier/issues/1167
              serviceConfig.Restart = lib.mkForce "always";
            };

            # easytier
            services.easytier = {
              enable = true;
              package = pkgs.callPackage ./package.nix { inherit easytier-src; };
              instances.${instanceName} = {
                environmentFiles = [
                  "/run/secrets/easytier/${instanceName}.env"
                ];
                settings = {
                  network_name = "${instanceName}4";
                  listeners = [
                    "tcp://0.0.0.0:11010"
                  ];
                  peers = [
                    "tcp://public.easytier.cn:11010"
                  ];
                  dhcp = true;
                };
                extraSettings = {
                  flags.dev_name = interface;
                  ipv6 = "${config.clan.core.vars.generators."easytier-${instanceName}".files.ip.value}/64";
                };
              };
            };
          };
      };
  };

}
