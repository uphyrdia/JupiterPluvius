#include "fsl_common.h"

#include "gpio.h"

void initGPIO(void)
{
    SIM->SCGC5 |= SIM_SCGC5_PORTA_MASK;
    GPIOA->PCOR = (1UL << EXTERNAL_LED_PIN);
    PORTA->PCR[EXTERNAL_LED_PIN] &= ~PORT_PCR_MUX_MASK;
    PORTA->PCR[EXTERNAL_LED_PIN] |= PORT_PCR_MUX(1U);
    GPIOA->PDDR |= (1UL << EXTERNAL_LED_PIN);

	SIM->SCGC5 |= (SIM_SCGC5_PORTD_MASK | SIM_SCGC5_PORTE_MASK);
	PORTE->PCR[PUMP_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[PUMP_PIN] |= PORT_PCR_MUX(1U);
	GPIOE->PDDR |= (1UL << PUMP_PIN);
	offPump();

	SIM->SCGC5 |= SIM_SCGC5_PORTA_MASK;
	GPIOA->PCOR = (1UL << BUZZER_PIN);
	PORTA->PCR[BUZZER_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTA->PCR[BUZZER_PIN] |= PORT_PCR_MUX(1U);
	GPIOA->PDDR |= (1UL << BUZZER_PIN);
}

void onLED(void)
{
    GPIOA->PSOR = (1UL << EXTERNAL_LED_PIN);
}

void offLED(void)
{
    GPIOA->PCOR = (1UL << EXTERNAL_LED_PIN);
}

void onPump(void) { GPIOE->PSOR = (1UL << PUMP_PIN); }
void offPump(void) { GPIOE->PCOR = (1UL << PUMP_PIN); }


void onBuzzer(void)  { GPIOA->PSOR = (1UL << BUZZER_PIN); }
void offBuzzer(void) { GPIOA->PCOR = (1UL << BUZZER_PIN); }
