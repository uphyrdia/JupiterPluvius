#ifndef ADC_H_
#define ADC_H_

#define SOIL_PIN        	 2U	// PTB2
#define SOIL_ADC_CHANNEL	12U	// ADC0 channel 12

/* Configure and calibrate ADC0 for polled, software-triggered conversions. */
void initADC0(void);
unsigned int poll_soil_adc(void);

#endif /* ADC_H_ */
