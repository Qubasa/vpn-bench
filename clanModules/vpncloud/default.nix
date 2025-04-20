{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "vpncloud";

  roles.peer = {
    interface = {
      options = {
        peerIps = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = ''
            List of static public IPs of the peers. In the form of
            "<ip>:<port>"
          '';
        };
      };
    };

    perInstance =
      { roles, settings, ... }:
      {
        nixosModule =
          {
            config,
            pkgs,
            lib,
            ...
          }:
          let
            vpncloud = packages.${pkgs.hostPlatform.system}.vpncloud;
            machines = lib.attrNames (roles.peer.machines or { });
            machinePubPath =
              name: "${config.clan.core.settings.directory}/vars/per-machine/${name}/vpncloud/public-key/value";
            machineVals =
              valPath:
              builtins.foldl' (
                ips: name:
                if builtins.pathExists (valPath name) then
                  ips
                  ++ [
                    (builtins.readFile (valPath name))
                  ]
                else
                  ips
              ) [ ] machines;
            machinePubVals = machineVals machinePubPath;
            machineIpPath =
              name: "${config.clan.core.settings.directory}/vars/per-machine/${name}/vpncloud/ip/value";
            machineIpVals = machineVals machineIpPath;

            ipgenv4 = pkgs.writers.writePython3Bin "ipgenv4" {
              libraries = [ ];
              doCheck = false;
            } (builtins.readFile ./ipgenv4.py);
          in
          {
            assertions = [
              {
                assertion = machineIpVals == (lib.unique machineIpVals);
                message = ''
                  Randomly generated IPs are not unique.
                  Please regenerate vpncloud Ips by executing:
                  $ clan vars generate --generator vpncloud --regenerate
                  ---
                  Found duplicates: ${builtins.concatStringsSep " " machineIpVals}
                '';
              }
            ];

            imports = [
              (lib.modules.importApply ./service.nix { inherit vpncloud; })
            ];

            services.vpncloud = {
              enable = true;
              privateKeyFile = config.clan.core.vars.generators.vpncloud.files.private-key.path;
              publicKeyFile = config.clan.core.vars.generators.vpncloud.files.public-key.path;
              trustedKeys = machinePubVals;
              ipAddr = "${config.clan.core.vars.generators.vpncloud.files.ip.value}/16";
              openFirewall = true;
              peers = settings.peerIps;
            };

            clan.core.vars.generators.vpncloud-ula = {
              share = true;
              files.network = {
                secret = false;
                deploy = false;
              };

              runtimeInputs = [
                ipgenv4
                pkgs.coreutils
              ];

              script = ''
                ipgenv4 --generate-network | tr -d "\n" > "$out"/network
              '';
            };

            clan.core.vars.generators.vpncloud = {
              files.private-key = { };
              files.public-key = {
                deploy = false;
                secret = false;
              };
              files.ip = {
                deploy = false;
                secret = false;
              };
              dependencies = [
                "vpncloud-ula"
              ];
              runtimeInputs = [
                pkgs.coreutils
                pkgs.gnused
                pkgs.gnugrep
                vpncloud
                ipgenv4
              ];
              script = ''
                keys=$(vpncloud genkey)
                pubkey=$(echo "$keys" | grep "Public key:" | sed 's/Public key: *//' | tr -d "\n")
                echo "$keys" | grep "Private key:" | sed 's/Private key: *//' | tr -d "\n" > "$out"/private-key
                echo -n "$pubkey" > "$out"/public-key
                ipgenv4 --network "$(cat "$in"/vpncloud-ula/network)" --public-key "$pubkey" | tr -d "\n" > "$out"/ip
              '';
            };
          };
      };
  };
}
