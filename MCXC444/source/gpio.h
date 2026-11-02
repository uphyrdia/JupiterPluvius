#ifndef GPIO_H_
#define GPIO_H_

#define PUMP_PIN 	30  // PTE30
#define BUZZER_PIN 13 // PTA13
#define EXTERNAL_LED_PIN 5 // PTA5
void initLED(void);
void initPump(void);
void onLED(void);
void offLED(void);
void onPump(void);
void offPump(void);
void initBuzzer(void);
void onBuzzer(void);
void offBuzzer(void);

#endif /* GPIO_H_ */
