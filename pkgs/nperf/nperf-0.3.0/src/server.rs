use crate::params::PerfParams;
use crate::quic::{self, Quic};
use crate::tls::TlsEndpoint;
use core::panic;
use mio::net::{TcpListener, TcpStream, UdpSocket};
use mio::{Events, Interest, Poll, Token, Waker};
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;

use crate::net::*;
use crate::test::*;

const CONTROL: Token = Token(1024);
const TCP_LISTENER: Token = Token(1025);
const UDP_LISTENER: Token = Token(1026);
const QUIC_LISTENER: Token = Token(1027);
const TLS_LISTENER: Token = Token(1028);
const TOKEN_START: usize = 0;

pub struct ServerImpl {
    addr: SocketAddr,
    ctrl: Option<TcpStream>,
    t: Option<TcpListener>,
    u: Option<UdpSocket>,
    q: Option<Quic>,
}

impl ServerImpl {
    pub fn new(params: &PerfParams) -> std::io::Result<ServerImpl> {
        let default = ("[::]:".to_owned() + &params.port.to_string())
            .parse::<SocketAddr>()
            .unwrap();
        let addr = match &params.bindaddr {
            None => default,
            Some(addr) => match addr.as_str() {
                "[::]" => default,
                _ => SocketAddr::new(IpAddr::from_str(&addr).unwrap(), params.port),
            },
        };
        println!("==========================================");
        println!("Server listening on {}", addr.to_string());
        println!("==========================================");
        // TODO: handle failure
        let listener = TcpListener::bind(addr)?;
        Ok(ServerImpl {
            addr,
            ctrl: None,
            t: Some(listener),
            u: None,
            q: None,
        })
    }
    // run is basically a loop listening on events, initially on the ctrl connection
    // and then later on the data streams. Each stream type has it's own listener in
    // the server object.
    // All test stages are usually managed by the control connection with TestStart
    // and TestRunning being the exception.
    //
    // The TCP listener is slightly different compared to the UDP and QUIC listeners.
    // The TCP listener's accept produces a new TcpStream object. So, only a single
    // TCP listener is ever required over the lifetime of the server.
    // UDP and QUIC listeners are consumed as UdpSockets and quinn::Connection objects.
    // So each new parallel stream creates a new UdpSocket or quinn::Connection object.
    //
    // Most state transitions are initiated by the server. Refer to what each state
    // means in the TestState documentation.
    pub async fn run(&mut self, test: &mut Test) -> std::io::Result<i8> {
        let mut poll = Poll::new().unwrap();
        let mut events = Events::with_capacity(128);

        let stream = crate::tcp::accept(self.t.as_mut().unwrap()).await?;
        if test.verbose() {
            println!("Time: {}", gettime());
        }
        println!("Accepted ctrl connection from {}", stream.peer_addr()?);
        set_nodelay(&stream);
        set_linger(&stream);
        set_nonblocking(&stream, true);
        self.ctrl = Some(stream);
        poll.registry().register(
            self.ctrl.as_mut().unwrap(),
            CONTROL,
            Interest::READABLE | Interest::WRITABLE,
        )?;
        let waker = Waker::new(poll.registry(), CONTROL)?;

        loop {
            poll.poll(&mut events, test.idle_timeout())?;
            if events.is_empty() {
                println!(
                    "Server restart #{} after idle timeout {} sec",
                    test.reset_counter_inc(),
                    test.idle_timeout().unwrap().as_secs()
                );
                test.print_stats();
                return Ok(2);
            }
            // println!("{:?}", events);
            for event in events.iter() {
                match event.token() {
                    CONTROL => match test.state() {
                        TestState::Start => {
                            if event.is_readable() {
                                let ctrl_ref = self.ctrl.as_mut().unwrap();
                                test.cookie = drain_message(ctrl_ref)?;
                                test.transition(TestState::ParamExchange);
                                send_state(ctrl_ref, TestState::ParamExchange);
                            }
                        }
                        TestState::ParamExchange => {
                            if event.is_readable() {
                                let ctrl_ref = self.ctrl.as_mut().unwrap();
                                let buf = drain_message(ctrl_ref)?;
                                test.set_settings(buf);
                                if test.verbose() {
                                    println!("\tCookie: {}", test.cookie);
                                    println!("\tTCP MSS: {}", test.mss());
                                }
                                match test.conn() {
                                    Conn::TCP => {
                                        if test.mss() > 0 {
                                            set_mss_listener(self.t.as_ref().unwrap(), test.mss())?;
                                        }
                                        // no need of a new tcp listener. Just use ctrl listener for tcp
                                        poll.registry().register(
                                            self.t.as_mut().unwrap(),
                                            TCP_LISTENER,
                                            Interest::READABLE | Interest::WRITABLE,
                                        )?;
                                    }
                                    Conn::TLS => {
                                        if test.mss() > 0 {
                                            set_mss_listener(self.t.as_ref().unwrap(), test.mss())?;
                                        }
                                        // no need of a new tcp listener. Just use ctrl listener for tcp
                                        poll.registry().register(
                                            self.t.as_mut().unwrap(),
                                            TLS_LISTENER,
                                            Interest::READABLE | Interest::WRITABLE,
                                        )?;
                                    }
                                    Conn::UDP => {
                                        self.u = Some(create_mio_udp_socket(self.addr.into()));
                                        poll.registry().register(
                                            self.u.as_mut().unwrap(),
                                            UDP_LISTENER,
                                            Interest::READABLE | Interest::WRITABLE,
                                        )?;
                                    }
                                    Conn::QUIC => {
                                        self.q = Some(quic::server(
                                            self.addr.into(),
                                            test.skip_tls(),
                                            Some(String::from("cert.key")),
                                            Some(String::from("cert.crt")),
                                        ));
                                        #[cfg(unix)]
                                        poll.registry().register(
                                            self.q.as_mut().unwrap(),
                                            QUIC_LISTENER,
                                            Interest::READABLE | Interest::WRITABLE,
                                        )?;
                                    }
                                }
                                test.transition(TestState::CreateStreams);
                                send_state(ctrl_ref, TestState::CreateStreams);
                            }
                        }
                        // CreateStreams handled by each socket type below
                        TestState::CreateStreams => {}
                        // TestStart is managed by the data connection tokens
                        TestState::TestStart => {}
                        TestState::TestRunning => {
                            // this state for this token can be hit if
                            // the client is shutdown unplanned -> Err
                            // and when client sends TestEnd -> Ok
                            if event.is_readable() {
                                let ctrl_ref = self.ctrl.as_mut().unwrap();
                                let state = match drain_message(ctrl_ref) {
                                    Ok(buf) => match buf.len() {
                                        1 => TestState::from_i8(buf.as_bytes()[0] as i8),
                                        _ => {
                                            println!(
                                                "Invalid message: buf {}, len {}",
                                                buf,
                                                buf.len()
                                            );
                                            test.end(&mut poll);
                                            TestState::End
                                        }
                                    },
                                    Err(_) => {
                                        test.end(&mut poll);
                                        TestState::End
                                    }
                                };
                                test.transition(state);
                                waker.wake()?;
                            }
                        }
                        TestState::TestEnd => {
                            test.end(&mut poll);
                            test.transition(TestState::ExchangeResults);
                            waker.wake()?;
                        }
                        TestState::ExchangeResults => {
                            let json = test.results();
                            if test.debug() {
                                println!("{} {}", json, json.len());
                            }
                            self.ctrl.as_mut().unwrap().write(json.as_bytes())?;
                            test.transition(TestState::End);
                        }
                        TestState::End => {
                            test.print_stats();
                            return Ok(0);
                        }
                        _ => {
                            println!(
                                "Unexpected state {:?} for CONTROL ({:?})",
                                test.state(),
                                event.token()
                            );
                            break;
                        }
                    },
                    TCP_LISTENER => match test.state() {
                        TestState::CreateStreams => {
                            self.create_tcp_stream(&mut poll, test).unwrap();

                            if test.streams.len() > test.num_streams() as usize {
                                panic!("Incorrect parallel streams");
                            }
                            if test.streams.len() == test.num_streams() as usize {
                                let ctrl_ref = self.ctrl.as_ref().unwrap();
                                test.transition(TestState::TestStart);
                                send_state(ctrl_ref, TestState::TestStart);
                                test.header();
                            }
                        }
                        _ => {}
                    },
                    UDP_LISTENER => match test.state() {
                        TestState::CreateStreams => {
                            if event.is_readable() {
                                self.create_udp_stream(&mut poll, test).unwrap();

                                if test.streams.len() > test.num_streams() as usize {
                                    panic!("Incorrect parallel streams");
                                }
                                if test.streams.len() == test.num_streams() as usize {
                                    let ctrl_ref = self.ctrl.as_ref().unwrap();
                                    test.transition(TestState::TestStart);
                                    send_state(ctrl_ref, TestState::TestStart);
                                    test.header();
                                }
                            }
                        }
                        _ => {}
                    },
                    QUIC_LISTENER => match test.state() {
                        TestState::CreateStreams => {
                            if event.is_readable() {
                                self.create_quic_stream(&mut poll, test).await.unwrap();

                                if test.streams.len() > test.num_streams() as usize {
                                    panic!("Incorrect parallel streams");
                                }
                                if test.streams.len() == test.num_streams() as usize {
                                    let ctrl_ref = self.ctrl.as_ref().unwrap();
                                    test.transition(TestState::TestStart);
                                    send_state(ctrl_ref, TestState::TestStart);
                                    test.header();
                                }
                                break;
                            }
                        }
                        _ => {}
                    },
                    TLS_LISTENER => match test.state() {
                        TestState::CreateStreams => {
                            self.create_tls_stream(&mut poll, test).unwrap();

                            if test.streams.len() > test.num_streams() as usize {
                                panic!("Incorrect parallel streams");
                            }
                            if test.streams.len() == test.num_streams() as usize {
                                let ctrl_ref = self.ctrl.as_ref().unwrap();
                                test.transition(TestState::TestStart);
                                send_state(ctrl_ref, TestState::TestStart);
                                test.header();
                            }
                        }
                        _ => {}
                    },
                    token => match test.state() {
                        TestState::TestRunning => {
                            if event.is_readable() {
                                // setup buffers
                                let mut buf: [u8; 131072] = [0; 131072];

                                let conn = test.conn();
                                let metrics = test.metrics();
                                let verbose = test.verbose();
                                let pstream = &mut test.streams[token.0];
                                loop {
                                    let res = match conn {
                                        Conn::QUIC => {
                                            let q: &mut Quic = (&mut pstream.stream).into();
                                            quic::read(q).await
                                        }
                                        Conn::TCP => {
                                            let t: &mut TcpStream = (&mut pstream.stream).into();
                                            TcpStream::read(t, &mut buf)
                                        }
                                        Conn::TLS => {
                                            let t: &mut TlsEndpoint = (&mut pstream.stream).into();
                                            t.read(&mut buf)
                                        }
                                        Conn::UDP => {
                                            let u: &mut UdpSocket = (&mut pstream.stream).into();
                                            UdpSocket::read(u, &mut buf)
                                        }
                                    };
                                    match res {
                                        Ok(0) => break,
                                        Ok(n) => {
                                            metrics.record(verbose);
                                            pstream.data.bytes += n as u64;
                                            test.data.bytes += n as u64;
                                            pstream.temp.bytes += n as u64;
                                            pstream.data.blks += 1;
                                            test.data.blks += 1;
                                            pstream.temp.blks += 1;
                                            pstream.last_recvd_in_interval =
                                                u64::from_be_bytes(buf[0..8].try_into().unwrap());
                                        }
                                        Err(_e) => break,
                                    }
                                    if pstream.timers.curr.elapsed() > ONE_SEC {
                                        pstream.push_stat(test.debug);
                                    }
                                }
                            }
                        }
                        TestState::TestStart => {
                            if event.is_readable() {
                                match test.conn() {
                                    Conn::QUIC => {
                                        let mut count = 0;
                                        let pstream = &mut test.streams[token.0];
                                        let q: &mut Quic = (&mut pstream.stream).into();
                                        while count < 1 {
                                            let recv = q
                                                .conn
                                                .as_ref()
                                                .unwrap()
                                                .accept_uni()
                                                .await
                                                .unwrap();
                                            println!("Quic Accept UNI: {:?}", recv.id());
                                            q.recv_streams.push(recv);
                                            // Because it is a unidirectional stream, we can only receive not send back.
                                            let n = quic::read_cookie(q).await.unwrap();
                                            if test.debug {
                                                println!("Cookie: {:?}", n);
                                            }
                                            count += 1;
                                        }
                                    }
                                    Conn::TCP => {
                                        let pstream = &mut test.streams[token.0];
                                        let t: &mut TcpStream = (&mut pstream.stream).into();
                                        let n = drain_message(t)?;
                                        if test.debug {
                                            println!("Cookie: {:?}", n);
                                        }
                                    }
                                    Conn::TLS => {
                                        let pstream = &mut test.streams[token.0];
                                        let t: &mut TlsEndpoint = (&mut pstream.stream).into();
                                        let n = drain_message(t)?;
                                        if test.debug {
                                            println!("Cookie: {:?}", n);
                                        }
                                    }
                                    Conn::UDP => {
                                        let pstream = &mut test.streams[token.0];
                                        let u: &mut UdpSocket = (&mut pstream.stream).into();
                                        let n = drain_message(u)?;
                                        if test.debug {
                                            println!("Cookie: {:?}", n);
                                        }
                                    }
                                }
                                test.cookie_count += 1;
                                if test.num_streams() == test.cookie_count {
                                    test.transition(TestState::TestRunning);
                                    send_state(self.ctrl.as_ref().unwrap(), TestState::TestRunning);
                                    test.start();
                                }
                            }
                        }
                        TestState::TestEnd => {}
                        _ => {
                            println!(
                                "Unexpected state {:?} for STREAM ({:?})",
                                test.state(),
                                event.token()
                            );
                            break;
                        }
                    },
                }
            }
        }
    }

