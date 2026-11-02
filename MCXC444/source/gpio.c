#include "gpio.h"
#include "fsl_common.h"

void initLED(void)
{
    SIM->SCGC5 |= SIM_SCGC5_PORTA_MASK;

    GPIOA->PCOR = (1UL << EXTERNAL_LED_PIN);
    PORTA->PCR[EXTERNAL_LED_PIN] &= ~PORT_PCR_MUX_MASK;
    PORTA->PCR[EXTERNAL_LED_PIN] |= PORT_PCR_MUX(1U);
    GPIOA->PDDR |= (1UL << EXTERNAL_LED_PIN);
}

void onLED(void)
{
    GPIOA->PSOR = (1UL << EXTERNAL_LED_PIN);
}

void offLED(void)
{
    GPIOA->PCOR = (1UL << EXTERNAL_LED_PIN);
}

void initPump(void)
{
	SIM->SCGC5 |= (SIM_SCGC5_PORTD_MASK | SIM_SCGC5_PORTE_MASK);
	PORTE->PCR[PUMP_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[PUMP_PIN] |= PORT_PCR_MUX(1U);
	GPIOE->PDDR |= (1UL << PUMP_PIN);
	offPump();
}

// Pump is active high
void onPump(void) { GPIOE->PSOR = (1UL << PUMP_PIN); }
void offPump(void) { GPIOE->PCOR = (1UL << PUMP_PIN); }

void initBuzzer(void)
{
	SIM->SCGC5 |= SIM_SCGC5_PORTA_MASK;
	GPIOA->PCOR = (1UL << BUZZER_PIN);
	PORTA->PCR[BUZZER_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTA->PCR[BUZZER_PIN] |= PORT_PCR_MUX(1U);
	GPIOA->PDDR |= (1UL << BUZZER_PIN);
}

void onBuzzer(void)  { GPIOA->PSOR = (1UL << BUZZER_PIN); }
void offBuzzer(void) { GPIOA->PCOR = (1UL << BUZZER_PIN); }
