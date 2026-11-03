
#include <Arduino.h>
#include <DHTesp.h>
#include <math.h>
#include <string.h>

// PIN CONFIGURATION

// Sensors
#define DHT_PIN 7
#define LIGHT_PIN 8

// UART1
#define UART_RX_PIN 16
#define UART_TX_PIN 17

#define UART_BAUD 9600

DHTesp dht;

//Sensor Data
float temperature = NAN;
float humidity = NAN;

int lightADC = 0;

bool dhtValid = false;
bool lightValid = false;

//Timing Config
const unsigned long DHT_INTERVAL = 3000;
const unsigned long LIGHT_INTERVAL = 1000;
const unsigned long UART_INTERVAL = 5000;

unsigned long lastDHTRead = 0;
unsigned long lastLightRead = 0;
unsigned long lastUARTSend = 0;

//UART receive buffer
// Match the MCXC444 frame limit, including the terminating NUL.
const size_t RX_BUFFER_SIZE = 256;

char rxBuffer[RX_BUFFER_SIZE];

size_t rxIndex = 0;

//DHT11 reading
void readDHT11()
{
    TempAndHumidity data = dht.getTempAndHumidity();

    if (isnan(data.temperature) ||
        isnan(data.humidity))
    {
        dhtValid = false;

        Serial.println("[DHT11] Reading failed");

        Serial.print("[DHT11] Status: ");
        Serial.println(dht.getStatusString());

        return;
    }

    temperature = data.temperature;
    humidity = data.humidity;

    dhtValid = true;

    Serial.println();
    Serial.println("------ DHT11 SENSOR ------");

    Serial.print("Temperature: ");
    Serial.print(temperature, 1);
    Serial.println(" C");

    Serial.print("Humidity: ");
    Serial.print(humidity, 1);
    Serial.println(" %");

    Serial.println("--------------------------");
}

//Light sensor median filtering
int readLightMedian()
{
    const int NUM_SAMPLES = 9;

    int samples[NUM_SAMPLES];

    for (int i = 0; i < NUM_SAMPLES; i++)
    {
        samples[i] = analogRead(LIGHT_PIN);
        delay(2);
    }

    // Sort ADC samples
    for (int i = 0; i < NUM_SAMPLES - 1; i++)
    {
        for (int j = i + 1; j < NUM_SAMPLES; j++)
        {
            if (samples[j] < samples[i])
            {
                int temp = samples[i];
                samples[i] = samples[j];
                samples[j] = temp;
            }
        }
    }

    // Return median value
    return samples[NUM_SAMPLES / 2];
}

//Light sensor reading
void readLightSensor()
{
    lightADC = readLightMedian();
    lightValid = true;

    Serial.println();
    Serial.println("------ LIGHT SENSOR ------");

    Serial.print("Raw ADC: ");
    Serial.println(lightADC);

    Serial.println("--------------------------");
}

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
bool decodePacket(char *message)
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

//UART Transmission
void sendSensorData()
{
    if (!dhtValid || !lightValid)
    {
        Serial.println(
            "[UART TX] Skipped - sensor data invalid"
        );

        return;
    }

    char message[RX_BUFFER_SIZE];

    // Same framing as MCXC444: @DATA|payload*HHHH\n.
    // CRC covers DATA|payload, excluding @, *, CRC digits and newline.

    int length = snprintf(
        message,
        sizeof(message),
        "@DATA|TEMP:%.1f,HUM:%.1f,LIGHT_ADC:%d",
        temperature,
        humidity,
        lightADC
    );

    if (length < 0 ||
        (size_t)length + 7U > sizeof(message))
    {
        Serial.println("[UART TX] Packet error");
        return;
    }

    uint16_t crc = packetCRC(message + 1, (size_t)length - 1U);
    snprintf(message + length, sizeof(message) - (size_t)length,
             "*%04X\n", (unsigned int)crc);
    length += 6; // *HHHH and the newline.

    // Send the complete frame, including its single terminating newline.
    Serial1.write(
        (const uint8_t *)message,
        length
    );

    // Debug output
    Serial.println();
    Serial.print("[UART TX -> MCXC444] ");
    Serial.print(message);
}

