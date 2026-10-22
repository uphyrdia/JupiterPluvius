#include "fsl_cmp.h"
#include "fsl_port.h"
#include "fsl_clock.h"
#include "fsl_common.h"

#include "FreeRTOS.h"
#include "task.h"
#include "semphr.h"

#include "shared.h"
#include "comparator.h"

/* Comparator state, read by the water level task. */
volatile int above_threshold = 0;

void Comparator_Init(void)
{
    /* PTC6 / J1 pin 9: analog comparator input. */
    CLOCK_EnableClock(kCLOCK_PortC);
    PORT_SetPinMux(PORTC, 6U, kPORT_PinDisabledOrAnalog);

    cmp_config_t config;
    CMP_GetDefaultConfig(&config);
    config.enableCmp = false;
    config.enableHighSpeed = true;
    config.enableInvertOutput = false;
    config.enablePinOut = false;
    config.hysteresisMode = kCMP_HysteresisLevel3;
    CMP_Init(CMP0, &config);

    cmp_dac_config_t threshold = {0};
    threshold.referenceVoltageSource = kCMP_VrefSourceVin2;
    threshold.DACValue = 31U;  /* 1.65 V with a 3.3 V reference */
    CMP_SetDACConfig(CMP0, &threshold);

    /* Positive = PTC6 (IN0); negative = internal DAC (IN7). */
    CMP_SetInputChannels(CMP0, 0U, 7U);
    CMP_Enable(CMP0, true);
}

/* Read after allowing the comparator/DAC to settle. */
bool Comparator_IsAboveThreshold(void)
{
    return (CMP_GetStatusFlags(CMP0) & kCMP_OutputAssertEventFlag) != 0U;
}

/* Number of rising edges seen by the comparator interrupt. */
volatile uint32_t comparatorRiseCount = 0U;

/* Comparator_Init() plus interrupt setup; call once before starting the scheduler. */
void ComparatorInterrupt_Init(void)
{
    DisableIRQ(CMP0_IRQn);

    /* Configure PTC6 and the internal DAC threshold. */
    Comparator_Init();

    /* Allow the comparator and DAC to settle. */
    SDK_DelayAtLeastUs(50U, SystemCoreClock);

    /* Discard any events produced during initialization. */
    CMP_ClearStatusFlags(CMP0, kCMP_OutputRisingEventFlag | kCMP_OutputFallingEventFlag);
    NVIC_ClearPendingIRQ(CMP0_IRQn);

    above_threshold = Comparator_IsAboveThreshold() ? 1 : 0;
    CMP_EnableInterrupts(CMP0, kCMP_OutputRisingInterruptEnable | kCMP_OutputFallingInterruptEnable);
    EnableIRQ(CMP0_IRQn);
}

void CMP0_IRQHandler(void)
{
    uint32_t flags = CMP_GetStatusFlags(CMP0);

    uint32_t edges = flags & (kCMP_OutputRisingEventFlag | kCMP_OutputFallingEventFlag);
    if (edges != 0U) {
        /* Clear all observed edges, then report the current input state. */
        CMP_ClearStatusFlags(CMP0, edges);
        above_threshold = Comparator_IsAboveThreshold() ? 1 : 0;
        if ((edges & kCMP_OutputRisingEventFlag) != 0U)
            comparatorRiseCount++;

        BaseType_t hpw = pdFALSE;
        xSemaphoreGiveFromISR(water_level_sema, &hpw);
        portYIELD_FROM_ISR(hpw);

    }

    SDK_ISR_EXIT_BARRIER;
}
