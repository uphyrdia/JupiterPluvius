#ifndef PWM_H_
#define PWM_H_

#include <stdint.h>

void setMCGIRClk(void);
void setTPMClock(void);
void initPWM(void);
void startPWM(void);
void stopPWM(void);
void setServoPulse(uint16_t ticks);

#define SERVO_PIN	3U	// PTD3, TPM0 channel 3
#define SERVO_CH	3U
#define SERVO_MIN   31U     /* 1.0 ms */
#define SERVO_MAX   62U     /* 2.0 ms */

#endif /* PWM_H_ */
