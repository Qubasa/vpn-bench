use crate::params::PerfParams;
use crate::quic::{self, Quic};
use crate::tls::TlsEndpoint;
use mio::net::{TcpStream, UdpSocket};
use mio::{Events, Interest, Poll, Token, Waker};
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::time::Duration;
use std::{io, thread};

use crate::net::*;
use crate::test::*;

const CONTROL: Token = Token(1024);
const STREAM: Token = Token(0);

pub struct ClientImpl {
    server_addr: SocketAddr,
    ctrl: TcpStream,
    running: bool,
}

impl ClientImpl {
    pub fn new(params: &PerfParams) -> io::Result<ClientImpl> {
        let ip = match &params.client {
            None => IpAddr::from_str("127.0.0.1").unwrap(),
            Some(addr) => match IpAddr::from_str(&addr) {
                Ok(addr) => addr,
                Err(e) => {
                    println!("{}: {}", addr, e.to_string());
                    std::process::exit(1);
                }
            },
        };
        println!("Connecting to {}:{}", ip.to_string(), params.port);
        let addr = SocketAddr::new(ip, params.port);
        let ctrl = crate::tcp::connect(addr)?;
        set_nodelay(&ctrl);
        set_linger(&ctrl);
        set_nonblocking(&ctrl, true);
        println!("Control Connection MSS: {}", crate::tcp::mss(&ctrl));

        Ok(ClientImpl {
            server_addr: addr,
            ctrl,
            running: false,
        })
    }
    // run, like the server, is just a loop.
    // The ctrl connection listens for state transitions from server
    // and responds with data as necessitated.
    //
    // The ClientImpl holds no state and all state is managed within Test.
    // Except for TestRunning, all other states are handled by the ctrl
    // connection.
    pub async fn run(&mut self, mut test: Test) -> io::Result<()> {
        let mut poll = Poll::new().unwrap();
        let mut events = Events::with_capacity(1024);

        poll.registry().register(
            &mut self.ctrl,
            CONTROL,
            Interest::READABLE | Interest::WRITABLE,
        )?;
        let waker = Waker::new(poll.registry(), CONTROL)?;

        // todo
        test.mode = StreamMode::SENDER;

        // setup MSS for UDP
        let ctrl_mss = crate::tcp::mss(&self.ctrl) as usize;
        match test.conn() {
            Conn::TCP | Conn::TLS => {
                if test.length() == 0 {
                    test.set_length(MAX_TCP_PAYLOAD);
                }
            }
            Conn::UDP | Conn::QUIC => {
                if test.length() > MAX_UDP_PAYLOAD {
                    println!("Setting UDP payload length as {}", MAX_UDP_PAYLOAD);
                    test.set_length(MAX_UDP_PAYLOAD);
                }
                if test.length() == 0 {
                    println!("Setting UDP payload length as {}", ctrl_mss);
                    test.set_length(ctrl_mss);
                }
            }
        }

        loop {
            poll.poll(&mut events, Some(Duration::from_millis(100)))?;
            // println!("{:?}", events);
            for event in events.iter() {
                match event.token() {
                    CONTROL => match test.state() {
                        TestState::Start => {
                            if event.is_writable() {
                                write_socket(&self.ctrl, make_cookie().as_bytes())?;
                                test.transition(TestState::ParamExchange);
                            }
                        }
                        TestState::ParamExchange => {
                            if event.is_readable() {
                                drain_message(&mut self.ctrl)?;
                            }
                            // Send params
                            write_socket(&self.ctrl, test.settings().as_bytes())?;
                            test.transition(TestState::CreateStreams);
                        }
                        TestState::CreateStreams => {
                            if event.is_readable() {
                                drain_message(&mut self.ctrl)?;
                            }
                            for _ in 0..test.num_streams() {
                                thread::sleep(Duration::from_millis(10));
                                match test.conn() {
                                    Conn::UDP => {
                                        let stream = crate::udp::connect(self.server_addr)?;
                                        stream.print_new_stream();
                                        test.streams.push(PerfStream::new(stream, test.mode()));
                                    }
                                    Conn::TCP => {
                                        let stream = crate::tcp::connect(self.server_addr)?;
                                        stream.print_new_stream();
                                        test.streams.push(PerfStream::new(stream, test.mode()));
                                    }
                                    Conn::TLS => {
                                        let stream = crate::tcp::connect(self.server_addr)?;
                                        let stream = crate::tls::TlsEndpoint::client(stream);
                                        stream.print_new_stream();
                                        test.streams.push(PerfStream::new(stream, test.mode()));
                                    }
                                    Conn::QUIC => {
                                        let stream =
                                            quic::client(self.server_addr, test.skip_tls()).await;
                                        stream.print_new_stream();
                                        test.streams.push(PerfStream::new(stream, test.mode()));
                                    }
                                }
                            }
                            test.transition(TestState::TestStart);
                        }
                        TestState::TestStart => {
                            if event.is_readable() {
                                drain_message(&mut self.ctrl)?;
                            }
                            match test.conn() {
                                Conn::QUIC => {
                                    thread::sleep(Duration::from_millis(10));
                                    for pstream in &mut test.streams {
                                        for _ in 0..1 {
                                            thread::sleep(Duration::from_millis(500));
                                            let q: &mut Quic = (&mut pstream.stream).into();
                                            let stream =
                                                q.conn.as_mut().unwrap().open_uni().await.unwrap();
                                            println!("Quic Open UNI: {:?}", stream.id());
                                            q.send_streams.push(stream);
                                            match quic::write_cookie(q, make_cookie().as_bytes())
                                                .await
                                            {
                                                Ok(_) => {}
                                                Err(_e) => {
                                                    println!("Failed to send cookie");
                                                    continue;
                                                }
                                            }
                                        }
                                    }
                                }
                                _ => {
                                    for pstream in &mut test.streams {
                                        match pstream.write(make_cookie().as_bytes()) {
                                            Ok(_) => {}
                                            Err(_e) => {
                                                println!("Failed to send cookie {:?}", _e);
                                                continue;
                                            }
                                        }
                                    }
                                }
                            }
                            test.transition(TestState::TestRunning);
                        }
                        TestState::TestRunning => {
                            if event.is_readable() {
                                if self.running {
                                    // this state for this token can only be hit if the server is shutdown unplanned
                                    if test.debug() {
                                        println!("Remote error, ending test");
                                    }
                                    test.end(&mut poll);
                                    test.print_stats();
                                    return Ok(());
                                } else {
                                    if event.is_readable() {
                                        drain_message(&mut self.ctrl)?;
                                    }
                                    self.running = true;
                                    test.header();
                                    for pstream in &mut test.streams {
                                        pstream.stream.register(&mut poll, STREAM);
                                    }
                                    test.start();
                                }
                            }
                        }
                        TestState::ExchangeResults => {
                            if event.is_readable() {
                                let json = match drain_message(&mut self.ctrl) {
                                    Ok(buf) => buf,
                                    Err(_) => continue,
                                };
                                test.from_serde(json.trim().to_string());
                                test.transition(TestState::End);
                                send_state(&self.ctrl, TestState::End);
                                waker.wake()?;
                            }
                        }
                        TestState::End => {
                            self.ctrl.shutdown(std::net::Shutdown::Both)?;
                            test.print_stats();
                            return Ok(());
                        }
                        TestState::TestEnd | TestState::Wait => {
                            if event.is_readable() {
                                let buf = drain_message(&mut self.ctrl)?;
                                let state = TestState::from_i8(buf.as_bytes()[0] as i8);
                                test.transition(state);
                                // waker.wake()?;
                            }
                        }
                    },
                    STREAM => match test.state() {
                        TestState::TestRunning => {
                            if event.is_writable() {
                                let mut try_later = false;

                                // fetch test attributes
                                let verbose = test.verbose();
                                let metrics = test.metrics();
                                let conn = test.conn();
                                let test_bitrate = test.bitrate();
                                let test_bytes = test.bytes();
                                let test_blks = test.blks();
                                let len = test.length();
                                let test_time = test.time().clone();
                                let mut elapsed = test.timers.start.elapsed();

                                // setup buffers
                                const TCP_BUF: [u8; MAX_TCP_PAYLOAD] = [1; MAX_TCP_PAYLOAD];
                                let mut udp_buf: [u8; MAX_UDP_PAYLOAD] = [1; MAX_UDP_PAYLOAD];
                                const QUIC_BUF: [u8; MAX_QUIC_PAYLOAD] = [1; MAX_QUIC_PAYLOAD];

                                while try_later == false {
                                    for pstream in &mut test.streams {
                                        let t = pstream.timers.curr.elapsed();
                                        if test_bitrate != 0 {
                                            let rate =
                                                (pstream.temp.bytes * 8) as f64 / t.as_secs_f64();
                                            if rate as u64 > test_bitrate {
                                                continue;
                                                // } else {
                                                //     println!(
                                                //         "{:.6}",
                                                //         pstream.curr_time.elapsed().as_secs_f64()
                                                //     );
                                            }
                                        }
                                        let res = match conn {
                                            Conn::TCP => {
                                                let t: &mut TcpStream =
                                                    (&mut pstream.stream).into();
                                                TcpStream::write(t, &TCP_BUF[..len])
                                            }
                                            Conn::TLS => {
                                                let t: &mut TlsEndpoint =
                                                    (&mut pstream.stream).into();
                                                t.write(&TCP_BUF[..len])
                                            }
                                            Conn::UDP => {
                                                udp_buf[0..8].copy_from_slice(
                                                    &(pstream.data.blks + 1).to_be_bytes(),
                                                );
                                                let u: &mut UdpSocket =
                                                    (&mut pstream.stream).into();
                                                UdpSocket::write(u, &udp_buf[..len])
                                            }
                                            Conn::QUIC => {
                                                let q: &mut Quic = (&mut pstream.stream).into();
                                                quic::write(q, &QUIC_BUF[..len]).await
                                            }
                                        };
                                        match res {
                                            Ok(0) => {
                                                try_later = true;
                                                break;
                                            }
                                            Ok(n) => {
                                                pstream.data.bytes += n as u64;
                                                test.data.bytes += n as u64;
                                                pstream.temp.bytes += n as u64;
                                                pstream.data.blks += 1;
                                                test.data.blks += 1;
                                                pstream.temp.blks += 1;
                                                metrics.record(verbose);
                                            }
                                            Err(_e) => {
                                                //println!("Is there error");
                                                try_later = true;
                                                break;
                                            }
                                        }
                                        if (test_blks != 0) && (test.data.blks >= test_blks)
                                            || (test_bytes != 0) && (test.data.bytes >= test_bytes)
                                            || t > ONE_SEC
                                        {
                                            pstream.push_stat(test.debug);
                                            elapsed = test.timers.start.elapsed();
                                            if elapsed > test_time {
                                                try_later = true;
                                            }
                                        }
                                    }
                                }
                                if (test_blks != 0) && (test.data.blks >= test_blks)
                                    || (test_bytes != 0) && (test.data.bytes >= test_bytes)
                                    || (elapsed > test_time)
                                {
                                    match test.conn() {
                                        Conn::TCP => {
                                            for pstream in &test.streams {
                                                let x: &TcpStream = (&pstream.stream).into();
                                                x.shutdown(std::net::Shutdown::Both)?;
                                            }
                                        }
                                        Conn::QUIC => {
                                            for pstream in &mut test.streams {
                                                let q: &mut Quic = (&mut pstream.stream).into();
                                                for stream in &mut q.send_streams {
                                                    // println!("{:?}", stream);
                                                    stream.finish().await.unwrap();
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                    test.end(&mut poll);
                                    test.transition(TestState::ExchangeResults);
                                    send_state(&self.ctrl, TestState::TestEnd);
                                    // waker.wake()?;
                                }
                            }
                        }
                        _ => {}
                    },
                    _ => {}
                }
            }
        }
    }
}
