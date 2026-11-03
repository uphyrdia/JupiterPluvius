#include "fsl_common.h"
#include "fsl_debug_console.h"

#include "adc.h"

void initADC0(void)
{
	SIM->SCGC5 |= SIM_SCGC5_PORTB_MASK;
	SIM->SCGC6 |= SIM_SCGC6_ADC0_MASK;

	NVIC_DisableIRQ(ADC0_IRQn);

	// MUX = 0 selects analog function
	PORTB->PCR[SOIL_PIN] &= ~PORT_PCR_MUX_MASK;

	ADC0->CFG1 = ADC_CFG1_MODE(1)	// 12-bit resolution
			| ADC_CFG1_ADLSMP_MASK  // Long sampling time
			| ADC_CFG1_ADICLK(1)    // Bus clock / 2
			| ADC_CFG1_ADIV(3);     // Further divide by 8

	/* Ensure MUXSEL = 0 to select the "a" channel group */
	ADC0->CFG2 = 0;

	/*
	 * Select software triggering, the VALTH/VALTL reference pair.
	 * Disable comparison and DMA.
	 */
	ADC0->SC2 = ADC_SC2_REFSEL(1U);

	ADC0->SC1[0] = ADC_SC1_ADCH(31); // Disable conversions during setup

	// Calibrate once before either task uses ADC0 (reference manual 23.5.6).
	ADC0->SC3 = ADC_SC3_CALF_MASK | ADC_SC3_CAL_MASK |
	            ADC_SC3_AVGE_MASK | ADC_SC3_AVGS(3);
	// Busy-waits until calibration finishes
	// Hardware automatically clears CAL when finished.
	while (ADC0->SC3 & ADC_SC3_CAL_MASK) {}
	// Prints whether calibration succeeds
	if (ADC0->SC3 & ADC_SC3_CALF_MASK)
    	PRINTF("ADC calibration failed\r\n");
	else
		PRINTF("ADC calibration successful\r\n");
	// Completes the plus-side gain calibration using the manual’s prescribed calculation
	ADC0->PG = ((ADC0->CLP0 + ADC0->CLP1 + ADC0->CLP2 +
				ADC0->CLP3 + ADC0->CLP4 + ADC0->CLPS) / 2) | 0x8000U;
	// Performs the same calculation for the minus-side gain register
	ADC0->MG = ((ADC0->CLM0 + ADC0->CLM1 + ADC0->CLM2 +
				ADC0->CLM3 + ADC0->CLM4 + ADC0->CLMS) / 2) | 0x8000U;

	/*
	 * Disable hardware averaging and continuous conversion.
	 * Therefore each write to SC1A causes exactly one conversion.
	 */
	ADC0->SC3 = 0;

	/* ADCH = 31 leaves the ADC disabled until startADC() selects a channel. */
	ADC0->SC1[0] = ADC_SC1_ADCH(31);

	NVIC_SetPriority(ADC0_IRQn, 3); // Lowest priority on Cortex-M0+
	NVIC_ClearPendingIRQ(ADC0_IRQn);
	NVIC_EnableIRQ(ADC0_IRQn);
}

unsigned int poll_soil_adc(void)
{
	// In software-trigger mode, writing SC1A both selects the channel
	// and begins the conversion.
	// AIEN = 0: this conversion is polled, with no ADC interrupt.
	ADC0->SC1[0] = ADC_SC1_ADCH(SOIL_ADC_CHANNEL);
	while (!(ADC0->SC1[0] & ADC_SC1_COCO_MASK)) {}
	return ADC0->R[0];
}
