{ packages }:
{ lib, ... }:
let
  # vnts hands out (and accepts requested) addresses from this network; its gateway takes .1.
  network = "10.72.0.0/24";
  prefixLength = lib.last (lib.splitString "/" network);
  # vnts control plane: TLS over TCP and QUIC share the port.
  serverPort = 29872;
  # Client-to-client P2P tunnel (UDP data plane, TCP listener as well).
  tunnelPort = 29873;
  device = "vnt0";

  networkGenerator = instanceName: "vnt-${instanceName}-network";
  serverGenerator = instanceName: "vnt-${instanceName}-server";

  # Network code (vnts' tenant/token) and the end-to-end password (ChaCha20-Poly1305) are
  # shared by every machine. The module `key` makes a machine in both roles import it once.
  networkModule = instanceName: {
    key = "vnt-${instanceName}-network";
    imports = [
      (
        { pkgs, ... }:
        {
          clan.core.vars.generators.${networkGenerator instanceName} = {
            share = true;
            files.network-code.secret = true;
            files.password.secret = true;
            runtimeInputs = [ pkgs.openssl ];
            script = ''
              openssl rand -hex 16 | tr -d '\n' > "$out"/network-code
              openssl rand -hex 32 | tr -d '\n' > "$out"/password
            '';
          };
        }
      )
    ];
  };
