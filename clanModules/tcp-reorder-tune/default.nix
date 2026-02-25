{ lib, ... }:
{
  _class = "clan.service";
  manifest.name = "tcp-reorder-tune";
  manifest.description = "Optimize Linux TCP stack for high-reordering networks (matches Tailscale gVisor TCP config)";
  manifest.categories = [ "System" ];

  roles.default = {
    description = "Apply TCP sysctl tuning for high-reordering, lossy networks";
    interface.options = {
      tcpRmem = lib.mkOption {
        type = lib.types.str;
        default = "4096 2097152 8388608";
        description = "tcp_rmem: min/default/max receive buffer (bytes). Default matches gVisor 4KB/2MB/8MB.";
        example = "4096 2097152 8388608";
      };

      tcpWmem = lib.mkOption {
        type = lib.types.str;
        default = "4096 1572864 6291456";
        description = "tcp_wmem: min/default/max send buffer (bytes). Default matches gVisor 4KB/1.5MB/6MB.";
        example = "4096 1572864 6291456";
      };

      rmemMax = lib.mkOption {
        type = lib.types.int;
        default = 8388608;
        description = "net.core.rmem_max: maximum receive socket buffer size (bytes).";
      };

      wmemMax = lib.mkOption {
        type = lib.types.int;
        default = 6291456;
        description = "net.core.wmem_max: maximum send socket buffer size (bytes).";
      };

      tcpReordering = lib.mkOption {
        type = lib.types.int;
        default = 10;
        description = "tcp_reordering: reorder tolerance before triggering fast retransmit. Kernel default 3 is too aggressive for >3% reordering.";
      };

      tcpRecovery = lib.mkOption {
        type = lib.types.int;
        default = 0;
        description = "tcp_recovery: 0 disables RACK, 1 enables. Tailscale's gVisor has RACK disabled.";
      };

      tcpEarlyRetrans = lib.mkOption {
        type = lib.types.int;
        default = 0;
        description = "tcp_early_retrans: 0 disables TLP (Tail Loss Probe). Related to RACK.";
      };

      tcpSack = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable TCP Selective Acknowledgements.";
      };

      tcpDsack = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Enable TCP Duplicate SACK.";
      };
    };

    perInstance =
      {
        settings,
        ...
      }:
      {
        nixosModule = {
          boot.kernel.sysctl = {
            "net.ipv4.tcp_rmem" = settings.tcpRmem;
            "net.ipv4.tcp_wmem" = settings.tcpWmem;
            "net.core.rmem_max" = settings.rmemMax;
            "net.core.wmem_max" = settings.wmemMax;
            "net.ipv4.tcp_reordering" = settings.tcpReordering;
            "net.ipv4.tcp_recovery" = settings.tcpRecovery;
            "net.ipv4.tcp_early_retrans" = settings.tcpEarlyRetrans;
            "net.ipv4.tcp_sack" = settings.tcpSack;
            "net.ipv4.tcp_dsack" = settings.tcpDsack;
          };
        };
      };
  };
}
