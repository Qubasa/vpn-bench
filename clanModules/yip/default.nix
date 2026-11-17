{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "yip";
  manifest.description = "yip mesh VPN with forward error correction, as a full static mesh";
  manifest.categories = [
    "System"
    "Network"
  ];

  roles.peer = {
    description = "A yip node; every peer connects directly to every other peer.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "Public IPv4 address other peers use as this machine's endpoint.";
      };
    };

    perInstance =
      {
        instanceName,
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
            yip = packages.${pkgs.hostPlatform.system}.yip;
            port = 9420;
            device = "yip0";
            generatorName = "yip-${instanceName}";
            generator = config.clan.core.vars.generators.${generatorName};

            publicKeyPath =
              name:
              "${config.clan.core.settings.directory}/vars/per-machine/${name}/${generatorName}/public/value";

            peerBlocks = lib.concatStrings (
              lib.mapAttrsToList (
                name: peer:
                lib.optionalString (name != machine.name && builtins.pathExists (publicKeyPath name)) ''

                  [peer]
                  public_key=${builtins.readFile (publicKeyPath name)}
                  endpoint=${peer.settings.publicAddress}:${toString port}
                ''
              ) roles.peer.machines
            );

            # Everything except local_private, which is prepended at service start so the
            # private key stays out of the nix store.
            publicConfig = pkgs.writeText "yipd-${instanceName}.conf" ''
              local_public=${generator.files.public.value}
              listen=0.0.0.0:${toString port}
              device=${device}
              control_socket=/run/yipd/yip.sock
              ${peerBlocks}
            '';
          in
          {
            networking.firewall.allowedUDPPorts = [ port ];
            networking.firewall.trustedInterfaces = [ device ];

            # For `yipd peers` / `yipd status` against the control socket.
            environment.systemPackages = [ yip ];

            systemd.services.yipd = {
              description = "yip mesh VPN daemon";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              # yipd assigns its overlay address and the fd00::/8 route by running `ip`.
              path = [ pkgs.iproute2 ];
              preStart = ''
                {
                  printf 'local_private=%s\n' "$(cat "$CREDENTIALS_DIRECTORY/private")"
                  cat ${publicConfig}
                } > /run/yipd/yipd.conf
              '';
              serviceConfig = {
                ExecStart = "${lib.getExe yip} /run/yipd/yipd.conf";
                LoadCredential = [ "private:${generator.files.private.path}" ];
                RuntimeDirectory = "yipd";
                RuntimeDirectoryMode = "0700";
                UMask = "0077";
                Restart = "always";
                RestartSec = "3s";
                LimitMEMLOCK = "infinity";
                Slice = "benchmark.slice";
              };
            };

            clan.core.vars.generators.${generatorName} = {
              files.private.restartUnits = [ "yipd.service" ];
              files.public = {
                secret = false;
                deploy = false;
                restartUnits = [ "yipd.service" ];
              };
              files.ip = {
                secret = false;
                deploy = false;
              };
              runtimeInputs = [
                yip
                pkgs.coreutils
                pkgs.gnused
              ];
              script = ''
                keys=$(yipd --genkey)
                printf '%s' "$keys" | sed -n 's/^private=//p' | tr -d '\n' > "$out"/private
                printf '%s' "$keys" | sed -n 's/^public=//p' | tr -d '\n' > "$out"/public
                yipd --addr "$(cat "$out"/public)" | tr -d '\n' > "$out"/ip
              '';
            };
          };
      };
  };
}
