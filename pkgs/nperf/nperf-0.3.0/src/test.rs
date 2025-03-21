use crate::{
    metrics::Metrics, params::PerfParams, quic::Quic, tcp::print_tcp_info, tls::TlsEndpoint,
};
use mio::{net::TcpStream, Poll, Token};
use serde::{ser::SerializeStruct, Deserialize, Deserializer, Serialize, Serializer};
use serde_json;
#[cfg(unix)]
use std::os::unix::prelude::RawFd;
#[cfg(windows)]
use std::os::windows::prelude::RawSocket as RawFd;
use std::{
    any::Any,
    fmt::Display,
    io::{self},
    ops::Sub,
    time::{Duration, Instant},
};

// This Dummy type is just here for ExchangeResults.
// The entire PerfStream struct is serialized and sent over to the client.
// Box<dyn Stream> is something that cannot be easily serde'd. So instead,
// send this Dummy across with just the relevant information to properly
// print the results in the client.
// The Serialize trait is manually implemented which will convert the Stream
// to a Dummy. On the receiver end, the derive Deserialize will convert it
// back into a Box<dyn Stream>.
// Obviously, no other methods of the trait can be called at the receiver.
#[derive(Deserialize)]
struct Dummy {
    fd: u32,
    conn: i8,
}
impl Stream for Dummy {
    #[inline(always)]
    fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
        Ok(0)
    }
    #[inline(always)]
    fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
        Ok(0)
    }
    fn fd(&self) -> RawFd {
        self.fd as RawFd
    }
    fn register(&mut self, _poll: &mut Poll, _token: Token) {}
    fn deregister(&mut self, _poll: &mut Poll) {}
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn print_new_stream(&self) {}
    fn socket_type(&self) -> Conn {
        Conn::from_i8(self.conn)
    }
}

impl Serialize for Box<dyn Stream> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("Dummy", 2)?;
        state.serialize_field("fd", &self.fd())?;
        state.serialize_field("conn", &(self.socket_type() as i8))?;
        state.end()
    }
}
impl<'de> serde::Deserialize<'de> for Box<dyn Stream> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = Dummy::deserialize(d)?;
        Ok(Box::from(s))
    }
}

pub const DEFAULT_SESSION_TIMEOUT: u32 = 120;
pub const MAX_TCP_PAYLOAD: usize = 131072;
pub const MAX_UDP_PAYLOAD: usize = 65500;
pub const MAX_QUIC_PAYLOAD: usize = 65500;

pub const ONE_SEC: Duration = Duration::from_secs(1);
pub const ONE_KB: f64 = 1024 as f64;
pub const ONE_MB: f64 = (1024 * 1024) as f64;
pub const ONE_GB: f64 = (1024 * 1024 * 1024) as f64;
pub const ONE_TB: u64 = 1024 * 1024 * 1024 * 1024;
pub const ONE_K: f64 = 1000.0;
pub const ONE_M: f64 = 1000.0 * 1000.0;
pub const ONE_G: f64 = 1000.0 * 1000.0 * 1000.0;
pub const ONE_T: f64 = 1000.0 * 1000.0 * 1000.0 * 1000.0;

#[derive(Serialize, Deserialize, Copy, Clone)]
pub enum Conn {
    TCP,
    UDP,
    QUIC,
    TLS,
}
impl Display for Conn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Conn::TCP => write!(f, "TCP"),
            Conn::UDP => write!(f, "UDP"),
            Conn::QUIC => write!(f, "QUIC"),
            Conn::TLS => write!(f, "TLS"),
        }
    }
}
impl Conn {
    pub fn from_i8(value: i8) -> Conn {
        match value {
            0 => Conn::TCP,
            1 => Conn::UDP,
            2 => Conn::QUIC,
            3 => Conn::TLS,
            _ => panic!("Unknown value: {}", value),
        }
    }
}

pub trait Stream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize>;
    fn write(&mut self, buf: &[u8]) -> io::Result<usize>;
    fn fd(&self) -> RawFd;
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn register(&mut self, poll: &mut Poll, token: Token);
    fn deregister(&mut self, poll: &mut Poll);
    fn print_new_stream(&self);
    fn socket_type(&self) -> Conn;
}

