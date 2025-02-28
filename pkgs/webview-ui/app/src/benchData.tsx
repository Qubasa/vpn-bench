
// Import actual benchmark data
import luna_no_vpn_tcp from "@/bench/NoVPN/0_luna/tcp_iperf3.json";
import milo_no_vpn_tcp from "@/bench/NoVPN/1_milo/tcp_iperf3.json";
import luna_no_vpn_udp from "@/bench/NoVPN/0_luna/udp_iperf3.json";
import milo_no_vpn_udp from "@/bench/NoVPN/1_milo/udp_iperf3.json";

// Import the IperfReport type
export interface IperfReport {
  name: string;
  data: any;
}

// Define types for benchmark data structure
interface IperfData {
  type: "tcp" | "udp";
  data: any; // The actual iperf JSON data
}

interface Machine {
  name: string;
  iperf3: IperfData[];
}

interface BenchCategory {
  name: string;
  machines: Machine[];
}

export type BenchData = BenchCategory[];

// Define the benchmark data structure
export const benchData: BenchData = [
  {
    name: "No VPN",
    machines: [
      {
        name: "0_luna",
        iperf3: [
          {
            type: "tcp",
            data: luna_no_vpn_tcp,
          },
          {
            type: "udp",
            data: luna_no_vpn_udp,
          },
        ],
      },
      {
        name: "1_milo",
        iperf3: [
          {
            type: "tcp",
            data: milo_no_vpn_tcp,
          },
          {
            type: "udp",
            data: milo_no_vpn_udp,
          },
        ],
      },
    ],
  },
  {
    name: "Zerotier",
    machines: [
      {
        name: "0_luna",
        iperf3: [
          {
            type: "tcp",
            data: luna_no_vpn_tcp,
          },
          {
            type: "udp",
            data: luna_no_vpn_udp,
          },
        ],
      },
      {
        name: "1_milo",
        iperf3: [
          {
            type: "tcp",
            data: milo_no_vpn_tcp,
          },
          {
            type: "udp",
            data: milo_no_vpn_udp,
          },
        ],
      },
    ],
  },
  {
    name: "Mycelium",
    machines: [], // Empty for now, but structure exists for future
  },
];
