#ifndef CG2271_UART_H
#define CG2271_UART_H

struct MCXStatus {
  bool valid = false;
  int soilADC = 0;         // Raw 12-bit soil reading (0..4095)
  int waterFlag = 0;       // Binary threshold status (0 or 1)
  bool pumpOn = false;     // 1 = pump/valve active
  bool alarm = false;      // 1 = buzzer on
  bool ledOn = false;      // 1 = external LED on
  unsigned long receivedMs = 0;
};

// Send only when the supplied sensor readings are fresh.
void sendToMCXC444(float temperatureC, float humidityPercent, int lightRaw,
                   bool readingsFresh);

// Consume available UART bytes and update status after a valid status frame.
void receiveFromMCXC444(MCXStatus& mcx);

#endif // CG2271_UART_H
