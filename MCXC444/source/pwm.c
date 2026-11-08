/*
 * Since a water pump is used instead of a servo,
 * the pwm component is no longer used.
 */

#include <stdint.h>

#include "fsl_common.h"
#include "fsl_port.h"

#include "pwm.h"

/* Configure the MCG Internal Reference Clock. */
void setMCGIRClk(void)
{
	// Set IRCLKEN to 1 to enable LIRC
	MCG->C1 |= MCG_C1_IRCLKEN_MASK;
	// Set IRCS to 1 to choose 8 MHz clock
	MCG->C2 |= MCG_C2_IRCS_MASK;
	// Clear FCRDIV bits in MCG_SC for divisor of 1
	MCG->SC &= ~MCG_SC_FCRDIV_MASK;
	// Clear LIRC_DIV2 bits in MCG_MC for divisor of 1
	MCG->MC &= ~MCG_MC_LIRC_DIV2_MASK;
}

void setTPMClock(void)
{
	setMCGIRClk();
	// Set TPM clock source to use MCGIRCLK
	SIM->SOPT2 &= ~SIM_SOPT2_TPMSRC_MASK;
	SIM->SOPT2 |= SIM_SOPT2_TPMSRC(0b11);
}

/* Configure TPM0 for centre-aligned PWM on the servo pin. */
void initPWM(void)
{
	// Turn on the clock gating to PORTD
	SIM->SCGC5 |= SIM_SCGC5_PORTD_MASK;
	// select PWM function
	PORTD->PCR[SERVO_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTD->PCR[SERVO_PIN] |= PORT_PCR_MUX(4U);
	// Turn on the clock gating to TPM0
	SIM->SCGC6 |= SIM_SCGC6_TPM0_MASK;
	// Stop TPMx and clear the prescalar bits
	TPM0->SC &= ~(TPM_SC_CMOD_MASK | TPM_SC_PS_MASK);
	// Set a prescalar of 128
	TPM0->SC |= TPM_SC_PS(0x7);
	// Select centre-aligned PWM (up-down counting) mode
	TPM0->SC |= TPM_SC_CPWMS_MASK;
	// Initialize count to 0
	TPM0->CNT = 0; // ALWAYS CLEAR TPMx_CNT BEFORE SETTING TPMx_MOD
	// Initialize modulo for 50 Hz (standard hobby servo)
	TPM0->MOD = 625;
	// Configure TPMx channels
	TPM0->CONTROLS[SERVO_CH].CnSC &= ~(TPM_CnSC_MSB_MASK | TPM_CnSC_ELSB_MASK);
	TPM0->CONTROLS[SERVO_CH].CnSC |= TPM_CnSC_MSB(1) | TPM_CnSC_ELSB(1); // servo expects high-true
	/* 1.5 ms centre */
	TPM0->CONTROLS[SERVO_CH].CnV = 47;
}

void startPWM(void) { TPM0->SC |= TPM_SC_CMOD(0b1); }
void stopPWM(void) { TPM0->SC &= ~TPM_SC_CMOD_MASK; }
void setServoPulse(uint16_t ticks)
{
	if (ticks > SERVO_MAX) ticks = SERVO_MAX;
	if (ticks < SERVO_MIN) ticks = SERVO_MIN;
	TPM0->CONTROLS[SERVO_CH].CnV = ticks;
}