#[derive(Clone, Copy, Debug)]
pub enum TestState {
    Start,
    ParamExchange,
    CreateStreams,
    TestStart,
    TestRunning,
    TestEnd,
    Wait,
    ExchangeResults,
    End,
}
impl TestState {
    pub fn from_i8(value: i8) -> TestState {
        match value {
            0 => TestState::Start,
            1 => TestState::ParamExchange,
            2 => TestState::CreateStreams,
            3 => TestState::TestStart,
            4 => TestState::TestRunning,
            5 => TestState::TestEnd,
            6 => TestState::Wait,
            7 => TestState::ExchangeResults,
            8 => TestState::End,
            _ => panic!("Unknown value: {}", value),
        }
    }
}
impl Default for TestState {
    fn default() -> Self {
        TestState::Start
    }
}

#[derive(Serialize, Deserialize, Debug, Copy, Clone, PartialEq)]
pub enum StreamMode {
    SENDER,
    RECEIVER,
    BOTH,
}
impl Display for StreamMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StreamMode::SENDER => write!(f, "sender"),
            StreamMode::RECEIVER => write!(f, "receiver"),
            StreamMode::BOTH => write!(f, "both"),
        }
    }
}

pub struct Timers {
    pub created: Instant,
    pub start: Instant,
    pub end: Instant,
    pub curr: Instant,
}
impl Default for Timers {
    fn default() -> Self {
        Timers {
            created: Instant::now(),
            start: Instant::now(),
            end: Instant::now(),
            curr: Instant::now(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct StreamData {
    pub bytes: u64,
    pub blks: u64,
    pub lost: u64,
    pub retr: u32,
    pub cwnd: u32,
}
impl Default for StreamData {
    fn default() -> Self {
        StreamData {
            bytes: 0,
            blks: 0,
            lost: 0,
            retr: 0,
            cwnd: 0,
        }
    }
}

// Per second statistics
pub struct IntervalStats {
    pub iter: u64,
    timers: Timers,
    data: StreamData,
}
impl Display for IntervalStats {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{:>4}s  {}",
            self.iter,
            Test::kmg(
                self.data.bytes,
                self.timers.end.sub(self.timers.start).as_secs_f64()
            ),
        )
    }
}

fn print_stat_line(data: &StreamData, mode: &StreamMode, conn: Conn) -> String {
    match mode {
        StreamMode::SENDER => match conn {
            Conn::TCP => format!(
                "{:<4}    {:<18}",
                data.retr,
                Test::fmt_bytes(data.cwnd as f64)
            ),
            Conn::TLS => format!(
                "{:<4}    {:<18}",
                data.retr,
                Test::fmt_bytes(data.cwnd as f64)
            ),
            _ => format!("{:<26}", data.blks),
        },
        StreamMode::RECEIVER => match conn {
            Conn::UDP => format!(
                "{:<18}  ({:.1}%)",
                format!("{} / {}", data.lost, data.blks),
                (data.lost as f64 / data.blks as f64) * 100.0,
            ),
            Conn::TCP => format!("{:<26}", ""),
            Conn::TLS => format!("{:<26}", ""),
            Conn::QUIC => format!("{:<26}", data.blks),
        },
        StreamMode::BOTH => format!(""),
    }
}

#[derive(Serialize, Deserialize)]
pub struct PerfStream {
    pub mode: StreamMode,
    pub stream: Box<dyn Stream>,
    #[serde(skip)]
    pub timers: Timers,
    pub elapsed: f64,
    pub data: StreamData,
    #[serde(skip)]
    pub first_recvd_in_interval: u64,
    #[serde(skip)]
    pub last_recvd_in_interval: u64,
    #[serde(skip)]
    pub stats: Vec<IntervalStats>,
    #[serde(skip)]
    pub iter: u64,
    #[serde(skip)]
    pub temp: StreamData,
}

impl Display for PerfStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "[{:>3}] {:>4}s  {}  {}  {}",
            self.stream.fd(),
            self.elapsed as u64,
            Test::kmg(self.data.bytes, self.elapsed),
            print_stat_line(&self.data, &self.mode, self.stream.as_ref().socket_type()),
            self.mode
        )
    }
}

