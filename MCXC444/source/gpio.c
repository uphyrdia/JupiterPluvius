#include "fsl_common.h"

#include "gpio.h"

void initGPIO(void)
{
	SIM->SCGC5 |= (SIM_SCGC5_PORTD_MASK | SIM_SCGC5_PORTE_MASK);
	PORTE->PCR[RED_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[RED_PIN] |= PORT_PCR_MUX(1U);
	PORTD->PCR[GREEN_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTD->PCR[GREEN_PIN] |= PORT_PCR_MUX(1U);
	PORTE->PCR[BLUE_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[BLUE_PIN] |= PORT_PCR_MUX(1U);
	GPIOE->PDDR |= (1UL << RED_PIN);
	GPIOD->PDDR |= (1UL << GREEN_PIN);
	GPIOE->PDDR |= (1UL << BLUE_PIN);
	offLED();

	SIM->SCGC5 |= (SIM_SCGC5_PORTD_MASK | SIM_SCGC5_PORTE_MASK);
	PORTE->PCR[PUMP_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[PUMP_PIN] |= PORT_PCR_MUX(1U);
	GPIOE->PDDR |= (1UL << PUMP_PIN);
	offPump();
}

// LEDs are active low, writing 0 to a bit in PSOR/PCOR has no effect
void onLED(void)
{
	GPIOE->PCOR = (1UL << RED_PIN);
	GPIOD->PCOR = (1UL << GREEN_PIN);
	GPIOE->PCOR = (1UL << BLUE_PIN);
}

void offLED(void)
{
	GPIOE->PSOR = (1UL << RED_PIN);
	GPIOD->PSOR = (1UL << GREEN_PIN);
	GPIOE->PSOR = (1UL << BLUE_PIN);
}

void onPump(void) { GPIOE->PSOR = (1UL << PUMP_PIN); }
void offPump(void) { GPIOE->PCOR = (1UL << PUMP_PIN); }
