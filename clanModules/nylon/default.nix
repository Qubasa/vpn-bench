{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "nylon";
  manifest.description = "nylon WireGuard mesh with Babel routing, as a full static mesh";
  manifest.categories = [
    "System"
    "Network"
  ];

  roles.peer = {
    description = "A nylon router; every peer peers directly with every other peer.";
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
            nylon = packages.${pkgs.hostPlatform.system}.nylon;
            port = 57175;
            device = "nylon";
            generatorName = "nylon-${instanceName}";
            generator = config.clan.core.vars.generators.${generatorName};

            # attrNames is sorted, so a machine's position is the same on every machine and
            # distinct per machine: host number i+1 of 10.73.0.0/16 cannot collide.
            peerNames = lib.attrNames roles.peer.machines;
            addressOf =
              name:
              let
                host = lib.lists.findFirstIndex (n: n == name) null peerNames + 1;
              in
              "10.73.${toString (host / 256)}.${toString (lib.mod host 256)}";
            address = addressOf machine.name;

            publicKeyPath =
              name:
              "${config.clan.core.settings.directory}/vars/per-machine/${name}/${generatorName}/public/value";
            routerNames = lib.filter (name: builtins.pathExists (publicKeyPath name)) peerNames;

            # No `dist` section: nylon then never fetches or polls config bundles.
            centralConfig = (pkgs.formats.yaml { }).generate "nylon-central-${instanceName}.yaml" {
              routers = map (name: {
                id = name;
                pubkey = builtins.readFile (publicKeyPath name);
                addresses = [ (addressOf name) ];
                endpoints = [ "${roles.peer.machines.${name}.settings.publicAddress}:${toString port}" ];
              }) routerNames;
              # A single graph line fully interconnects all listed nodes, so every pair
              # gets a direct WireGuard tunnel.
              graph = [ (lib.concatStringsSep ", " routerNames) ];
              timestamp = 0;
            };
          in
          {
            networking.firewall.allowedUDPPorts = [ port ];
            networking.firewall.trustedInterfaces = [ device ];

            # For `nylon status` against the running daemon.
            environment.systemPackages = [ nylon ];

            systemd.services.nylon = {
              description = "nylon mesh VPN daemon";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              # nylon configures the interface address and per-peer routes by running `ip`.
              path = [ pkgs.iproute2 ];
              # node.yaml carries the private key, so it is assembled at start from the
              # credential instead of living in the nix store.
              preStart = ''
                {
                  printf 'key: %s\n' "$(cat "$CREDENTIALS_DIRECTORY/private")"
                  printf 'id: %s\n' ${lib.escapeShellArg machine.name}
                  printf 'port: %s\n' ${toString port}
                  printf 'interface_name: %s\n' ${device}
                } > /run/nylon/node.yaml
              '';
              serviceConfig = {
                ExecStart = "${lib.getExe nylon} run -c ${centralConfig} -n /run/nylon/node.yaml";
                LoadCredential = [ "private:${generator.files.private.path}" ];
                RuntimeDirectory = "nylon";
                RuntimeDirectoryMode = "0700";
                UMask = "0077";
                Restart = "always";
                RestartSec = "3s";
                Slice = "benchmark.slice";
              };
            };

            clan.core.vars.generators.${generatorName} = {
              files.private.restartUnits = [ "nylon.service" ];
              files.public = {
                secret = false;
                deploy = false;
                restartUnits = [ "nylon.service" ];
              };
              files.ip = {
                secret = false;
                deploy = false;
              };
              # The address depends on the peer set; regenerate when it changes so the `ip`
              # var always matches the address in the central config.
              validation = { inherit address; };
              runtimeInputs = [
                nylon
                pkgs.coreutils
              ];
              script = ''
                nylon genkey | tr -d '\n' > "$out"/private
                # `nylon pubkey` needs the private key newline-terminated on stdin.
                { cat "$out"/private; echo; } | nylon pubkey | tr -d '\n' > "$out"/public
                printf '%s' ${address} > "$out"/ip
              '';
            };
          };
      };
  };
}
