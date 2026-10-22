#include "gpio.h"
#include "fsl_common.h"

void initLED(void)
{
	// Turn on the clock gating to PORTD and PORTE
	SIM->SCGC5 |= (SIM_SCGC5_PORTD_MASK | SIM_SCGC5_PORTE_MASK);
	// Configure the RGB LED MUX to select GPIO function
	PORTE->PCR[RED_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[RED_PIN] |= PORT_PCR_MUX(1U);
	PORTD->PCR[GREEN_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTD->PCR[GREEN_PIN] |= PORT_PCR_MUX(1U);
	PORTE->PCR[BLUE_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[BLUE_PIN] |= PORT_PCR_MUX(1U);
	// Set as output
	GPIOE->PDDR |= (1UL << RED_PIN);
	GPIOD->PDDR |= (1UL << GREEN_PIN);
	GPIOE->PDDR |= (1UL << BLUE_PIN);
	// Turn off at boot
	offLED();
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
