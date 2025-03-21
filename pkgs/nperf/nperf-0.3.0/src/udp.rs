#[cfg(unix)]
use std::os::unix::prelude::{AsRawFd, RawFd};
#[cfg(windows)]
use std::os::windows::prelude::AsRawSocket as AsRawFd;
#[cfg(windows)]
use std::os::windows::prelude::RawSocket as RawFd;
use std::{any::Any, io};

use mio::{net::UdpSocket, Interest, Poll, Token};
use socket2::SockRef;

use crate::test::{Conn, Stream};

impl Stream for UdpSocket {
    #[inline(always)]
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        // let mut buf = [0; 65536];
        self.recv(buf)
        // println!("{}", u64::from_be_bytes(buf[0..8].try_into().unwrap()));
        // Ok(buf.len())
    }
    #[inline(always)]
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.send(buf)
    }
    fn fd(&self) -> RawFd {
        #[cfg(unix)]
        return self.as_raw_fd();
        #[cfg(windows)]
        self.as_raw_socket()
    }
    fn register(&mut self, poll: &mut Poll, token: Token) {
        poll.registry()
            .register(self, token, Interest::WRITABLE)
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
        println!(
            "[{:>3}] local {}, peer {} sndbuf {} rcvbuf {}",
            self.fd(),
            self.local_addr().unwrap(),
            self.peer_addr().unwrap(),
            sck.send_buffer_size().unwrap(),
            sck.recv_buffer_size().unwrap()
        );
    }
    fn socket_type(&self) -> Conn {
        Conn::UDP
    }
}

impl<'a> From<&'a Box<dyn Stream>> for &'a UdpSocket {
    fn from(s: &'a Box<dyn Stream>) -> &'a UdpSocket {
        let b = match s.as_any().downcast_ref::<UdpSocket>() {
            Some(b) => b,
            None => panic!("Stream is not a {}", stringify!(UdpSocket)),
        };
        b
    }
}
impl<'a> From<&'a mut Box<dyn Stream>> for &'a mut UdpSocket {
    fn from(s: &'a mut Box<dyn Stream>) -> &'a mut UdpSocket {
        let b = match s.as_any_mut().downcast_mut::<UdpSocket>() {
            Some(b) => b,
            None => panic!("Stream is not a {}", stringify!(UdpSocket)),
        };
        b
    }
}

pub fn connect(addr: std::net::SocketAddr) -> io::Result<UdpSocket> {
    let ip = if addr.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let stream = UdpSocket::bind(ip.parse().unwrap()).unwrap();
    stream.connect(addr).unwrap();
    stream.send("hello".as_bytes())?;
    Ok(stream)
}
