#include "uart.h"

#include <Arduino.h>
#include <stdio.h>
#include <string.h>

// Match the MCXC444 frame limit, including the terminating NUL.
static const size_t RX_BUFFER_SIZE = 256;
static char uartLine[RX_BUFFER_SIZE];
static size_t uartLength = 0;

// ==========================================================
// 5. UART FRAMING AND TX: ESP32-S2 -> MCXC444
// ==========================================================
/* CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF,
 * no reflection, no final XOR. Covers DATA|payload only. */
static uint16_t packetCRC(const char *data, size_t length)
{
	uint16_t crc = 0xFFFFU;
	for (size_t i = 0; i < length; i++) {
		crc ^= (uint16_t)(uint8_t)data[i] << 8;
		for (unsigned int bit = 0; bit < 8; bit++)
			crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
			                      : (uint16_t)(crc << 1);
	}
	return crc;
}

// Validate the frame and replace it with the plain payload.
static bool decodePacket(char *message)
{
	size_t length = strlen(message);
	if (length < 13U || strncmp(message, "@DATA|", 6) != 0 ||
	    message[length - 1] != '\n') return false;

	char *end = strchr(message + 6, '*');
	if (end != message + length - 6U ||
	    strpbrk(message + 6, "@\r") != NULL) return false;

	uint16_t received_crc = 0U;
	for (unsigned int i = 1; i <= 4; i++) {
		char c = end[i];
		unsigned int digit;
		if (c >= '0' && c <= '9') digit = (unsigned int)(c - '0');
		else if (c >= 'A' && c <= 'F') digit = (unsigned int)(c - 'A' + 10);
		else if (c >= 'a' && c <= 'f') digit = (unsigned int)(c - 'a' + 10);
		else return false;
		received_crc = (uint16_t)((received_crc << 4) | digit);
	}
	if (received_crc != packetCRC(message + 1,
	                             (size_t)(end - message - 1))) return false;

	*end = '\0';
	memmove(message, message + 6, (size_t)(end - message - 6) + 1U);
	return true;
}

void sendToMCXC444(float temperatureC, float humidityPercent, int lightRaw,
                   bool readingsFresh) {
  if (!readingsFresh) {
    Serial.println("[UART TX] Waiting for valid sensor readings");
    return;
  }

  char packet[RX_BUFFER_SIZE];
  int n = snprintf(packet, sizeof(packet),
                   "@DATA|TEMP:%.1f,HUM:%.1f,LIGHT_ADC:%d",
                   temperatureC, humidityPercent, lightRaw);
  if (n < 0 || (size_t)n + 7U > sizeof(packet)) {
    Serial.println("[UART TX] Packet formatting error");
    return;
  }

  uint16_t crc = packetCRC(packet + 1, (size_t)n - 1U);
  snprintf(packet + n, sizeof(packet) - (size_t)n,
           "*%04X\n", (unsigned int)crc);
  n += 6; // *HHHH and the newline.

  Serial1.write((const uint8_t*)packet, n);
  Serial.print("[UART TX -> MCXC444] ");
  Serial.print(packet);
}

// ==========================================================
// 6. UART RX: MCXC444 -> ESP32-S2
// ==========================================================
static void processMCXPacket(char* line, MCXStatus& mcx) {
  if (!decodePacket(line)) {
    Serial.println("[UART RX] Invalid frame or CRC");
    return;
  }
  Serial.print("[UART RX <- MCXC444] ");
  Serial.println(line);

  if (strcmp(line, "ACK") == 0) {
    Serial.println("[MCX] ACK received");
    return;
  }

  int soil, water, alarm, led;
  int consumed = 0;

  // Spaces in sscanf format permit either ",LED:" or ", LED:".
  // %n checks that the complete packet matches the expected format.
  int matched = sscanf(line,
      "SOIL:%d,WATER:%d,ALARM:%d, LED:%d %n",
      &soil, &water, &alarm, &led, &consumed);

  if (matched != 4 || consumed == 0 || line[consumed] != '\0' ||
      soil < 0 || soil > 4095 ||
      (water != 0 && water != 1) ||
      (alarm != 0 && alarm != 1) ||
      (led   != 0 && led   != 1)) {
    Serial.println("[MCX] Invalid/unsupported status packet");
    return;
  }

  mcx.soilADC = soil;
  mcx.waterFlag = water;
  mcx.alarm = (alarm == 1);
  mcx.ledOn = (led == 1);
  mcx.valid = true;
  mcx.receivedMs = millis();

  Serial.printf("[MCX] Soil ADC=%d | WaterFlag=%d | "
                "Alarm=%d | LED=%d\n",
                mcx.soilADC, mcx.waterFlag,
                mcx.alarm, mcx.ledOn);
}

// Collect @...\n frames. A new @ restarts an incomplete frame.
void receiveFromMCXC444(MCXStatus& mcx) {
  while (Serial1.available() > 0) {
    char ch = (char)Serial1.read();

    if (ch == '@') uartLength = 0;
    else if (uartLength == 0) continue;

    if (uartLength >= sizeof(uartLine) - 1) {
      uartLength = 0;
      Serial.println("[UART RX] Buffer overflow");
      continue;
    }

    uartLine[uartLength++] = ch;
    if (ch == '\n') {
      uartLine[uartLength] = '\0';
      uartLength = 0;
      processMCXPacket(uartLine, mcx);
    }
  }
}

bool mcxIsFresh(const MCXStatus& mcx, unsigned long now) {
  return mcx.valid && (now - mcx.receivedMs <= MCU_MAX_AGE_MS);
}