    fn create_tcp_stream(&mut self, poll: &mut Poll, test: &mut Test) -> Result<(), ()> {
        let (mut stream, _) = self.t.as_ref().unwrap().accept().unwrap();

        let token = Token(TOKEN_START + test.tokens.len());
        test.tokens.push(token);
        poll.registry()
            .register(&mut stream, token, Interest::READABLE)
            .unwrap();

        stream.print_new_stream();
        test.streams.push(PerfStream::new(stream, test.mode()));

        // no need of a new listener (unlike udp and quic)
        Ok(())
    }

    fn create_tls_stream(&mut self, poll: &mut Poll, test: &mut Test) -> Result<(), ()> {
        let (mut stream, _) = self.t.as_ref().unwrap().accept().unwrap();

        let token = Token(TOKEN_START + test.tokens.len());
        test.tokens.push(token);
        poll.registry()
            .register(&mut stream, token, Interest::READABLE)
            .unwrap();

        let stream = crate::tls::TlsEndpoint::server(
            Some(String::from("cert.key")),
            Some(String::from("cert.crt")),
            stream,
        );
        stream.print_new_stream();
        test.streams.push(PerfStream::new(stream, test.mode()));

        // no need of a new listener (unlike udp and quic)
        Ok(())
    }

    fn create_udp_stream(&mut self, poll: &mut Poll, test: &mut Test) -> Result<(), ()> {
        let mut buf = [0; 128 * 1024];
        let (_, sock_addr) = self.u.as_ref().unwrap().recv_from(&mut buf).unwrap();
        self.u.as_ref().unwrap().connect(sock_addr).unwrap();

        let token = Token(TOKEN_START + test.tokens.len());
        test.tokens.push(token);
        poll.registry()
            .reregister(self.u.as_mut().unwrap(), token, Interest::READABLE)
            .unwrap();

        self.u.as_ref().unwrap().print_new_stream();
        test.streams
            .push(PerfStream::new(self.u.take().unwrap(), test.mode()));

        // recreate a new udp socket to wait for new streams
        if test.streams.len() < test.num_streams() as usize {
            self.u = Some(create_mio_udp_socket(self.addr.into()));
            poll.registry()
                .register(
                    self.u.as_mut().unwrap(),
                    UDP_LISTENER,
                    Interest::READABLE | Interest::WRITABLE,
                )
                .unwrap();
        }
        Ok(())
    }

    async fn create_quic_stream(&mut self, poll: &mut Poll, test: &mut Test) -> Result<(), ()> {
        let handshake = self.q.as_ref().unwrap().endpoint.accept().await.unwrap();
        let conn = handshake.await.unwrap();
        self.q.as_mut().unwrap().conn = Some(conn);

        let token = Token(TOKEN_START + test.tokens.len());
        test.tokens.push(token);
        #[cfg(unix)]
        poll.registry()
            .reregister(self.q.as_mut().unwrap(), token, Interest::READABLE)
            .unwrap();

        self.q.as_ref().unwrap().print_new_stream();
        test.streams
            .push(PerfStream::new(self.q.take().unwrap(), test.mode()));

        // recreate a new quic connection to wait for new streams
        if test.streams.len() < test.num_streams() as usize {
            self.q = Some(quic::server(
                self.addr.into(),
                test.skip_tls(),
                Some(String::from("cert.key")),
                Some(String::from("cert.crt")),
            ));
            #[cfg(unix)]
            poll.registry()
                .register(
                    self.q.as_mut().unwrap(),
                    QUIC_LISTENER,
                    Interest::READABLE | Interest::WRITABLE,
                )
                .unwrap();
        }
        Ok(())
    }
}
