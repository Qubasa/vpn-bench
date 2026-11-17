{ packages }:
{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "cjdns";
  manifest.description = "cjdns encrypted IPv6 mesh network";
  manifest.categories = [ "Network" ];

  roles.peer = {
    description = "A cjdns node that peers with every other node of the instance over UDP.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = ''
          Public IPv4 address the other peers use to reach this node.
        '';
      };
    };

    perInstance =
      {
        instanceName,
        roles,
        machine,
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
            cjdns = packages.${pkgs.hostPlatform.system}.cjdns;
            port = 48190;
            tunDevice = "cjdns";
            generator = "cjdns-${instanceName}";
            passwordGenerator = "cjdns-${instanceName}-password";
            login = "vpn-bench";
            vars = config.clan.core.vars.generators;

            publicKeyPath =
              name:
              "${config.clan.core.settings.directory}/vars/per-machine/${name}/${generator}/public-key/value";

            # Peers whose key is not generated yet are left out until the next evaluation.
            connectTo =
              lib.mapAttrs'
                (
                  name: peer:
                  lib.nameValuePair "${peer.settings.publicAddress}:${toString port}" {
                    inherit login;
                    peerName = name;
                    publicKey = builtins.readFile (publicKeyPath name);
                  }
                )
                (
                  lib.filterAttrs (
                    name: _: name != machine.name && builtins.pathExists (publicKeyPath name)
                  ) roles.peer.machines
                );

            # privateKey and the passwords are filled in from vars at service start.
            configTemplate = pkgs.writeText "cjdroute.json" (
              builtins.toJSON {
                pipe = "/run/cjdns/cjdroute.sock";
                admin = {
                  bind = "127.0.0.1:11234";
                  # cjdnstool's default credentials (as in `cjdroute --genconf`); localhost only.
                  password = "NONE";
                };
                authorizedPasswords = [ { user = login; } ];
                interfaces.UDPInterface = [
                  {
                    bind = "0.0.0.0:${toString port}";
                    beacon = 0;
                    inherit connectTo;
                  }
                ];
                router = {
                  interface = {
                    type = "TUNInterface";
                    inherit tunDevice;
                  };
                  ipTunnel = {
                    allowedConnections = [ ];
                    outgoingConnections = [ ];
                  };
                  # No dnsSeeds/supernodes/publicPeer: the node must only peer via connectTo.
                  supernodes = [ ];
                };
                # Without logTo the core's DEBUG-level log only goes to admin subscribers
                # instead of flooding the journal during benchmarks.
                logging = { };
                noBackground = 1;
                security = [
                  {
                    setuser = "nobody";
                    keepNetAdmin = 1;
                  }
                  { chroot = "/var/run/"; }
                  { nofiles = 0; }
                  { noforks = 1; }
                  { setupComplete = 1; }
                ];
              }
            );
          in
          {
            clan.core.vars.generators.${passwordGenerator} = {
              share = true;
              files.password.restartUnits = [ "cjdns.service" ];
              runtimeInputs = [ pkgs.coreutils ];
              script = ''
                head -c 24 /dev/urandom | basenc --base16 -w0 > "$out"/password
              '';
            };

            clan.core.vars.generators.${generator} = {
              files.private-key.restartUnits = [ "cjdns.service" ];
              files.public-key = {
                secret = false;
                deploy = false;
              };
              files.ip = {
                secret = false;
                deploy = false;
              };
              runtimeInputs = [ cjdns ];
              # `cjdnstool util keygen` prints "<private key> <public key> <ipv6>".
              script = ''
                read -r private public ip <<< "$(cjdnstool util keygen)"
                printf '%s' "$private" > "$out"/private-key
                printf '%s' "$public" > "$out"/public-key
                printf '%s' "$ip" > "$out"/ip
              '';
            };

            environment.systemPackages = [ cjdns ];

            boot.kernelModules = [ "tun" ];

            networking.firewall = {
              allowedUDPPorts = [ port ];
              trustedInterfaces = [ tunDevice ];
            };

            systemd.services.cjdns = {
              description = "cjdns routing engine";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              path = [ pkgs.jq ];
              script = ''
                jq \
                  --rawfile key ${vars.${generator}.files.private-key.path} \
                  --rawfile pw ${vars.${passwordGenerator}.files.password.path} \
                  '.privateKey = $key
                  | .authorizedPasswords[].password = $pw
                  | .interfaces.UDPInterface[].connectTo[].password = $pw' \
                  ${configTemplate} > /run/cjdns/cjdroute.conf
                exec ${lib.getExe cjdns} --nobg < /run/cjdns/cjdroute.conf
              '';
              serviceConfig = {
                Slice = "benchmark.slice";
                RuntimeDirectory = "cjdns";
                RuntimeDirectoryMode = "0700";
                Restart = "always";
                RestartSec = 1;
                ProtectHome = true;
                PrivateTmp = true;
              };
              startLimitIntervalSec = 0;
            };
          };
      };
  };
}
