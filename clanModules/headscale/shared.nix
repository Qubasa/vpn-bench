{
  lib,
  pkgs,
  instanceName,
  settings,
  serverUrl,
  machine,
  controllerInfo ? null,
  isController,
  isPeer ? true, # By default, all nodes are peers
}:
let
  # User name for the headscale user (all machines join under this user)
  userName = "clan-${instanceName}";

  # Interface name (limited to 15 chars for Linux)
  interface = lib.substring 0 15 "ts-${instanceName}";

  # Preauthkey file location on controller
  preauthKeyFile = "/var/lib/headscale/preauthkeys/${userName}.key";

  # Keyserver port
  keyserverPort = 8081;

  # IPv6 ULA generation script (same as easytier)
  ipgenv6 = pkgs.writers.writePython3Bin "ipgenv6" {
    libraries = [ ];
    doCheck = false;
  } (builtins.readFile ./ipgenv6.py);

  # Controller-specific configuration
  controllerConfig = lib.optionalAttrs isController {
    services.headscale = {
      enable = true;
      address = "0.0.0.0";
      port = settings.port;

      settings = {
        server_url = serverUrl;

        # IP prefixes for the tailnet
        prefixes = {
          v4 = "100.64.0.0/10";
          v6 = "fd7a:115c:a1e0::/48";
          allocation = "sequential";
        };

        # DNS configuration with MagicDNS
        dns = {
          magic_dns = true;
          base_domain = settings.baseDomain;
          override_local_dns = false;
          nameservers.global = [
            "1.1.1.1"
            "8.8.8.8"
          ];
        };

        # DERP (relay) configuration - use Tailscale's public DERP servers
        derp = {
          urls = [ "https://controlplane.tailscale.com/derpmap/default" ];
          auto_update_enabled = true;
          update_frequency = "24h";
        };

        # Database configuration (SQLite)
        database = {
          type = "sqlite";
          sqlite = {
            path = "/var/lib/headscale/db.sqlite";
            write_ahead_log = true;
          };
        };

        # Logging
        log = {
          level = "info";
          format = "text";
        };

        # Disable policy file (allow all traffic within the network)
        policy.mode = "file";
        policy.path = null;
      };
    };

    # Open firewall for headscale
    networking.firewall = lib.mkIf settings.openFirewall {
      allowedTCPPorts = [
        settings.port
        keyserverPort
      ];
      allowedUDPPorts = [ 3478 ]; # STUN
    };

    # Benchmark resource slice
    systemd.services.headscale.serviceConfig.Slice = "benchmark.slice";

    # Create directory for preauthkeys
    systemd.tmpfiles.rules = [
      "d /var/lib/headscale/preauthkeys 0755 headscale headscale -"
    ];

    # Setup service that creates user and generates preauthkeys after headscale starts
    systemd.services."headscale-${instanceName}-setup" = {
      description = "Initialize headscale user and preauthkeys for ${instanceName}";
      after = [ "headscale.service" ];
      requires = [ "headscale.service" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        User = "headscale";
        Group = "headscale";
      };

      path = [
        pkgs.headscale
        pkgs.coreutils
        pkgs.gnugrep
        pkgs.jq
      ];

      script = ''
        set -euo pipefail

        # Wait for headscale to be ready
        for i in $(seq 1 30); do
          if headscale users list &>/dev/null; then
            break
          fi
          echo "Waiting for headscale to be ready... ($i/30)"
          sleep 2
        done

        # Create user if it doesn't exist
        if ! headscale users list -o json | jq -e '.[] | select(.name == "${userName}")' > /dev/null 2>&1; then
          echo "Creating user ${userName}"
          headscale users create "${userName}"
        fi

        # Get the user ID (headscale CLI requires numeric ID, not username)
        USER_ID=$(headscale users list -o json | jq -r '.[] | select(.name == "${userName}") | .id')
        if [ -z "$USER_ID" ]; then
          echo "Failed to get user ID for ${userName}"
          exit 1
        fi
        echo "Found user ${userName} with ID: $USER_ID"

        # Generate a reusable preauthkey if one doesn't exist or is expired
        if [ ! -f "${preauthKeyFile}" ] || [ ! -s "${preauthKeyFile}" ]; then
          echo "Generating new preauthkey for ${userName} (user ID: $USER_ID)"
          # Create a reusable key that expires in 10 years
          headscale preauthkeys create --user "$USER_ID" --reusable --expiration 87600h | tail -1 > "${preauthKeyFile}"
          chmod 644 "${preauthKeyFile}"
        fi

        echo "Headscale setup complete for ${instanceName}"
      '';
    };

    # Simple HTTP server to serve preauthkeys to peers (on a separate port)
    # This allows peers to fetch their keys without SSH
    systemd.services."headscale-${instanceName}-keyserver" = {
      description = "Serve headscale preauthkeys for ${instanceName}";
      after = [ "headscale-${instanceName}-setup.service" ];
      requires = [ "headscale-${instanceName}-setup.service" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "simple";
        User = "headscale";
        Group = "headscale";
        Restart = "always";
        RestartSec = 5;
        Slice = "benchmark.slice";
      };

      script = ''
        ${pkgs.python3}/bin/python3 -m http.server ${toString keyserverPort} --directory /var/lib/headscale/preauthkeys --bind 0.0.0.0
      '';
    };
  };

  # Peer (Tailscale client) configuration
  peerConfig = lib.optionalAttrs isPeer {
    services.tailscale = {
      enable = true;
      # Use the interface name for the tunnel
      interfaceName = interface;
    };

    # Shared ULA prefix generator (shared across all machines in this instance)
    clan.core.vars.generators."headscale-${instanceName}-ula" = {
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

    # Generator to produce the VPN IPv6 for this peer
    clan.core.vars.generators."headscale-${instanceName}" = {
      files.ip = {
        deploy = false;
        secret = false;
      };
      dependencies = [
        "headscale-${instanceName}-ula"
      ];
      runtimeInputs = [
        pkgs.coreutils
        pkgs.gnused
        pkgs.gnugrep
        ipgenv6
      ];
      script = ''
        ipgenv6 --prefix "$(cat "$in"/headscale-${instanceName}-ula/network)" | tr -d "\n" > "$out"/ip
      '';
    };

    # Benchmark resource slice
    systemd.services.tailscaled.serviceConfig.Slice = "benchmark.slice";

    # Service to authenticate with headscale
    systemd.services."tailscale-${instanceName}-auth" = {
      description = "Authenticate Tailscale with headscale for ${instanceName}";
      after = [
        "tailscaled.service"
        "network-online.target"
      ]
      ++ lib.optionals isController [
        "headscale-${instanceName}-setup.service"
        "headscale-${instanceName}-keyserver.service"
      ];
      requires = [ "tailscaled.service" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        Restart = "on-failure";
        RestartSec = 10;
        Slice = "benchmark.slice";
      };

      path = [
        pkgs.tailscale
        pkgs.curl
        pkgs.coreutils
        pkgs.jq
      ];

      script =
        let
          # For controller, use localhost; for peers, use the controller's address
          controllerHost = if isController then "127.0.0.1" else controllerInfo.publicAddress;
          # Use HTTP since headscale is not configured with TLS
          loginServerUrl = if isController then "http://127.0.0.1:${toString settings.port}" else serverUrl;
        in
        ''
          set -euo pipefail

          CONTROLLER_HOST="${controllerHost}"
          KEYSERVER_PORT="${toString keyserverPort}"

          # Wait for the key server to be available
          echo "Waiting for headscale keyserver at $CONTROLLER_HOST:$KEYSERVER_PORT..."
          for i in $(seq 1 60); do
            if curl -sf "http://$CONTROLLER_HOST:$KEYSERVER_PORT/${userName}.key" > /dev/null 2>&1; then
              break
            fi
            echo "Keyserver not ready, waiting... ($i/60)"
            sleep 5
          done

          # Fetch the preauthkey
          AUTHKEY=$(curl -sf "http://$CONTROLLER_HOST:$KEYSERVER_PORT/${userName}.key")

          if [ -z "$AUTHKEY" ]; then
            echo "Failed to fetch preauthkey"
            exit 1
          fi

          # Check if already authenticated
          if tailscale status &>/dev/null; then
            STATUS=$(tailscale status --json 2>/dev/null | jq -r '.BackendState' || echo "unknown")
            if [ "$STATUS" = "Running" ]; then
              echo "Tailscale already authenticated and running"
              exit 0
            fi
          fi

          # Authenticate with headscale
          echo "Authenticating with headscale at ${loginServerUrl}..."
          tailscale up \
            --login-server="${loginServerUrl}" \
            --authkey="$AUTHKEY" \
            --hostname="${machine.name}" \
            --accept-routes=${if settings.acceptRoutes or true then "true" else "false"} \
            ${lib.optionalString (settings.exitNode or false) "--advertise-exit-node"} \
            --reset

          echo "Tailscale authentication complete"
        '';
    };

    # Open firewall for Tailscale/WireGuard
    networking.firewall = {
      # Tailscale uses WireGuard which needs UDP
      allowedUDPPorts = [ 41641 ];
      # Trust the tailscale interface
      trustedInterfaces = [ interface ];
    };
  };

  # Assertions configuration
  assertionsConfig = {
    assertions = lib.mkIf (!isController) [
      {
        assertion = controllerInfo != null;
        message = "Peers require controllerInfo to be set.";
      }
    ];
  };
in
# Return a proper NixOS module by recursively merging configs
lib.recursiveUpdate (lib.recursiveUpdate controllerConfig peerConfig) assertionsConfig
