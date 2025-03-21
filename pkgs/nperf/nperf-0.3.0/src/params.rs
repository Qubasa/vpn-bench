use std::{fmt::Display, io};

extern crate argparse;
use argparse::{ArgumentParser, Store, StoreOption, StoreTrue};

use crate::test::DEFAULT_SESSION_TIMEOUT;

fn kmg_to_bits(rate: u64, kmg: char) -> u64 {
    match kmg {
        'k' | 'K' => rate * 1024,
        'm' | 'M' => rate * 1024 * 1024,
        'g' | 'G' => rate * 1024 * 1024 * 1024,
        _ => rate,
    }
}

// convert 100G, 10K, 2M to number of bits
pub fn getrate_in_bits(rate: &str) -> u64 {
    if rate.eq("abcdef") {
        return 0;
    }
    let kmg = rate.chars().last().unwrap();
    match kmg {
        'k' | 'K' | 'm' | 'M' | 'g' | 'G' => kmg_to_bits(
            rate.strip_suffix(|_: char| true)
                .unwrap()
                .parse::<u64>()
                .unwrap(),
            kmg,
        ),
        c => {
            if c.is_alphabetic() {
                println!("Invalid character in bitrate {}, using default", rate);
                0
            } else {
                rate.parse::<u64>().unwrap()
            }
        }
    }
}

#[derive(Clone, Copy)]
pub enum PerfMode {
    SERVER,
    CLIENT,
}

impl Display for PerfMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PerfMode::SERVER => write!(f, "server"),
            PerfMode::CLIENT => write!(f, "client"),
        }
    }
}

pub struct PerfParams {
    pub mode: PerfMode,
    pub client: Option<String>,
    pub udp: bool,
    pub quic: bool,
    pub tls: bool,
    pub verbose: bool,
    pub debug: bool,
    pub bindaddr: Option<String>,
    pub port: u16,
    pub dev: String,
    pub recv_timeout: u32,
    pub idle_timeout: u32,
    pub num_streams: u8,
    pub mss: u32,
    pub bitrate: u64,
    pub time: u64,
    pub bytes: u64,
    pub blks: u64,
    pub length: u32,
    pub sendbuf: u32,
    pub recvbuf: u32,
    pub skip_tls: bool,
    pub cert: Option<String>,
    pub key: Option<String>,
}

