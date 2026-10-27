#include "fsl_cmp.h"
#include "fsl_port.h"
#include "fsl_clock.h"
#include "fsl_common.h"

#include "FreeRTOS.h"
#include "task.h"
#include "semphr.h"

#include "shared.h"
#include "comparator.h"

void Comparator_Init(void)
{
	/* PTC6 / J1 pin 9: analog comparator input.
	 * Enable the PORTC clock, then select ALT0 (analog / pin disabled). */
	SIM->SCGC5 |= SIM_SCGC5_PORTC_MASK;
	PORTC->PCR[WATER_LEVEL_PIN] &= ~PORT_PCR_MUX_MASK;

    /* Enable the CMP0 clock gate (SIM_SCGC4 bit 19). */
    SIM->SCGC4 |= SIM_SCGC4_CMP0_MASK;

    /* Keep the comparator disabled while configuring. */
    CMP0->CR1 = 0U;

    /* CR0: hysteresis level 3, filter count 0 (filter disabled). */
    CMP0->CR0 = CMP_CR0_HYSTCTR(3U);

    /* CR1: high-speed mode, output not inverted, not driven to a pin,
     * trigger mode off; EN remains 0. */
    CMP0->CR1 = CMP_CR1_PMODE_MASK;

    /* DACCR: DAC enabled, Vin2 = VDD, VOSEL = 31
     * -> DACO = (3.3 V / 64) * (31 + 1) = 1.65 V. */
    CMP0->DACCR = CMP_DACCR_DACEN_MASK |
                  CMP_DACCR_VRSEL_MASK |
                  CMP_DACCR_VOSEL(31U);

    /* MUXCR: PSEL = 0 (IN0 / PTC6), MSEL = 7 (IN7 / internal DAC). */
    CMP0->MUXCR = CMP_MUXCR_PSEL(0U) | CMP_MUXCR_MSEL(7U);

    /* Enable the comparator. */
    CMP0->CR1 |= CMP_CR1_EN_MASK;
}

/* Read after allowing the comparator/DAC to settle. */
bool Comparator_IsAboveThreshold(void)
{
    return (CMP0->SCR & CMP_SCR_COUT_MASK) != 0U;
}

/* Number of rising edges seen by the comparator interrupt. */
volatile uint32_t comparatorRiseCount = 0U;

/* Comparator_Init() plus interrupt setup */
void ComparatorInterrupt_Init(void)
{
	NVIC_DisableIRQ(CMP0_IRQn);

    /* Configure PTC6 and the internal DAC threshold. */
    Comparator_Init();

    /* Allow the comparator and DAC to settle. */
    SDK_DelayAtLeastUs(50U, SystemCoreClock);

    /* Discard any events produced during initialization.
     * CFR/CFF are write-1-to-clear; mask them out of the read value first. */
    CMP0->SCR = (uint8_t)((CMP0->SCR & ~(CMP_SCR_CFR_MASK | CMP_SCR_CFF_MASK)) |
                          CMP_SCR_CFR_MASK | CMP_SCR_CFF_MASK);

    /* Clear any pending CMP0 IRQ in the NVIC (write 1 to ICPR). */
    NVIC->ICPR[((uint32_t)CMP0_IRQn) >> 5] =
        (1UL << (((uint32_t)CMP0_IRQn) & 0x1FUL));

    above_threshold = ((CMP0->SCR & CMP_SCR_COUT_MASK) != 0U) ? 1 : 0;

    /* Enable rising and falling edge interrupts (IER/IEF).
     * Mask CFR/CFF out of the read value so they are not cleared here. */
    {
        uint8_t scr = (uint8_t)(CMP0->SCR & ~(CMP_SCR_CFR_MASK | CMP_SCR_CFF_MASK));
        scr |= (CMP_SCR_IER_MASK | CMP_SCR_IEF_MASK);
        CMP0->SCR = scr;
    }

    NVIC_SetPriority(CMP0_IRQn, 2);
    NVIC_ClearPendingIRQ(CMP0_IRQn);
    NVIC_EnableIRQ(CMP0_IRQn);
}

void CMP0_IRQHandler(void)
{
    uint8_t flags = CMP0->SCR;
    uint8_t edges = (uint8_t)(flags & (CMP_SCR_CFR_MASK | CMP_SCR_CFF_MASK));

    if (edges != 0U) {
        /* Clear all observed edges (write 1 to CFR/CFF), preserving
         * IER/IEF/DMAEN. Re-reading SCR here also preserves an edge that
         * arrived between the flags read above and this write. */
        CMP0->SCR = (uint8_t)((CMP0->SCR & ~(CMP_SCR_CFR_MASK | CMP_SCR_CFF_MASK)) | edges);

        above_threshold = ((CMP0->SCR & CMP_SCR_COUT_MASK) != 0U) ? 1 : 0;
        if ((edges & CMP_SCR_CFR_MASK) != 0U)
            comparatorRiseCount++;

        BaseType_t hpw = pdFALSE;
        xSemaphoreGiveFromISR(water_level_sema, &hpw);
        portYIELD_FROM_ISR(hpw);
    }
}