// Process a complete frame only after validating its type and CRC.
void processUARTMessage(char *message)
{
    if (!decodePacket(message))
    {
        Serial.println("[UART RX] Invalid frame or CRC");
        return;
    }

    // SOIL is raw ADC; WATER is 1 when the reservoir level is OK.
    unsigned int soil;
    int water, pump, alarm, led;
    int consumed = 0;
    int parsed = sscanf(message,
        "SOIL:%u,WATER:%d,PUMP:%d,ALARM:%d,LED:%d%n",
        &soil, &water, &pump, &alarm, &led, &consumed);

    if (parsed != 5 || message[consumed] != '\0')
    {
        Serial.println("[UART RX] Invalid status payload");
        return;
    }

    Serial.println();
    Serial.print("[UART RX <- MCXC444] ");
    Serial.println(message);
    Serial.println("---- MCXC444 STATUS ----");
    Serial.print("Soil moisture ADC: ");
    Serial.println(soil);
    Serial.print("Reservoir: ");
    Serial.println(water ? "OK" : "LOW");
    Serial.print("Pump: ");
    Serial.println(pump ? "ON" : "OFF");
    Serial.print("Alarm: ");
    Serial.println(alarm ? "ON" : "OFF");
    Serial.print("LED: ");
    Serial.println(led ? "ON" : "OFF");
    Serial.println("-----------------------");
}

// Collect @...\n frames. A new @ restarts an incomplete frame.
void receiveUART()
{
    while (Serial1.available() > 0)
    {
        char c = (char)Serial1.read();

        if (c == '@') rxIndex = 0;
        else if (rxIndex == 0) continue;

        if (rxIndex >= RX_BUFFER_SIZE - 1)
        {
            rxIndex = 0;
            Serial.println("[UART RX] Buffer overflow");
            continue;
        }

        rxBuffer[rxIndex++] = c;
        if (c == '\n')
        {
            rxBuffer[rxIndex] = '\0';
            rxIndex = 0;
            processUARTMessage(rxBuffer);
        }
    }
}

void setup()
{
    Serial.begin(115200);

    delay(2000);

    Serial.println();
    Serial.println(" SMART IRRIGATION - ESP32-S2");
    Serial.println("------------------------------");

    dht.setup(DHT_PIN, DHTesp::DHT11);

    Serial.println("[INIT] DHT11 initialized");

    pinMode(LIGHT_PIN, INPUT);

    analogReadResolution(12);

    analogSetPinAttenuation(
        LIGHT_PIN,
        ADC_11db
    );

    Serial.println("[INIT] Light ADC initialized");

    Serial1.begin(
        UART_BAUD,
        SERIAL_8N1,
        UART_RX_PIN,
        UART_TX_PIN
    );

    Serial.println("[INIT] UART1 initialized");
    Serial.println("[INIT] Baud rate: 9600");
    Serial.println("[INIT] UART format: 8N1");


    //Initial Readings

    readLightSensor();

    // Give DHT11 enough startup time
    delay(2000);

    readDHT11();

    unsigned long now = millis();

    lastDHTRead = now;
    lastLightRead = now;
    lastUARTSend = now;

    Serial.println("[INIT] Setup complete");
}

void loop()
{
    unsigned long now = millis();

    receiveUART();

    //Read DHT every 3 seconds
    if (now - lastDHTRead >= DHT_INTERVAL)
    {
        lastDHTRead = now;

        readDHT11();
    }

    //Read Light ADC every second
    if (now - lastLightRead >= LIGHT_INTERVAL)
    {
        lastLightRead = now;

        readLightSensor();
    }

    //Send sensor readings every 5 seconds
    if (now - lastUARTSend >= UART_INTERVAL)
    {
        lastUARTSend = now;

        sendSensorData();
    }
}
