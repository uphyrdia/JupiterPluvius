#ifndef GPIO_H_
#define GPIO_H_

#define RED_PIN		31	// PTE31
#define GREEN_PIN	5	// PTD5
#define BLUE_PIN	29	// PTE29
#define PUMP_PIN 	30  // PTE30

void initGPIO(void);
void onLED(void);
void offLED(void);
void onPump(void);
void offPump(void);

#endif /* GPIO_H_ */
