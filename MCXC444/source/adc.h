#ifndef ADC_H_
#define ADC_H_

// Soil AO: PTB2 (A2 / J4 pin 6), ADC0 channel 12.
#define SOIL_PIN        2U
#define SOIL_ADC_CHANNEL 12U

/* Configure and calibrate ADC0 for polled, software-triggered conversions. */
void initADC0(void);
unsigned int poll_soil_adc(void);

#endif /* ADC_H_ */
