use crate::test::{Conn, Stream};
use mio::{
    net::{TcpListener, TcpStream},
    Events, Interest, Poll, Token,
};
use socket2::SockRef;
#[cfg(unix)]
use std::os::unix::prelude::{AsRawFd, RawFd};
#[cfg(windows)]
use std::os::windows::prelude::AsRawSocket as AsRawFd;
#[cfg(windows)]
use std::os::windows::prelude::RawSocket as RawFd;

use socket2::Socket;
use std::{
    any::Any,
    ffi::c_int,
    io,
    mem::{size_of, MaybeUninit},
    time::Duration,
};

impl Stream for TcpStream {
    #[inline(always)]
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        // let mut buf = [0; 131072];
        std::io::Read::read(self, buf)
    }
    #[inline(always)]
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        std::io::Write::write(self, buf)
    }
    fn fd(&self) -> RawFd {
        #[cfg(unix)]
        return self.as_raw_fd();
        #[cfg(windows)]
        self.as_raw_socket()
    }
    fn register(&mut self, poll: &mut Poll, token: Token) {
        poll.registry()
            .register(self, token, Interest::WRITABLE | Interest::READABLE)
            .unwrap();
    }
    fn deregister(&mut self, poll: &mut Poll) {
        poll.registry().deregister(self).unwrap();
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn print_new_stream(&self) {
        let sck = SockRef::from(self);
        #[cfg(unix)]
        println!(
            "[{:>3}] local {}, peer {} sndbuf {} rcvbuf {} mss {}",
            self.fd(),
            self.local_addr().unwrap(),
            self.peer_addr().unwrap(),
            sck.send_buffer_size().unwrap(),
            sck.recv_buffer_size().unwrap(),
            sck.mss().unwrap()
        );
        #[cfg(windows)]
        println!(
            "[{:>3}] local {}, peer {} sndbuf {} rcvbuf {}",
            self.fd(),
            self.local_addr().unwrap(),
            self.peer_addr().unwrap(),
            sck.send_buffer_size().unwrap(),
            sck.recv_buffer_size().unwrap(),
        );
    }
    fn socket_type(&self) -> Conn {
        Conn::TCP
    }
}

impl<'a> From<&'a Box<dyn Stream>> for &'a TcpStream {
    fn from(s: &'a Box<dyn Stream>) -> &'a TcpStream {
        let b = match s.as_any().downcast_ref::<TcpStream>() {
            Some(b) => b,
            None => panic!("Stream is not a {}", stringify!(TcpStream)),
        };
        b
    }
}
impl<'a> From<&'a mut Box<dyn Stream>> for &'a mut TcpStream {
    fn from(s: &'a mut Box<dyn Stream>) -> &'a mut TcpStream {
        let b = match s.as_any_mut().downcast_mut::<TcpStream>() {
            Some(b) => b,
            None => panic!("Stream is not a {}", stringify!(TcpStream)),
        };
        b
    }
}

pub fn mss(stream: &TcpStream) -> u32 {
    #[cfg(unix)]
    {
        let sck = SockRef::from(stream);
        match sck.mss() {
            Ok(n) => return n,
            Err(e) => {
                println!("Failed to get mss {}", e.to_string());
                return 0;
            }
        }
    }
    #[cfg(windows)]
    1448
}

#[cfg(unix)]
pub fn _set_mss(stream: &TcpStream, mss: u32) -> io::Result<()> {
    let sck = SockRef::from(stream);
    match sck.set_mss(mss) {
        Ok(_) => Ok(()),
        Err(e) => {
            println!("Failed to set mss {}", mss);
            return Err(e);
        }
    }
}

