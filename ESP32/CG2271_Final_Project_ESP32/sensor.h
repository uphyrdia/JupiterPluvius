#ifndef CG2271_SENSOR_H
#define CG2271_SENSOR_H

const int DHT_PIN = 7;
const int LIGHT_PIN = 8;
const unsigned long SENSOR_MAX_AGE_MS = 10000;

// Latest readings; check freshness before using them.
extern float temperatureC;
extern float humidityPercent;
extern int lightRaw;

void initSensors();
void readDHT11();
void readLightSensor();
bool dhtIsFresh(unsigned long now);
bool lightIsFresh(unsigned long now);

#endif // CG2271_SENSOR_H
