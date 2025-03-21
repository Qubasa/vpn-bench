use mio::{net::TcpStream, Events, Interest, Poll, Token};
use rustls::{ClientConfig, IoState, ServerConfig};
#[cfg(unix)]
use std::os::unix::prelude::{AsRawFd, RawFd};
#[cfg(windows)]
use std::os::windows::prelude::AsRawSocket as AsRawFd;
#[cfg(windows)]
use std::os::windows::prelude::RawSocket as RawFd;
use std::{
    any::Any,
    fs::{self},
    io::{self, Read, Write},
    sync::Arc,
    time::Duration,
};

use crate::test::{Conn, Stream};

static PERF_CIPHER_SUITES: &[rustls::SupportedCipherSuite] = &[
    rustls::cipher_suite::TLS13_AES_128_GCM_SHA256,
    rustls::cipher_suite::TLS13_AES_256_GCM_SHA384,
    rustls::cipher_suite::TLS13_CHACHA20_POLY1305_SHA256,
];

fn get_key_and_cert(
    k: Option<String>,
    c: Option<String>,
) -> (rustls::PrivateKey, Vec<rustls::Certificate>) {
    match (&k, &c) {
        (&Some(ref key), &Some(ref cert)) => {
            println!("Using key: {} and cert: {}", key, cert);
            let key = fs::read(key).unwrap();
            let cert = fs::read(cert).unwrap();

            let mut certs = Vec::new();
            for cert in rustls_pemfile::certs(&mut cert.as_ref()).unwrap() {
                certs.push(rustls::Certificate(cert));
            }

            let mut keys = Vec::new();
            for key in rustls_pemfile::pkcs8_private_keys(&mut key.as_ref()).unwrap() {
                keys.push(key);
            }
            (rustls::PrivateKey(keys.remove(0)), certs)
        }
        _ => {
            let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
            (
                rustls::PrivateKey(cert.serialize_private_key_der()),
                vec![rustls::Certificate(cert.serialize_der().unwrap())],
            )
        }
    }
}

pub fn server(k: Option<String>, c: Option<String>) -> ServerConfig {
    let (key, cert) = get_key_and_cert(k, c);

    let mut crypto = rustls::ServerConfig::builder()
        .with_cipher_suites(PERF_CIPHER_SUITES)
        .with_safe_default_kx_groups()
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(cert, key)
        .unwrap();
    crypto.alpn_protocols = vec![b"perf".to_vec()];
    crypto
}

pub fn client() -> ClientConfig {
    let mut crypto = rustls::ClientConfig::builder()
        .with_cipher_suites(crate::tls::PERF_CIPHER_SUITES)
        .with_safe_default_kx_groups()
        .with_protocol_versions(&[&rustls::version::TLS13])
        .unwrap()
        .with_custom_certificate_verifier(SkipServerVerification::new())
        .with_no_client_auth();
    crypto.alpn_protocols = vec![b"perf".to_vec()];
    crypto.key_log = Arc::new(rustls::KeyLogFile::new());
    crypto
}

struct SkipServerVerification;

impl SkipServerVerification {
    fn new() -> Arc<Self> {
        Arc::new(Self)
    }
}

impl rustls::client::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls::Certificate,
        _intermediates: &[rustls::Certificate],
        _server_name: &rustls::ServerName,
        _scts: &mut dyn Iterator<Item = &[u8]>,
        _ocsp_response: &[u8],
        _now: std::time::SystemTime,
    ) -> Result<rustls::client::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::ServerCertVerified::assertion())
    }
}

