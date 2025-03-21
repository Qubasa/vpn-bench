# nperf
A portable network performance measurement tool for TCP/UDP/QUIC/TLS protocols. Similar to iperf3 in usage.

Supported on Linux and Windows. (macos coming soon)

QUIC protocol testing uses the [quinn](https://github.com/quinn-rs/quinn) QUIC implementation. Future support for [Quiche](https://github.com/cloudflare/quiche) is WIP.

## Differences to iperf3
- nperf works on Windows
- QUIC is newly supported in nperf
- TLS (tls over tcp) is newly supported in nperf
- Some CLI options yet to be supported in nperf and some are WIP
- SCTP is unsupported
- No support for --bidir

## Usage
More options available via help.

### Server
```bash
# binds to [::]:8080 by default
cargo run -- -s
```

### Client
```bash
# connects to 127.0.0.1:8080 by default and test TCP streams
cargo run --
cargo run -- -c 127.0.0.1

# Test TSL performance
cargo run -- --tls

# Test UDP performance
cargo run -- -u

# Test QUIC performance
cargo run -- -q

# Test with parallel streams using -P, period to test with -t
cargo run -- -u -P 2 -t 30
```

## Future
- Support for send/recv buffer sizes
- More performance and configuration options for QUIC
