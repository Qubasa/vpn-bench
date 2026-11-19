{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "wireguard-go";
  manifest.description = "Userspace WireGuard (wireguard-go on a TUN device) as a static full mesh";
  manifest.categories = [
    "System"
    "Network"
  ];

  roles.mesh = {
    description = "A WireGuard peer; every mesh machine peers directly with every other one.";
    interface.options = {
      address = lib.mkOption {
        type = lib.types.str;
        description = "Overlay IPv4 address of this machine (without prefix length).";
      };
      endpoint = lib.mkOption {
        type = lib.types.str;
        description = "host:port other peers use to reach this machine.";
      };
      listenPort = lib.mkOption {
        type = lib.types.port;
        default = 6667;
      };
      prefixLength = lib.mkOption {
        type = lib.types.ints.between 0 32;
        default = 24;
        description = "Prefix length of the overlay subnet assigned to the interface.";
      };
    };

    perInstance =
      {
        instanceName,
        settings,
        machine,
        roles,
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
            system = pkgs.hostPlatform.system;
            wireguard-go = packages.${system}.wireguard-go;
            wireguard-tools = packages.${system}.wireguard-tools;
            # Fixed name so the benchmark and firewall do not depend on the instance name.
            device = "wggo0";
            unit = "wireguard-go-${instanceName}";
            generatorName = "wireguard-go-${instanceName}";
            generator = config.clan.core.vars.generators.${generatorName};

            publicKey =
              name:
              builtins.readFile "${config.clan.core.settings.directory}/vars/per-machine/${name}/${generatorName}/public-key/value";

            # Everything but the private key, which is set from the credential afterwards so it
            # never enters the nix store.
            publicConfig = pkgs.writeText "${unit}.conf" ''
              [Interface]
              ListenPort = ${toString settings.listenPort}
              ${lib.concatStrings (
                lib.mapAttrsToList (
                  name: peer:
                  lib.optionalString (name != machine.name) ''

                    [Peer]
                    PublicKey = ${lib.removeSuffix "\n" (publicKey name)}
                    AllowedIPs = ${peer.settings.address}/32
                    Endpoint = ${peer.settings.endpoint}
                  ''
                ) roles.mesh.machines
              )}
            '';

            configure = pkgs.writeShellScript "${unit}-configure" ''
              set -eu
              # wireguard-go creates the UAPI socket only after the TUN device is up.
              for _ in $(seq 100); do
                [ -S /run/wireguard/${device}.sock ] && break
                sleep 0.1
              done
              wg setconf ${device} ${publicConfig}
              wg set ${device} private-key "$CREDENTIALS_DIRECTORY/private-key"
              ip address replace ${settings.address}/${toString settings.prefixLength} dev ${device}
              ip link set ${device} up
            '';
          in
          {
            networking.firewall.allowedUDPPorts = [ settings.listenPort ];
            networking.firewall.trustedInterfaces = [ device ];

            # For `wg show` against the UAPI socket.
            environment.systemPackages = [ wireguard-tools ];

            systemd.services.${unit} = {
              description = "wireguard-go userspace WireGuard (${instanceName})";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              path = [
                wireguard-tools
                pkgs.iproute2
                pkgs.coreutils
              ];
              serviceConfig = {
                # Foreground so systemd supervises the daemon itself; the TUN device and its
                # address disappear with the process, so a restart rebuilds everything.
                ExecStart = "${lib.getExe wireguard-go} -f ${device}";
                ExecStartPost = configure;
                LoadCredential = [ "private-key:${generator.files.private-key.path}" ];
                Restart = "always";
                RestartSec = "3s";
                Slice = "benchmark.slice";
              };
            };

            clan.core.vars.generators.${generatorName} = {
              files.private-key.restartUnits = [ "${unit}.service" ];
              files.public-key = {
                secret = false;
                deploy = false;
              };
              runtimeInputs = [ wireguard-tools ];
              script = ''
                wg genkey > "$out/private-key"
                wg pubkey < "$out/private-key" > "$out/public-key"
              '';
            };
          };
      };
  };
}
