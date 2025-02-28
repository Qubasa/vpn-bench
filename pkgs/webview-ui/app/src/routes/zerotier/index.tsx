import { IperfDashboard } from "@/src/components/IperfChart";
import luna_tcp_iperf3 from "@/bench/NoVPN/0_luna/tcp_iperf3.json";
import milo_tcp_iperf3 from "@/bench/NoVPN/1_milo/tcp_iperf3.json";


export const Zerotier = () => {
  const reports = [
    { name: "milo", data: milo_tcp_iperf3 },
    { name: "luna", data: luna_tcp_iperf3 }
  ];
  
  return (
    <IperfDashboard 
      reports={reports} 
      height={{
        throughput: 500,
        timeSeries: 700,
        cpu: 500,
        retransmits: 500
      }}
    />
  );
};
