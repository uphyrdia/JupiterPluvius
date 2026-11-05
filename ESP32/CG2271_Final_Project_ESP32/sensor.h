#ifndef CG2271_SENSOR_H
#define CG2271_SENSOR_H

const int DHT_PIN = 7;
const int LIGHT_PIN = 8;
const unsigned long SENSOR_MAX_AGE_MS = 10000;

// Preliminary sensor calibration from measured readings:
// torch ~100, room ~500, covered ~3000+
const float LIGHT_BRIGHT_ADC = 100.0f;
const float LIGHT_DARK_ADC = 3000.0f;

// Latest readings; check freshness before using them.
extern float temperatureC;
extern float humidityPercent;
extern int lightRaw;

void initSensors();
void readDHT11();
void readLightSensor();
float lightIndexFromRaw(int raw);
bool dhtIsFresh(unsigned long now);
bool lightIsFresh(unsigned long now);

#endif // CG2271_SENSOR_H