impl PerfStream {
    pub fn new<T: Stream + 'static>(stream: T, mode: StreamMode) -> PerfStream {
        PerfStream {
            mode,
            stream: Box::from(stream),
            timers: Timers::default(),
            elapsed: 0.0,
            data: StreamData::default(),
            first_recvd_in_interval: 0,
            last_recvd_in_interval: 0,
            stats: Vec::new(),
            iter: 0,
            temp: StreamData::default(),
        }
    }
    pub fn push_stat(&mut self, debug: bool) {
        let mut stat = IntervalStats {
            timers: Timers::default(),
            iter: self.iter,
            data: StreamData {
                bytes: self.temp.bytes,
                blks: self.temp.blks,
                lost: 0,
                retr: 0,
                cwnd: 0,
            },
        };
        let mut snd_cwnd: u32 = 0;
        let mut snd_mss: u32 = 0;
        let mut rtt: u32 = 0;
        match self.stream.as_ref().socket_type() {
            Conn::UDP => {
                stat.data.lost =
                    self.last_recvd_in_interval - self.first_recvd_in_interval - self.temp.blks;
                self.first_recvd_in_interval = self.last_recvd_in_interval;
            }
            Conn::TCP | Conn::TLS => {
                let t: &TcpStream = match self.stream.as_ref().socket_type() {
                    Conn::TCP => (&self.stream).into(),
                    Conn::TLS => {
                        let tls: &TlsEndpoint = (&self.stream).into();
                        tls.entity.get_ref()
                    }
                    Conn::UDP => todo!(),
                    Conn::QUIC => todo!(),
                };
                let tinfo = print_tcp_info(t);
                snd_cwnd = tinfo.tcpi_snd_cwnd;
                snd_mss = tinfo.tcpi_snd_mss;
                rtt = tinfo.tcpi_rtt;
                stat.data.retr = tinfo.tcpi_total_retrans - self.temp.retr;
                self.temp.retr = tinfo.tcpi_total_retrans;
                stat.data.cwnd = tinfo.tcpi_snd_cwnd * tinfo.tcpi_snd_mss;
            }
            _ => {}
        }
        stat.timers.start = self.timers.curr;

        println!(
            "[{:>3}] {}  {}",
            self.stream.fd(),
            stat,
            print_stat_line(&stat.data, &self.mode, self.stream.as_ref().socket_type())
        );

        if debug {
            match self.stream.as_ref().socket_type() {
                Conn::TCP => {
                    println!(
                        "tcpi_snd_cwnd {} tcpi_snd_mss {} tcpi_rtt {}",
                        snd_cwnd, snd_mss, rtt
                    );
                }
                _ => {}
            }
            println!(
                "interval {} secs, {} bytes",
                stat.timers.start.elapsed().as_secs_f64(),
                stat.data.bytes
            )
        }

        self.stats.push(stat);

        // reset temp variables for next interval
        self.iter += 1;
        self.timers.curr = Instant::now();
        self.temp.bytes = 0;
        self.temp.blks = 0;
    }
    #[inline]
    pub fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self.stream.write(buf) {
            Ok(n) => {
                return Ok(n);
            }
            Err(e) => {
                // println!("In write {:?}", e);
                return Err(e);
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Settings {
    conn: Conn,
    num_streams: u8,
    recv_timeout_in_secs: u32,
    mss: u32,
    bitrate: u64,
    sndbuf: usize,
    rcvbuf: usize,
    time: Duration,
    bytes: u64,
    blks: u64,
    length: usize,
}
impl Default for Settings {
    fn default() -> Self {
        Settings {
            conn: Conn::TCP,
            num_streams: 1,
            recv_timeout_in_secs: DEFAULT_SESSION_TIMEOUT,
            mss: 0,
            bitrate: 0,
            sndbuf: 0,
            rcvbuf: 0,
            time: Duration::from_secs(10),
            bytes: 0,
            blks: 0,
            length: 0,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Test {
    pub mode: StreamMode,
    #[serde(skip)]
    state: TestState,
    #[serde(skip)]
    verbose: bool,
    #[serde(skip)]
    pub debug: bool,
    #[serde(skip)]
    skip_tls: bool,
    #[serde(skip)]
    pub cookie: String,
    #[serde(skip)]
    pub cookie_count: u8,
    #[serde(skip)]
    settings: Settings,
    #[serde(skip)]
    idle_timeout_in_secs: Option<Duration>,
    #[serde(skip)]
    reset_counter: u16,
    pub streams: Vec<PerfStream>,
    #[serde(skip)]
    pub peer_streams: Vec<PerfStream>,
    #[serde(skip)]
    pub tokens: Vec<Token>,
    #[serde(skip)]
    pub timers: Timers,
    pub elapsed: f64,
    pub data: StreamData,
    #[serde(skip)]
    peer_elapsed: f64,
    #[serde(skip)]
    peer: StreamData,
    peer_mode: StreamMode,
    #[serde(skip)]
    metrics: Metrics,
    #[serde(skip)]
    cert: Option<String>,
    #[serde(skip)]
    key: Option<String>,
}

impl Test {
    pub fn new() -> Test {
        Test {
            mode: StreamMode::RECEIVER,
            state: TestState::default(),
            settings: Settings::default(),
            verbose: false,
            debug: false,
            skip_tls: false,
            cookie: String::new(),
            cookie_count: 0,
            idle_timeout_in_secs: None,
            reset_counter: 0,
            streams: Vec::new(),
            peer_streams: Vec::new(),
            tokens: Vec::new(),
            timers: Timers::default(),
            elapsed: 0.0,
            data: StreamData::default(),
            peer_elapsed: 0.0,
            peer: StreamData::default(),
            peer_mode: StreamMode::RECEIVER,
            metrics: Metrics::default(),
            cert: None,
            key: None,
        }
    }
    pub fn from(param: &PerfParams) -> Test {
        let mut test = Test::new();
        test.settings.num_streams = param.num_streams;
        test.set_idle_timeout(param.idle_timeout);
        test.verbose = param.verbose;
        test.debug = param.debug;
        test.settings.mss = param.mss;
        test.settings.bitrate = param.bitrate;
        test.settings.sndbuf = param.sendbuf as usize;
        test.settings.rcvbuf = param.recvbuf as usize;
        test.skip_tls = param.skip_tls;
        if param.udp {
            test.settings.conn = Conn::UDP;
            // test.settings.length = MAX_UDP_PAYLOAD;
        }
        if param.quic {
            #[cfg(windows)]
            {
                println!("QUIC is unsupported on windows, exiting");
                std::process::exit(1);
            }
            test.settings.conn = Conn::QUIC;
            // test.settings.length = MAX_QUIC_PAYLOAD;
        }
        if param.tls {
            test.settings.conn = Conn::TLS;
            // test.settings.length = MAX_UDP_PAYLOAD;
        }
        test.settings.time = Duration::from_secs(param.time);
        if param.bytes > 0 {
            test.settings.bytes = param.bytes;
            test.settings.time = Duration::from_secs(3600);
        }
        if param.blks > 0 {
            test.settings.blks = param.blks;
            test.settings.time = Duration::from_secs(3600);
        }
        if param.length > 0 {
            test.settings.length = param.length as usize;
        }
        if param.mss > 0 {
            test.settings.mss = param.mss;
        }
        test.cert = param.cert.clone();
        test.key = param.key.clone();
        test
    }
    pub fn reset(&mut self) {
        self.state = TestState::Start;
        self.cookie = String::new();
        self.streams.clear();
        self.tokens.clear();
    }
    pub fn transition(&mut self, state: TestState) {
        if self.debug() {
            println!("Debug: Transition from {:?} to {:?}", self.state, state);
        }
        self.state = state;
    }
    pub fn from_serde(&mut self, json: String) {
        let t: Test = match serde_json::from_str(&json) {
            Ok(s) => s,
            Err(_) => {
                println!("Invalid results {}", json);
                return;
            }
        };
        self.peer_streams = t.streams;
        self.peer_elapsed = t.elapsed;
        self.peer.bytes = t.data.bytes;
        self.peer.blks = t.data.blks;
        self.peer.lost = t.data.lost;
        self.peer_mode = t.mode;
    }
    #[inline(always)]
    pub fn state(&self) -> TestState {
        self.state
    }
    pub fn num_streams(&self) -> u8 {
        return self.settings.num_streams;
    }
    pub fn mss(&self) -> u32 {
        return self.settings.mss;
    }
    pub fn _sndbuf(&self) -> u32 {
        return self.settings.sndbuf as u32;
    }
    pub fn _rcvbuf(&self) -> u32 {
        return self.settings.rcvbuf as u32;
    }
    pub fn verbose(&self) -> bool {
        return self.verbose;
    }
    pub fn debug(&self) -> bool {
        return self.debug;
    }
    pub fn skip_tls(&self) -> bool {
        return self.skip_tls;
    }
    /*
    pub fn recv_timeout(&self) -> u32 {
        return self.settings.recv_timeout_in_secs;
    }
    */
    pub fn set_settings(&mut self, settings: String) {
        self.settings = serde_json::from_str(&settings).unwrap();
    }
    pub fn settings(&self) -> String {
        return serde_json::to_string(&self.settings).unwrap();
    }
    #[inline(always)]
    pub fn conn(&self) -> Conn {
        self.settings.conn
    }
    #[inline(always)]
    pub fn mode(&self) -> StreamMode {
        self.mode
    }
    #[inline(always)]
    pub fn bitrate(&self) -> u64 {
        self.settings.bitrate
    }
    #[inline(always)]
    pub fn time(&self) -> Duration {
        self.settings.time
    }
    #[inline(always)]
    pub fn bytes(&self) -> u64 {
        self.settings.bytes
    }
    #[inline(always)]
    pub fn blks(&self) -> u64 {
        self.settings.blks
    }
    #[inline(always)]
    pub fn length(&self) -> usize {
        self.settings.length
    }
    pub fn set_length(&mut self, length: usize) {
        self.settings.length = length;
    }
    pub fn set_idle_timeout(&mut self, idle_timeout: u32) {
        if idle_timeout > 0 {
            self.idle_timeout_in_secs = Some(Duration::from_secs(idle_timeout as u64));
        }
    }
    pub fn idle_timeout(&self) -> Option<Duration> {
        return self.idle_timeout_in_secs;
    }
    pub fn reset_counter_inc(&mut self) -> u16 {
        self.reset_counter += 1;
        return self.reset_counter;
    }
    pub fn start(&mut self) {
        for pstream in &mut self.streams {
            pstream.timers.curr = Instant::now();
        }
        self.timers.start = Instant::now();
    }
    pub fn end(&mut self, poll: &mut Poll) {
        for pstream in &mut self.streams {
            if pstream.temp.bytes > 0 {
                pstream.push_stat(self.debug);
            }
            pstream.timers.end = Instant::now();
            pstream.elapsed = pstream.timers.start.elapsed().as_secs_f64();
            pstream.stream.deregister(poll);
        }
        match self.conn() {
            Conn::UDP => {
                for pstream in &mut self.streams {
                    pstream.data.lost = pstream.stats.iter().map(|s| s.data.lost).sum();
                }
                self.data.lost = self.streams.iter().map(|s| s.data.lost).sum();
            }
            Conn::TCP => {
                for pstream in &mut self.streams {
                    let t: &TcpStream = (&pstream.stream).into();
                    let tinfo = print_tcp_info(t);
                    pstream.data.retr = tinfo.tcpi_total_retrans;
                }
                self.data.retr = self.streams.iter().map(|s| s.data.retr).sum();
            }
            Conn::QUIC => {
                for pstream in &mut self.streams {
                    let q: &Quic = (&pstream.stream).into();
                    if self.debug {
                        println!("{:?}", q.conn.as_ref().unwrap().stats());
                    }
                }
            }
            Conn::TLS => {
                for pstream in &mut self.streams {
                    let t: &TlsEndpoint = (&pstream.stream).into();
                    let tinfo = print_tcp_info(t.entity.get_ref());
                    pstream.data.retr = tinfo.tcpi_total_retrans;
                }
                self.data.retr = self.streams.iter().map(|s| s.data.retr).sum();
            }
        }
        self.elapsed = self.timers.start.elapsed().as_secs_f64();
    }
    pub fn results(&self) -> String {
        serde_json::to_string(&self).unwrap()
    }
    pub fn metrics(&self) -> Metrics {
        self.metrics.clone()
    }
    pub fn print_stats(&self) {
        println!("- - - - - - - - - - - - - Results Per Stream- - - - - - - - - - - - - - - -");
        for pstream in &self.streams {
            println!("{}", pstream);
            if self.debug {
                println!(
                    "interval {} secs, {} bytes",
                    pstream.elapsed, pstream.data.bytes
                )
            }
        }
        for pstream in &self.peer_streams {
            println!("{}", pstream);
            if self.debug {
                println!(
                    "interval {} secs, {} bytes",
                    pstream.elapsed, pstream.data.bytes
                )
            }
        }
        println!("- - - - - - - - - - - - - - - All Streams - - - - - - - - - - - - - - - - -");
        println!(
            "[Sum]  {:>3}s  {}  {}  {}",
            self.elapsed as u64,
            Test::kmg(self.data.bytes, self.elapsed),
            print_stat_line(&self.data, &self.mode, self.conn()),
            self.mode,
        );
        if self.debug {
            println!("interval {} secs, {} bytes", self.elapsed, self.data.bytes);
        }
        if self.mode == StreamMode::RECEIVER {
            println!("");
            self.metrics.print();
            return;
        }
        println!(
            "[Sum]  {:>3}s  {}  {}  {}",
            self.peer_elapsed as u64,
            Test::kmg(self.peer.bytes, self.peer_elapsed),
            print_stat_line(&self.peer, &self.peer_mode, self.conn()),
            self.peer_mode,
        );
        if self.debug {
            println!(
                "interval {} secs, {} bytes",
                self.peer_elapsed, self.peer.bytes
            );
        }
        println!("");
        self.metrics.print();
    }
    pub fn fmt_bytes(bytes: f64) -> String {
        if bytes == 0.0 {
            return String::from("");
        }
        if bytes >= ONE_TB as f64 {
            format!("{:<7.2} TBytes", bytes / ONE_TB as f64)
        } else if bytes >= ONE_GB {
            format!("{:<7.2} GBytes", bytes / ONE_GB)
        } else if bytes >= ONE_MB {
            format!("{:<7.2} MBytes", bytes / ONE_MB)
        } else if bytes >= ONE_KB {
            format!("{:<7.2} KBytes", bytes / ONE_KB)
        } else {
            format!("{:<8} Bytes", bytes)
        }
    }
    pub fn fmt_rate(bits: f64, dur: f64) -> String {
        if bits >= ONE_TB as f64 {
            format!("{:<6.1} Tbits/sec", (bits / ONE_T) / dur)
        } else if bits >= ONE_GB {
            format!("{:<6.1} Gbits/sec", (bits / ONE_G) / dur)
        } else if bits >= ONE_MB {
            let mut r = (bits / ONE_M) / dur;
            if dur < 1.0 {
                r = 0.0;
            }
            format!("{:<6.1} Mbits/sec", r)
        } else if bits >= ONE_KB {
            let mut r = (bits / ONE_K) / dur;
            if dur < 1.0 {
                r = 0.0;
            }
            format!("{:<6.1} Kbits/sec", r)
        } else {
            let mut r = bits / dur;
            if dur < 1.0 {
                r = 0.0;
            }
            format!("{:<7.1} bits/sec", r)
        }
    }
    pub fn kmg(bytes: u64, dur: f64) -> String {
        let bits = (bytes * 8) as f64;
        let bytes = bytes as f64;
        format!("{}   {}", Test::fmt_bytes(bytes), Test::fmt_rate(bits, dur)).to_string()
    }
    pub fn header(&self) {
        println!(
            "Starting Test: protocol: {}, {} streams, {} byte blocks, {} seconds test",
            self.conn(),
            self.num_streams(),
            self.settings.length,
            self.time().as_secs()
        );
        println!("- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -");
        match self.mode() {
            StreamMode::SENDER => match self.conn() {
                Conn::UDP => {
                    println!("[ FD]  Time  Transfer         Rate              Total Datagrams")
                }
                Conn::TCP | Conn::TLS => {
                    println!("[ FD]  Time  Transfer         Rate              Retr    Cwnd")
                }
                Conn::QUIC => {
                    println!("[ FD]  Time  Transfer         Rate              Total Datagrams")
                }
            },
            StreamMode::RECEIVER => match self.conn() {
                Conn::UDP => {
                    println!("[ FD]  Time  Transfer         Rate              Lost/Total Datagrams")
                }
                Conn::TCP | Conn::TLS => {
                    println!("[ FD]  Time  Transfer         Rate              ")
                }
                Conn::QUIC => {
                    println!("[ FD]  Time  Transfer         Rate              Total Datagrams")
                }
            },
            _ => {}
        }
        println!("- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -");
    }
}