fn _try_read(r: io::Result<usize>) -> io::Result<Option<usize>> {
    match r {
        Ok(len) => Ok(Some(len)),
        Err(e) => {
            if e.kind() == io::ErrorKind::WouldBlock {
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}

pub enum TlsEntity {
    Server(rustls::StreamOwned<rustls::ServerConnection, mio::net::TcpStream>),
    Client(rustls::StreamOwned<rustls::ClientConnection, mio::net::TcpStream>),
}
impl TlsEntity {
    fn is_handshaking(&mut self) -> bool {
        match self {
            Self::Server(server) => server.conn.is_handshaking(),
            Self::Client(client) => client.conn.is_handshaking(),
        }
    }
    pub fn get_mut(&mut self) -> &mut TcpStream {
        match self {
            Self::Client(client) => client.get_mut(),
            Self::Server(server) => server.get_mut(),
        }
    }
    pub fn get_ref(&self) -> &TcpStream {
        match self {
            Self::Client(client) => client.get_ref(),
            Self::Server(server) => server.get_ref(),
        }
    }
    fn write_tls(&mut self) -> Result<usize, io::Error> {
        match self {
            Self::Client(client) => client.conn.write_tls(&mut client.sock),
            Self::Server(server) => server.conn.write_tls(&mut server.sock),
        }
    }
    fn read_tls(&mut self) -> Result<usize, io::Error> {
        match self {
            Self::Client(client) => client.conn.read_tls(&mut client.sock),
            Self::Server(server) => server.conn.read_tls(&mut server.sock),
        }
    }
    fn process_new_packets(&mut self) -> Result<IoState, rustls::Error> {
        match self {
            Self::Client(client) => client.conn.process_new_packets(),
            Self::Server(server) => server.conn.process_new_packets(),
        }
    }
    pub fn read_to_end(&mut self, buf: &mut Vec<u8>) -> Result<usize, io::Error> {
        match self {
            Self::Client(client) => client.read_to_end(buf),
            Self::Server(server) => server.read_to_end(buf),
        }
    }
    pub fn write_all(&mut self, buf: &[u8]) -> Result<(), io::Error> {
        match self {
            Self::Client(client) => client.write_all(buf),
            Self::Server(server) => server.write_all(buf),
        }
    }
}

pub struct TlsEndpoint {
    pub entity: TlsEntity,
    closing: bool,
}

impl TlsEndpoint {
    pub fn server(k: Option<String>, c: Option<String>, stream: TcpStream) -> TlsEndpoint {
        let sess = rustls::ServerConnection::new(Arc::new(server(k, c))).unwrap();
        let server = rustls::StreamOwned::new(sess, stream);
        let mut ep = TlsEndpoint {
            entity: TlsEntity::Server(server),
            closing: false,
        };
        ep.handshake();
        ep
    }
    pub fn client(stream: TcpStream) -> TlsEndpoint {
        let sess = rustls::ClientConnection::new(
            Arc::new(client()),
            rustls::ServerName::IpAddress(stream.peer_addr().unwrap().ip()),
        )
        .unwrap();
        let client = rustls::StreamOwned::new(sess, stream);
        let mut ep = TlsEndpoint {
            entity: TlsEntity::Client(client),
            closing: false,
        };
        ep.handshake();
        ep
    }
    fn handshake(&mut self) {
        let mut poll = Poll::new().unwrap();
        let mut events = Events::with_capacity(1024);

        poll.registry()
            .register(
                self.entity.get_mut(),
                Token(1),
                Interest::READABLE | Interest::WRITABLE,
            )
            .unwrap();

        loop {
            poll.poll(&mut events, Some(Duration::from_millis(10)))
                .unwrap();
            for event in events.iter() {
                match event.token() {
                    Token(1) => {
                        if event.is_readable() {
                            self.ready();
                        }
                        if event.is_writable() {
                            self.do_tls_write_and_handle_error();
                        }
                        if !self.entity.is_handshaking() {
                            poll.registry().deregister(self.entity.get_mut()).unwrap();
                            return;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    fn do_write(&mut self) -> io::Result<usize> {
        self.entity.write_tls()
    }

    fn do_tls_write_and_handle_error(&mut self) {
        let rc = self.do_write();
        if rc.is_err() {
            println!("write failed {:?}", rc);
            self.closing = true;
            return;
        }
    }
    /// We're a connection, and we have something to do.
    pub fn ready(&mut self) {
        // If we're readable: read some TLS.  Then
        // see if that yielded new plaintext.  Then
        // see if the backend is readable too.
        self.do_tls_read();
        // self.try_plain_read();
        // self.try_back_read();

        if self.closing {
            // let _ = self.entity.get_mut().shutdown(std::net::Shutdown::Both);
            // self.close_back();
            // self.closed = true;
        }
    }

    fn do_tls_read(&mut self) {
        // Read some TLS data.
        let rc = self.entity.read_tls();
        if rc.is_err() {
            let err = rc.unwrap_err();

            if let io::ErrorKind::WouldBlock = err.kind() {
                return;
            }

            println!("read error {:?}", err);
            self.closing = true;
            return;
        }

        if rc.unwrap() == 0 {
            println!("eof");
            self.closing = true;
            return;
        }

        // Process newly-received TLS messages.
        let processed = self.entity.process_new_packets();
        if processed.is_err() {
            println!("cannot process packet: {:?}", processed);

            // last gasp write to send any alerts
            self.do_tls_write_and_handle_error();

            self.closing = true;
            return;
        }
    }

    fn _try_plain_read(&mut self) {
        // Read and process all available plaintext.
        let mut buf = Vec::new();

        let rc = self.entity.read_to_end(&mut buf);
        if rc.is_err() {
            println!("plaintext read failed: {:?}", rc);
            self.closing = true;
            return;
        }

        if !buf.is_empty() {
            println!("plaintext read {:?} {:?}", buf.len(), buf);
            // self.incoming_plaintext(&buf);
        }
    }

    fn _try_back_read(&mut self) {
        // if self.back.is_none() {
        //     return;
        // }

        // Try a non-blocking read.
        let mut buf = [0u8; 1024];
        let back = self.entity.get_mut();
        let rc = _try_read(std::io::Read::read(back, &mut buf));

        if rc.is_err() {
            println!("backend read failed: {:?}", rc);
            self.closing = true;
            return;
        }

        let maybe_len = rc.unwrap();

        // If we have a successful but empty read, that's an EOF.
        // Otherwise, we shove the data into the TLS session.
        match maybe_len {
            Some(len) if len == 0 => {
                println!("back eof");
                self.closing = true;
            }
            Some(len) => {
                self.entity.write_all(&buf[..len]).unwrap();
            }
            None => {}
        };
    }
}

impl Stream for TlsEndpoint {
    fn read(&mut self, _buf: &mut [u8]) -> io::Result<usize> {
        let send = &mut self.entity;
        match send {
            TlsEntity::Server(s) => s.read(_buf),
            _ => Ok(0),
        }
    }
    fn write(&mut self, _buf: &[u8]) -> io::Result<usize> {
        let send = &mut self.entity;
        match send {
            TlsEntity::Client(c) => c.write(_buf),
            _ => Ok(0),
        }
    }
    fn fd(&self) -> RawFd {
        #[cfg(unix)]
        return self.entity.get_ref().as_raw_fd();
        #[cfg(windows)]
        return self.entity.get_ref().as_raw_socket();
    }
    fn register(&mut self, poll: &mut Poll, token: Token) {
        poll.registry()
            .register(self.entity.get_mut(), token, Interest::WRITABLE)
            .unwrap();
    }
    fn deregister(&mut self, poll: &mut Poll) {
        poll.registry().deregister(self.entity.get_mut()).unwrap();
    }
    fn as_any(&self) -> &dyn Any {
        self
    }
    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
    fn print_new_stream(&self) {
        let stream = self.entity.get_ref();
        stream.print_new_stream();
    }
    fn socket_type(&self) -> Conn {
        Conn::TLS
    }
}

impl<'a> From<&'a Box<dyn Stream>> for &'a TlsEndpoint {
    fn from(s: &'a Box<dyn Stream>) -> &'a TlsEndpoint {
        let b = match s.as_any().downcast_ref::<TlsEndpoint>() {
            Some(b) => b,
            None => panic!("Stream is not a {}", stringify!(TlsEndpoint)),
        };
        b
    }
}
impl<'a> From<&'a mut Box<dyn Stream>> for &'a mut TlsEndpoint {
    fn from(s: &'a mut Box<dyn Stream>) -> &'a mut TlsEndpoint {
        let b = match s.as_any_mut().downcast_mut::<TlsEndpoint>() {
            Some(b) => b,
            None => panic!("Stream is not a {}", stringify!(TlsEndpoint)),
        };
        b
    }
}