pub fn connect(addr: std::net::SocketAddr) -> io::Result<TcpStream> {
    loop {
        let mut poll = Poll::new().unwrap();
        let mut events = Events::with_capacity(1024);

        // mio TcpStream connect is non-blocking and returns unconnected stream
        let mut stream = TcpStream::connect(addr)?;
        poll.registry().register(
            &mut stream,
            Token(1),
            Interest::READABLE | Interest::WRITABLE,
        )?;

        poll.poll(&mut events, Some(Duration::from_secs(1)))?;
        for event in events.iter() {
            match event.token() {
                Token(1) => {
                    if event.is_writable() {
                        // If we can get a peer address it means the stream is
                        // connected.
                        match stream.peer_addr() {
                            Ok(..) => {
                                // for some reason debug build act weird without this
                                poll.registry().deregister(&mut stream)?;
                                return Ok(stream);
                            }
                            Err(e) => {
                                println!("{}, retrying...", e.to_string());
                                std::thread::sleep(Duration::from_millis(1000));
                                continue;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

pub async fn accept(listener: &mut TcpListener) -> io::Result<TcpStream> {
    let mut poll = Poll::new().unwrap();
    let mut events = Events::with_capacity(1024);

    poll.registry()
        .register(listener, Token(1), Interest::READABLE | Interest::WRITABLE)?;

    loop {
        poll.poll(&mut events, Some(Duration::from_millis(10)))?;
        for event in events.iter() {
            match event.token() {
                Token(1) => {
                    if event.is_readable() {
                        let (stream, _) = listener.accept().unwrap();
                        // If we can get a peer address it means the stream is
                        // connected.
                        match stream.peer_addr() {
                            Ok(..) => {
                                // for some reason debug build act weird without this
                                poll.registry().deregister(listener)?;
                                return Ok(stream);
                            }
                            Err(_) => continue,
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

#[derive(Default, Clone, Copy, Debug)]
#[repr(C)]
pub struct TcpInfo {
    tcpi_state: u8,
    tcpi_ca_state: u8,
    tcpi_retransmits: u8,
    tcpi_probes: u8,
    tcpi_backoff: u8,
    tcpi_options: u8,
    tcpi_snd_rcv_wscale: u8,
    tcpi_delivery_rate_limited: u8,

    tcpi_rto: u32,
    tcpi_ato: u32,
    pub tcpi_snd_mss: u32,
    pub tcpi_rcv_mss: u32,

    tcpi_unacked: u32,
    tcpi_sacked: u32,
    tcpi_lost: u32,
    tcpi_retrans: u32,
    tcpi_fackets: u32,

    /* Times. */
    tcpi_last_data_sent: u32,
    tcpi_last_ack_sent: u32, /* Not remembered, sorry.  */
    tcpi_last_data_recv: u32,
    tcpi_last_ack_recv: u32,

    /* Metrics. */
    tcpi_pmtu: u32,
    tcpi_rcv_ssthresh: u32,
    pub tcpi_rtt: u32, /* retransmit timer */
    tcpi_rttvar: u32,
    tcpi_snd_ssthresh: u32,
    pub tcpi_snd_cwnd: u32,
    tcpi_advmss: u32,
    tcpi_reordering: u32,

    pub tcpi_rcv_rtt: u32,
    tcpi_rcv_space: u32,

    pub tcpi_total_retrans: u32,

    tcpi_pacing_rate: u64,
    tcpi_max_pacing_rate: u64,
    tcpi_bytes_acked: u64,    /* RFC4898 tcpEStatsAppHCThruOctetsAcked */
    tcpi_bytes_received: u64, /* RFC4898 tcpEStatsAppHCThruOctetsReceived */
    tcpi_segs_out: u32,       /* RFC4898 tcpEStatsPerfSegsOut */
    tcpi_segs_in: u32,        /* RFC4898 tcpEStatsPerfSegsIn */

    tcpi_notsent_bytes: u32,
    tcpi_min_rtt: u32,
    tcpi_data_segs_in: u32,  /* RFC4898 tcpEStatsDataSegsIn */
    tcpi_data_segs_out: u32, /* RFC4898 tcpEStatsDataSegsOut */

    tcpi_delivery_rate: u64,

    tcpi_busy_time: u64,      /* Time (usec) busy sending data */
    tcpi_rwnd_limited: u64,   /* Time (usec) limited by receive window */
    tcpi_sndbuf_limited: u64, /* Time (usec) limited by send buffer */

    tcpi_delivered: u32,
    tcpi_delivered_ce: u32,

    tcpi_bytes_sent: u64,    /* RFC4898 tcpEStatsPerfHCDataOctetsOut */
    tcpi_bytes_retrans: u64, /* RFC4898 tcpEStatsPerfOctetsRetrans */
    tcpi_dsack_dups: u32,    /* RFC4898 tcpEStatsStackDSACKDups */
    tcpi_reord_seen: u32,    /* reordering events seen */

    tcpi_rcv_ooopack: u32, /* Out-of-order packets received */

    tcpi_snd_wnd: u32, /* peer's advertised receive window after scaling (bytes) */
}

pub fn _bind(addr: std::net::SocketAddr, mss: u32) -> io::Result<TcpListener> {
    let sck = socket2::Socket::new(
        socket2::Domain::for_address(addr),
        socket2::Type::STREAM,
        Some(socket2::Protocol::TCP),
    )
    .unwrap();
    sck.set_reuse_address(true).unwrap();
    #[cfg(unix)]
    sck.set_mss(mss).unwrap();
    sck.bind(&addr.into()).unwrap();
    sck.listen(1024).unwrap();
    Ok(TcpListener::from_std(std::net::TcpListener::from(sck)))
}

#[cfg(unix)]
macro_rules! syscall {
    ($fn: ident ( $($arg: expr),* $(,)* ) ) => {{
        #[allow(unused_unsafe)]
        let res = unsafe { libc::$fn($($arg, )*) };
        if res == -1 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(res)
        }
    }};
}

#[cfg(unix)]
pub(crate) unsafe fn _getsockopt<T>(fd: c_int, opt: c_int, val: c_int) -> io::Result<T> {
    let mut payload: MaybeUninit<T> = MaybeUninit::uninit();
    let mut len = size_of::<T>() as libc::socklen_t;
    syscall!(getsockopt(
        fd,
        opt,
        val,
        payload.as_mut_ptr().cast(),
        &mut len,
    ))
    .map(|_| {
        debug_assert_eq!(len as usize, size_of::<T>());
        // Safety: `getsockopt` initialised `payload` for us.
        payload.assume_init()
    })
}

#[cfg(unix)]
pub fn tcp_info(sck: &Socket) -> io::Result<TcpInfo> {
    let mut payload = TcpInfo::default();
    let payload_ptr: *mut TcpInfo = &mut payload;
    let mut len = size_of::<TcpInfo>() as libc::socklen_t;
    syscall!(getsockopt(
        sck.as_raw_fd(),
        libc::IPPROTO_TCP,
        libc::TCP_INFO,
        payload_ptr.cast(),
        &mut len,
    ))
    .map(|_| payload.clone())
}

pub fn print_tcp_info(stream: &TcpStream) -> TcpInfo {
    let sck = SockRef::from(stream);
    #[cfg(unix)]
    match tcp_info(&sck) {
        Ok(tinfo) => tinfo,
        Err(_) => {
            println!("Failed to get TcpInfo, unsupported");
            TcpInfo::default()
        }
    }
    #[cfg(windows)]
    return TcpInfo::default();
}
