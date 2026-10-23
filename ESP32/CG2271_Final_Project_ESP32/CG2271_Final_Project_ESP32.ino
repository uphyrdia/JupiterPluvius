
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
const size_t RX_BUFFER_SIZE = 128;

char rxBuffer[RX_BUFFER_SIZE];

size_t rxIndex = 0;
bool discardPacket = false;

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

    char message[128];

    // Raw environmental sensor packet:
    // TEMP:22.5,HUM:53.1,LIGHT_ADC:512

    int length = snprintf(
        message,
        sizeof(message),
        "TEMP:%.1f,HUM:%.1f,LIGHT_ADC:%d",
        temperature,
        humidity,
        lightADC
    );

    if (length < 0 ||
        length >= (int)sizeof(message))
    {
        Serial.println("[UART TX] Packet error");
        return;
    }

    // Send packet to MCXC444
    // Newline marks end of packet
    Serial1.write(
        (const uint8_t *)message,
        length
    );

    Serial1.write('\n');

    // Debug output
    Serial.println();
    Serial.print("[UART TX -> MCXC444] ");
    Serial.println(message);
}

/*
//Process received UART
void processUARTMessage(const char *message)
{
    Serial.println();

    Serial.print("[UART RX <- MCXC444] ");
    Serial.println(message);

    // Expected MCXC444 status packet:
    // SOIL:22,WATER:80,VALVE:1,ALARM:0

    float soil;
    float water;
    int valve;
    int alarm;

    int parsed = sscanf(
        message,
        "SOIL:%f,WATER:%f,VALVE:%d,ALARM:%d",
        &soil,
        &water,
        &valve,
        &alarm
    );

    if (parsed == 4)
    {
        Serial.println("---- MCXC444 STATUS ----");

        Serial.print("Soil moisture: ");
        Serial.print(soil, 1);
        Serial.println(" %");

        Serial.print("Water level: ");
        Serial.print(water, 1);
        Serial.println(" %");

        Serial.print("Valve: ");
        Serial.println(valve ? "OPEN" : "CLOSED");

        Serial.print("Alarm: ");
        Serial.println(alarm ? "ON" : "OFF");

        Serial.println("-----------------------");
    }
    else if (strcmp(message, "ACK") == 0)
    {
        Serial.println("[UART] ACK received");
    }
    else
    {
        Serial.println("[UART] Message received");
    }
}
*/ 

/*
//UART Reception
void receiveUART()
{
    while (Serial1.available() > 0)
    {
        char c = (char)Serial1.read();

        if (c == '\n')
        {
            if (!discardPacket)
            {
                rxBuffer[rxIndex] = '\0';

                if (rxIndex > 0)
                {
                    processUARTMessage(rxBuffer);
                }
            }

            rxIndex = 0;
            discardPacket = false;
        }
        else if (c == '\r')
        {
            // Ignore carriage return
        }
        else if (discardPacket)
        {
            // Ignore bytes until next newline
        }
        else if (rxIndex < RX_BUFFER_SIZE - 1)
        {
            rxBuffer[rxIndex++] = c;
        }
        else
        {
            rxIndex = 0;
            discardPacket = true;

            Serial.println(
                "[UART RX] Buffer overflow"
            );
        }
    }
}
*/

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

    //receiveUART();

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
