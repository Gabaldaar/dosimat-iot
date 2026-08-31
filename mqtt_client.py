# mqtt_client.py - Cliente MQTT asíncrono y no bloqueante nativo para MicroPython
import usocket as socket
import ustruct as struct
from ubinascii import hexlify

class MQTTException(Exception):
    pass

class SockWrapper:
    """Envoltorio para operaciones seguras de socket en MicroPython"""
    def __init__(self, s):
        self.s = s

    def read(self, *a):
        return self.s.read(*a)

    def write(self, buf, *args):
        if args:
            buf = buf[:args[0]]
        if isinstance(buf, str):
            buf = buf.encode('utf-8')
        t = 0
        while t < len(buf):
            r = self.s.write(buf[t:])
            if r:
                t += r
            else:
                # Si retorna None o 0, el socket podría estar saturado o cerrado
                raise OSError(11) # EAGAIN / EWOULDBLOCK
        return t

    def setblocking(self, b):
        self.s.setblocking(b)

    def settimeout(self, to):
        if hasattr(self.s, 'settimeout'):
            self.s.settimeout(to)

    def close(self):
        self.s.close()


class MQTTClient:
    def __init__(self, client_id, server, port=0, user=None, password=None, keepalive=0, ssl=False, ssl_params={}):
        if port == 0:
            port = 8883 if ssl else 1883
        self.client_id = client_id
        self.sock = None
        self.server = server
        self.port = port
        self.ssl = ssl
        self.ssl_params = ssl_params
        self.pid = 0
        self.cb = None
        self.user = user
        self.pswd = password
        self.keepalive = keepalive
        self.lw_topic = None
        self.lw_msg = None
        self.lw_qos = 0
        self.lw_retain = False

    def _readexactly(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.read(n - len(buf))
            if not chunk:
                raise MQTTException("Conexión perdida en lectura")
            buf += chunk
        return buf

    def _send_str(self, s):
        if isinstance(s, str):
            s = s.encode("utf-8")
        self.sock.write(struct.pack("!H", len(s)))
        self.sock.write(s)

    def _recv_len(self):
        n = 0
        sh = 0
        while True:
            res = self.sock.read(1)
            if res is None or len(res) == 0:
                raise MQTTException("Error leyendo longitud")
            b = res[0]
            n |= (b & 0x7F) << sh
            if not (b & 0x80):
                return n
            sh += 7

    def set_callback(self, cb):
        self.cb = cb

    def set_last_will(self, topic, msg, retain=False, qos=0):
        assert qos in (0, 1)
        self.lw_topic = topic
        self.lw_msg = msg
        self.lw_retain = retain
        self.lw_qos = qos

    def connect(self, clean_session=True):
        if self.sock:
            try: self.sock.close()
            except: pass
            self.sock = None

        s = socket.socket()
        try:
            s.settimeout(3.0)
            addr = socket.getaddrinfo(self.server, self.port)[0][-1]
            s.connect(addr)
            
            if self.ssl:
                import ussl
                s = ussl.wrap_socket(s, **self.ssl_params)
                
            self.sock = SockWrapper(s)
            self.sock.settimeout(5.0)

            # Preparar paquete CONNECT
            premsg = bytearray(b"\x10\0\0\4MQTT\x04\x00\0\0")
            msg = bytearray()
            if clean_session:
                premsg[9] |= 0x02
            if self.user is not None:
                premsg[9] |= 0x80
                user_bytes = self.user.encode("utf-8") if isinstance(self.user, str) else self.user
                msg += struct.pack("!H", len(user_bytes)) + user_bytes
                if self.pswd is not None:
                    premsg[9] |= 0x40
                    pswd_bytes = self.pswd.encode("utf-8") if isinstance(self.pswd, str) else self.pswd
                    msg += struct.pack("!H", len(pswd_bytes)) + pswd_bytes
            if self.keepalive:
                assert self.keepalive < 65536
                premsg[10] |= self.keepalive >> 8
                premsg[11] |= self.keepalive & 0xFF
            if self.lw_topic is not None:
                premsg[9] |= 0x04
                if self.lw_retain:
                    premsg[9] |= 0x20
                premsg[9] |= self.lw_qos << 3
                lw_topic_bytes = self.lw_topic.encode("utf-8") if isinstance(self.lw_topic, str) else self.lw_topic
                msg += struct.pack("!H", len(lw_topic_bytes)) + lw_topic_bytes
                lw_msg_bytes = self.lw_msg.encode("utf-8") if isinstance(self.lw_msg, str) else self.lw_msg
                msg += struct.pack("!H", len(lw_msg_bytes)) + lw_msg_bytes
            
            cid_bytes = self.client_id.encode("utf-8") if isinstance(self.client_id, str) else self.client_id
            premsg[1] = len(premsg) - 2 + len(msg) + len(cid_bytes) + 2
            
            self.sock.write(premsg)
            self._send_str(cid_bytes)
            self.sock.write(msg)
            
            # Leer respuesta CONNACK
            res = self.sock.read(4)
            if res is None or len(res) < 4:
                raise MQTTException("Error recibiendo CONNACK")
            assert res[0] == 0x20 and res[1] == 0x02
            if res[3] != 0:
                raise MQTTException(f"Conexión rechazada por Broker. Código: {res[3]}")
            return res[2] & 1
        except Exception:
            if self.sock:
                try: self.sock.close()
                except: pass
                self.sock = None
            else:
                try: s.close()
                except: pass
            raise

    def disconnect(self):
        if self.sock:
            try:
                self.sock.write(b"\xe0\0")
            except:
                pass
            try:
                self.sock.close()
            except:
                pass
            self.sock = None

    def ping(self):
        self.sock.write(b"\xc0\0")

    def publish(self, topic, msg, retain=False, qos=0):
        if isinstance(topic, str):
            topic = topic.encode("utf-8")
        if isinstance(msg, str):
            msg = msg.encode("utf-8")
        pkt = bytearray()
        pkt.append(0x30 | (qos << 1) | retain)
        sz = len(topic) + 2 + len(msg)
        if qos:
            self.pid += 1
            sz += 2
        while sz > 0x7F:
            pkt.append((sz & 0x7F) | 0x80)
            sz >>= 7
        pkt.append(sz)
        pkt.append(len(topic) >> 8)
        pkt.append(len(topic) & 0xFF)
        pkt.extend(topic)
        if qos:
            pkt.append(self.pid >> 8)
            pkt.append(self.pid & 0xFF)
        pkt.extend(msg)
        self.sock.write(pkt)

    def subscribe(self, topic, qos=0):
        if isinstance(topic, str):
            topic = topic.encode("utf-8")
        pkt = bytearray()
        pkt.append(0x82)
        self.pid += 1
        sz = 2 + 2 + len(topic) + 1
        while sz > 0x7F:
            pkt.append((sz & 0x7F) | 0x80)
            sz >>= 7
        pkt.append(sz)
        pkt.append(self.pid >> 8)
        pkt.append(self.pid & 0xFF)
        pkt.append(len(topic) >> 8)
        pkt.append(len(topic) & 0xFF)
        pkt.extend(topic)
        pkt.append(qos)
        self.sock.write(pkt)
        res = self._readexactly(5)
        if res[0] != 0x90 or res[1] != 0x03:
            raise MQTTException("SUBACK inválido")
        if struct.unpack("!H", res[2:4])[0] != self.pid:
            raise MQTTException("PID mismatch en SUBACK")
        if res[4] not in (0, 1, 2):
            raise MQTTException("Suscripción rechazada")

    def wait_msg(self):
        res = self.sock.read(1)
        if res is None or len(res) == 0:
            raise MQTTException("Socket cerrado en espera")
        if res == b"\xd0": # PINGRESP
            self.sock.read(1)
            return
        op = res[0]
        if op & 0xF0 != 0x30:
            return op
        sz = self._recv_len()
        topic_len = self._readexactly(2)
        topic_len = (topic_len[0] << 8) | topic_len[1]
        topic = self._readexactly(topic_len)
        sz -= topic_len + 2
        if op & 0x06:
            pid = self._readexactly(2)
            pid = (pid[0] << 8) | pid[1]
            sz -= 2
        msg = self._readexactly(sz)
        self.cb(topic, msg)
        if op & 0x06 == 2:
            pkt = bytearray(b"0\x02\0\0")
            struct.pack_into("!H", pkt, 2, pid)
            self.sock.write(pkt)

    def check_msg(self):
        """Verifica de forma no bloqueante si hay un mensaje en el buffer de red"""
        if not self.sock:
            return
        self.sock.settimeout(0.05)
        try:
            res = self.sock.read(1)
        except OSError as e:
            if self.sock: self.sock.settimeout(5.0)
            if e.args and e.args[0] in (11, 110, 115, 116):
                return
            raise
        except Exception:
            if self.sock: self.sock.settimeout(5.0)
            return

        if self.sock: self.sock.settimeout(5.0)
        
        if res is None or len(res) == 0:
            return
            
        if res == b"\xd0": # PINGRESP
            self.sock.read(1)
            return
            
        op = res[0]
        if op & 0xF0 != 0x30: # Espera solo PUBLISH
            return op
            
        sz = self._recv_len()
        topic_len = self._readexactly(2)
        topic_len = (topic_len[0] << 8) | topic_len[1]
        topic = self._readexactly(topic_len)
        sz -= topic_len + 2
        if op & 0x06:
            pid = self._readexactly(2)
            pid = (pid[0] << 8) | pid[1]
            sz -= 2
        msg = self._readexactly(sz)
        self.cb(topic, msg)
        if op & 0x06 == 2:
            pkt = bytearray(b"0\x02\0\0")
            struct.pack_into("!H", pkt, 2, pid)
            self.sock.write(pkt)