pub fn parse_args() -> Result<PerfParams, io::ErrorKind> {
    let mut server = false;
    let mut client: Option<String> = None;
    let mut port: u16 = 8080;
    let mut udp: bool = false;
    let mut quic: bool = false;
    let mut tls: bool = false;
    let dev: String = String::new();
    let mut bindaddr: Option<String> = None;
    let recv_timeout: u32 = DEFAULT_SESSION_TIMEOUT;
    let idle_timeout: u32 = 0;
    let mut num_streams: u8 = 1;
    let mut mss: u32 = 0;
    let mut bitrate: String = String::from("abcdef");
    let mut time: u64 = 10;
    let mut bytes: String = String::from("abcdef");
    let mut blks: u64 = 0;
    let mut length: u32 = 0;
    let sendbuf: u32 = 0;
    let recvbuf: u32 = 0;
    let mut skip_tls: bool = false;
    let mut cert: Option<String> = None;
    let mut key: Option<String> = None;
    let mut verbose = false;
    let mut debug = false;
    {
        let mut args = ArgumentParser::new();
        args.set_description("[s] server only, [c] client only, [sc] both, \n[KMG] option supports a K/M/G suffix for kilo-, mega-, or giga-");
        args.refer(&mut server).add_option(
            &["-s", "--server"],
            StoreTrue,
            "[s] Start perf as server",
        );
        args.refer(&mut client).add_option(
            &["-c", "--client"],
            StoreOption,
            "[c] Start perf as client, connecting to <host>, (default 127.0.0.1)",
        );
        args.refer(&mut port).add_option(
            &["-p", "--port"],
            Store,
            "[sc] Port server listens on / client connects to, (default 8080)",
        );
        args.refer(&mut udp)
            .add_option(&["-u", "--udp"], StoreTrue, "[c] Use UDP");
        args.refer(&mut quic)
            .add_option(&["-q", "--quic"], StoreTrue, "[c] Use QUIC");
        args.refer(&mut tls)
            .add_option(&["--tls"], StoreTrue, "[c] Use TLS");
        args.refer(&mut bindaddr).add_option(
            &["-B", "--bind-addr"],
            StoreOption,
            "[s] Bind address to listen on, (default [::])",
        );
        // args.refer(&mut dev)
        //     .add_option(&["--bind-dev"], Store, "[s] Bind to device");
        // args.refer(&mut recv_timeout).add_option(
        //     &["--recv-timeout"],
        //     Store,
        //     "[sc] idle timeout for receiving data (default 120s)",
        // );
        // args.refer(&mut idle_timeout).add_option(
        //     &["--idle-timeout"],
        //     Store,
        //     "[s] restart idle server after # seconds in case it got stuck (default - no timeout)",
        // );
        args.refer(&mut bitrate).add_option(
            &["-b", "--bitrate"],
            Store,
            "[c] [KMG] target bitrate in bits/sec, (default unlimited)",
        );
        args.refer(&mut time).add_option(
            &["-t", "--time"],
            Store,
            "[c] time in seconds to transmit for (default 10 secs)",
        );
        args.refer(&mut bytes).add_option(
            &["-n", "--bytes"],
            Store,
            "[c] [KMG] target number of bytes to transmit (instead of -t)",
        );
        args.refer(&mut blks).add_option(
            &["-k", "--blocks"],
            Store,
            "[c] number of blocks (packets) to transmit (instead of -t or -n)",
        );
        args.refer(&mut length).add_option(
            &["-l", "--length"],
            Store,
            "[c] [KMG] length of buffer to read or write in bytes, maximum for TCP - 128KB, UDP/QUIC - 64KB (default ctrl connection MSS)",
        );
        args.refer(&mut num_streams).add_option(
            &["-P", "--parallel"],
            Store,
            "[c] number of parallel client streams to run",
        );
        args.refer(&mut mss).add_option(
            &["-M", "--set-mss"],
            Store,
            "[c] set TCP maximum segment size",
        );
        // args.refer(&mut sendbuf).add_option(
        //     &["--send-buf-size"],
        //     Store,
        //     "[c] set socket send buffer size [default: OS defined]",
        // );
        // args.refer(&mut recvbuf).add_option(
        //     &["--recv-buf-size"],
        //     Store,
        //     "[c] set socket recv buffer size [default: OS defined]",
        // );
        args.refer(&mut skip_tls).add_option(
            &["--skip-tls"],
            StoreTrue,
            "[c] Disable QUIC connection encryption",
        );
        args.refer(&mut cert).add_option(
            &["--tls-cert"],
            StoreOption,
            "[s] TLS certificate file (in PEM format) path",
        );
        args.refer(&mut key).add_option(
            &["--tls-key"],
            StoreOption,
            "[s] TLS key file (in DER format) path",
        );
        args.refer(&mut verbose).add_option(
            &["-V", "--verbose"],
            StoreTrue,
            "[sc] Enable verbose logging",
        );
        args.refer(&mut debug).add_option(
            &["-d", "--debug"],
            StoreTrue,
            "[sc] Enable debug logging",
        );
        args.parse_args_or_exit();
    }
    if server && client != None {
        println!("Invalid input, cannot be both server and client");
        std::process::exit(1);
    }
    let mode = match server {
        true => PerfMode::SERVER,
        false => PerfMode::CLIENT,
    };
    // println!("{}", getrate_in_bits(&bitrate));
    let bitrate = getrate_in_bits(&bitrate);
    let bytes = getrate_in_bits(&bytes);
    let params = PerfParams {
        mode,
        client,
        udp,
        quic,
        tls,
        verbose,
        debug,
        bindaddr,
        port,
        dev,
        recv_timeout,
        idle_timeout,
        num_streams,
        mss,
        bitrate,
        time,
        bytes,
        blks,
        length,
        sendbuf,
        recvbuf,
        skip_tls,
        cert,
        key,
    };
    Ok(params)
}