in
{
  _class = "clan.service";
  manifest.name = "vnt";
  manifest.description = "VNT virtual network with a self-hosted vnts server and direct encrypted P2P links";
  manifest.categories = [
    "System"
    "Network"
  ];

  roles.server = {
    description = "Runs vnts, the registration/relay server every peer connects to. Exactly one per instance.";
    interface.options = {
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "Public IPv4 address peers use to reach vnts.";
      };
    };

    perInstance =
      { instanceName, ... }:
      {
        nixosModule =
          {
            config,
            pkgs,
            ...
          }:
          let
            vnts = packages.${pkgs.hostPlatform.system}.vnts;
            generator = config.clan.core.vars.generators.${serverGenerator instanceName};
          in
          {
            imports = [ (networkModule instanceName) ];

            networking.firewall.allowedTCPPorts = [ serverPort ];
            networking.firewall.allowedUDPPorts = [ serverPort ];

            # Self-signed TLS identity of vnts; peers pin its SHA-256 fingerprint instead of
            # skipping certificate verification (the client default).
            clan.core.vars.generators.${serverGenerator instanceName} = {
              files.key = {
                secret = true;
                restartUnits = [ "vnts.service" ];
              };
              files.cert = {
                secret = false;
                restartUnits = [ "vnts.service" ];
              };
              files.fingerprint = {
                secret = false;
                deploy = false;
              };
              runtimeInputs = [
                pkgs.openssl
                pkgs.coreutils
              ];
              script = ''
                openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
                  -keyout "$out"/key -out "$out"/cert -days 3650 -nodes \
                  -subj "/CN=vnts-${instanceName}"
                openssl x509 -in "$out"/cert -outform DER | sha256sum | cut -d' ' -f1 \
                  | tr -d '\n' > "$out"/fingerprint
              '';
            };

            systemd.services.vnts = {
              description = "VNT server";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              # The network code is a secret, so the config is assembled at start outside the store.
              # Only the tenant created from our network code may register (white_list); no web
              # UI, no sqlite persistence, nothing to update.
              preStart = ''
                cat > /run/vnts/config.toml <<EOF
                tcp_bind = "0.0.0.0:${toString serverPort}"
                quic_bind = "0.0.0.0:${toString serverPort}"
                network = "${network}"
                white_list = ["$(cat "$CREDENTIALS_DIRECTORY/network-code")"]
                lease_duration = 86400
                persistence = false
                cert = "$CREDENTIALS_DIRECTORY/cert"
                key = "$CREDENTIALS_DIRECTORY/key"
                EOF
              '';
              serviceConfig = {
                ExecStart = "${lib.getExe vnts} --conf /run/vnts/config.toml";
                LoadCredential = [
                  "network-code:${
                    config.clan.core.vars.generators.${networkGenerator instanceName}.files.network-code.path
                  }"
                  "cert:${generator.files.cert.path}"
                  "key:${generator.files.key.path}"
                ];
                # vnts writes its rolling log files to ./logs.
                StateDirectory = "vnts";
                WorkingDirectory = "/var/lib/vnts";
                RuntimeDirectory = "vnts";
                RuntimeDirectoryMode = "0700";
                UMask = "0077";
                Restart = "always";
                RestartSec = "3s";
                Slice = "benchmark.slice";
              };
            };
          };
      };
  };

  roles.peer = {
    description = "Runs the VNT client; peers register with the server and connect directly to each other.";
    interface.options = {
      ip = lib.mkOption {
        type = lib.types.str;
        description = "Fixed overlay IPv4 address of this machine inside ${network} (not .0, .1 or .255).";
        example = "10.72.0.2";
      };
      publicAddress = lib.mkOption {
        type = lib.types.str;
        description = "Public IPv4 address other peers dial for the direct tunnel.";
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
            vnt = packages.${pkgs.hostPlatform.system}.vnt;
            networkVars = config.clan.core.vars.generators.${networkGenerator instanceName};
            serverNames = lib.attrNames (roles.server.machines or { });
            serverName =
              if lib.length serverNames == 1 then
                lib.head serverNames
              else
                throw "The vnt instance '${instanceName}' needs exactly one machine with the 'server' role.";
            server = roles.server.machines.${serverName};

            fingerprintPath = "${config.clan.core.settings.directory}/vars/per-machine/${serverName}/${serverGenerator instanceName}/fingerprint/value";
            fingerprint =
              lib.throwIfNot (builtins.pathExists fingerprintPath)
                "vnt: ${fingerprintPath} is missing; run `clan vars generate ${serverName}` first."
                (builtins.readFile fingerprintPath);

            # Every other peer is dialed directly over UDP. Together with no_punch this gives a
            # full mesh of direct links without STUN; vnts only registers peers and would relay
            # if a direct link failed.
            peerAddresses = lib.mapAttrsToList (
              _name: peer: "udp://${peer.settings.publicAddress}:${toString tunnelPort}"
            ) (lib.filterAttrs (name: _: name != machine.name) roles.peer.machines);

            # Everything except network_code and password, which are appended at service start
            # so the secrets stay out of the nix store.
            publicConfig = (pkgs.formats.toml { }).generate "vnt-${instanceName}.toml" {
              server = [ "quic://${server.settings.publicAddress}:${toString serverPort}" ];
              cert_mode = "finger:${fingerprint}";
              ip = "${settings.ip}/${prefixLength}";
              device_id = machine.name;
              device_name = machine.name;
              tun_name = device;
              tunnel_addr = [ "0.0.0.0:${toString tunnelPort}" ];
              peer_address = peerAddresses;
              # Automatic hole punching discovers public addresses through hardcoded public
              # STUN servers (Google, Xiaomi, Bilibili, ...); all peers are directly reachable,
              # so explicit peer addresses replace it.
              no_punch = true;
              # The upstream default control port, set explicitly: with the implicit default the
              # client tries to write a PORT file next to its binary in the read-only store.
              # vnt2_ctrl falls back to this port when there is no PORT file.
              ctrl_port = 11233;
            };
          in
          {
            imports = [ (networkModule instanceName) ];

            networking.firewall.allowedTCPPorts = [ tunnelPort ];
            networking.firewall.allowedUDPPorts = [ tunnelPort ];
            networking.firewall.trustedInterfaces = [ device ];

            # vnt2_ctrl talks to the running client's local control port (info, route, clients).
            environment.systemPackages = [ vnt ];

            systemd.services.vnt = {
              description = "VNT client";
              wantedBy = [ "multi-user.target" ];
              wants = [ "network-online.target" ];
              after = [ "network-online.target" ];
              preStart = ''
                {
                  cat ${publicConfig}
                  printf 'network_code = "%s"\n' "$(cat "$CREDENTIALS_DIRECTORY/network-code")"
                  printf 'password = "%s"\n' "$(cat "$CREDENTIALS_DIRECTORY/password")"
                } > /run/vnt/config.toml
              '';
              serviceConfig = {
                ExecStart = "${lib.getExe vnt} --conf /run/vnt/config.toml";
                LoadCredential = [
                  "network-code:${networkVars.files.network-code.path}"
                  "password:${networkVars.files.password.path}"
                ];
                # vnt2_cli writes its rolling log files to ./logs.
                StateDirectory = "vnt";
                WorkingDirectory = "/var/lib/vnt";
                RuntimeDirectory = "vnt";
                RuntimeDirectoryMode = "0700";
                UMask = "0077";
                Restart = "always";
                RestartSec = "3s";
                Slice = "benchmark.slice";
              };
            };
          };
      };
  };
}
