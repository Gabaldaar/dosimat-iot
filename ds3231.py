# ds3231.py - Driver simple para RTC DS3231 en MicroPython
class DS3231:
    def __init__(self, i2c, addr=0x68):
        self.i2c = i2c
        self.addr = addr

    def _bcd_to_dec(self, bcd):
        return (bcd // 16) * 10 + (bcd % 16)

    def _dec_to_bcd(self, dec):
        return (dec // 10) * 16 + (dec % 10)

    def get_time(self):
        # Leer 7 bytes de registros de tiempo: seg, min, hora, dia_semana, dia, mes, año
        try:
            data = self.i2c.readfrom_mem(self.addr, 0, 7)
            sec = self._bcd_to_dec(data[0] & 0x7F)
            minute = self._bcd_to_dec(data[1])
            hour = self._bcd_to_dec(data[2] & 0x3F)
            weekday = data[3]
            mday = self._bcd_to_dec(data[4])
            month = self._bcd_to_dec(data[5] & 0x1F)
            year = self._bcd_to_dec(data[6]) + 2000
            # Retorna tupla compatible con machine.RTC().datetime()
            # (year, month, day, weekday, hours, minutes, seconds, subseconds)
            return (year, month, mday, weekday, hour, minute, sec, 0)
        except Exception as e:
            print("[DS3231] Error al leer hora:", e)
            return None

    def save_time(self, t):
        # t es una tupla: (year, month, day, weekday, hour, minute, second)
        try:
            data = bytearray(7)
            data[0] = self._dec_to_bcd(t[6]) # seg
            data[1] = self._dec_to_bcd(t[5]) # min
            data[2] = self._dec_to_bcd(t[4]) # hora
            data[3] = t[3]                   # dia_semana
            data[4] = self._dec_to_bcd(t[2]) # dia
            data[5] = self._dec_to_bcd(t[1]) # mes
            data[6] = self._dec_to_bcd(t[0] - 2000) # año (2 dígitos)
            self.i2c.writeto_mem(self.addr, 0, data)
            return True
        except Exception as e:
            print("[DS3231] Error al escribir hora:", e)
            return False

    def get_temperature(self):
        try:
            t = self.i2c.readfrom_mem(self.addr, 0x11, 2)
            temp = t[0] + (t[1] >> 6) * 0.25
            return temp
        except Exception as e:
            print("[DS3231] Error al leer temperatura:", e)
            return None
