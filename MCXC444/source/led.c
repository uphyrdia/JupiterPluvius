#include "fsl_common.h"

#include "led.h"

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
	// LEDs are active low, writing 0 to a bit in PSOR/PCOR has no effect
	GPIOE->PSOR = (1UL << RED_PIN);
	GPIOD->PSOR = (1UL << GREEN_PIN);
	GPIOE->PSOR = (1UL << BLUE_PIN);
}
