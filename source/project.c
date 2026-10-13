/*
 * Copyright 2016-2025 NXP
 * All rights reserved.
 *
 * SPDX-License-Identifier: BSD-3-Clause=====
 */

/**
 * @file    CG2271RTOS.c
 * @brief   Application entry point.
 */
#include <stdio.h>
#include <stdlib.h>
#include "board.h"
#include "peripherals.h"
#include "pin_mux.h"
#include "clock_config.h"
#include "fsl_debug_console.h"

#include "fsl_cmp.h"
#include "fsl_port.h"
#include "fsl_clock.h"
#include "fsl_common.h"

#include <string.h>
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"

#define BAUD_RATE 9600
#define UART_TX_PTE22 	22
#define UART_RX_PTE23 	23
#define UART2_INT_PRIO	2

#define RED_PIN		31	// PTE31
#define GREEN_PIN	5	// PTD5
#define BLUE_PIN	29	// PTE29

#define MAX_MSG_LEN		256

// Soil AO: PTB2 (A2 / J4 pin 6), ADC0 channel 12.
#define SOIL_PIN        2U
#define SOIL_ADC_CHANNEL 12U
// Light analog output: PTC6 (J1 pin 9), CMP0 input 0.

#define QLEN	5

QueueHandle_t queue;
SemaphoreHandle_t sema; // Reserved for recvTask -> pwmTask
SemaphoreHandle_t light_sema;
SemaphoreHandle_t adc_mutex;
SemaphoreHandle_t mutex;
static volatile int light = 0;

typedef enum tl {
	RED, GREEN, BLUE
} TLED;

typedef struct tm {
	char message[MAX_MSG_LEN];
} TMessage;

/* Call after your normal board initialization. */
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
    threshold.DACValue = 5U;  /* 1.65 V with a 3.3 V reference */
    CMP_SetDACConfig(CMP0, &threshold);

    /* Positive = PTC6 (IN0); negative = internal DAC (IN7). */
    CMP_SetInputChannels(CMP0, 0U, 7U);
    CMP_Enable(CMP0, true);
}

/* Read after allowing the comparator/DAC to settle. */
bool Comparator_IsAboveThreshold(void)
{
    return (CMP_GetStatusFlags(CMP0) &
            kCMP_OutputAssertEventFlag) != 0U;
}

volatile uint32_t comparatorRiseCount = 0U;

void ComparatorInterrupt_Init(void)
{
    DisableIRQ(CMP0_IRQn);

    /* Configure PTC6 and the internal DAC threshold. */
    Comparator_Init();

    /* Allow the comparator and DAC to settle. */
    SDK_DelayAtLeastUs(50U, SystemCoreClock);

    /* Discard any events produced during initialization. */
    CMP_ClearStatusFlags(CMP0,
                         kCMP_OutputRisingEventFlag |
                         kCMP_OutputFallingEventFlag);
    NVIC_ClearPendingIRQ(CMP0_IRQn);

    light = Comparator_IsAboveThreshold() ? 1 : 0;
    CMP_EnableInterrupts(CMP0, kCMP_OutputRisingInterruptEnable |
                              kCMP_OutputFallingInterruptEnable);
    EnableIRQ(CMP0_IRQn);
}

void CMP0_IRQHandler(void)
{
    uint32_t flags = CMP_GetStatusFlags(CMP0);

    uint32_t edges = flags & (kCMP_OutputRisingEventFlag |
                              kCMP_OutputFallingEventFlag);
    if (edges != 0U) {
        /* Clear all observed edges, then report the current input state. */
        CMP_ClearStatusFlags(CMP0, edges);
        light = Comparator_IsAboveThreshold() ? 1 : 0;
        if ((edges & kCMP_OutputRisingEventFlag) != 0U)
            comparatorRiseCount++;

        BaseType_t hpw = pdFALSE;
        xSemaphoreGiveFromISR(light_sema, &hpw);
        portYIELD_FROM_ISR(hpw);

    }

    SDK_ISR_EXIT_BARRIER;
}

/* ----------------Template code to use PWM for servo motors-----------------*/
// Configure the MCG Internal Reference Clock
void setMCGIRClk() {
	// Set IRCLKEN to 1 to enable LIRC
	MCG->C1 |= MCG_C1_IRCLKEN_MASK;
	// Set IRCS to 1 to choose 8 MHz clock
	MCG->C2 |= MCG_C2_IRCS_MASK;
	// Clear FCRDIV bits in MCG_SC for divisor of 1
	MCG->SC &= ~MCG_SC_FCRDIV_MASK;
	// Clear LIRC_DIV2 bits in MCG_MC for divisor of 1
	MCG->MC &= ~MCG_MC_LIRC_DIV2_MASK;
}

void setTPMClock(){
	// Initialize the MCG Internal Reference Clock
	setMCGIRClk();
	// Set TPM clock source to use MCGIRCLK
	SIM->SOPT2 &= ~SIM_SOPT2_TPMSRC_MASK;
	SIM->SOPT2 |= SIM_SOPT2_TPMSRC(0b11);
}

void initPWM()
{
	// Turn on the clock gating to PORTD and PORTE
	SIM->SCGC5 |= (SIM_SCGC5_PORTD_MASK | SIM_SCGC5_PORTE_MASK);
	// Configure the RGB LED MUX to select PWM function
	PORTE->PCR[RED_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTD->PCR[GREEN_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[BLUE_PIN] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[RED_PIN] |= PORT_PCR_MUX(3U);
	PORTD->PCR[GREEN_PIN] |= PORT_PCR_MUX(4U);
	PORTE->PCR[BLUE_PIN] |= PORT_PCR_MUX(3U);
	// Turn on the clock gating to TPMx
	SIM->SCGC6 |= SIM_SCGC6_TPM0_MASK;
	// Stop TPMx and clear the prescalar bits
	TPM0->SC &= ~(TPM_SC_CMOD_MASK | TPM_SC_PS_MASK);
	// Set a prescalar of 128
	TPM0->SC |= TPM_SC_PS(0x7);
	// Select centre-aligned PWM (up-down counting) mode
	TPM0->SC |= TPM_SC_CPWMS_MASK;
	// Initialize count to 0
	TPM0->CNT = 0; // ALWAYS CLEAR TPMx_CNT BEFORE SETTING TPMx_MOD
	// Initialize modulo
	TPM0->MOD = 125;
	// Configure TPMx channels
	TPM0->CONTROLS[4].CnSC &= ~(TPM_CnSC_MSA_MASK | TPM_CnSC_ELSB_MASK);
	TPM0->CONTROLS[5].CnSC &= ~(TPM_CnSC_MSA_MASK | TPM_CnSC_ELSB_MASK);
	TPM0->CONTROLS[2].CnSC &= ~(TPM_CnSC_MSA_MASK | TPM_CnSC_ELSB_MASK);
	TPM0->CONTROLS[4].CnSC |= (TPM_CnSC_MSB(1) | TPM_CnSC_ELSA(1));
	TPM0->CONTROLS[5].CnSC |= (TPM_CnSC_MSB(1) | TPM_CnSC_ELSA(1));
	TPM0->CONTROLS[2].CnSC |= (TPM_CnSC_MSB(1) | TPM_CnSC_ELSA(1));
}

void startPWM() { TPM0->SC |= TPM_SC_CMOD(0b1); }
void stopPWM() { TPM0->SC &= ~TPM_SC_CMOD_MASK; }

/* ---------------------UART2 to communicate with ESP32----------------------*/
void initUART2(uint32_t baud_rate)
{
	NVIC_DisableIRQ(UART2_FLEXIO_IRQn);

	//enable clock to UART2 and PORTE
	SIM->SCGC4 |= SIM_SCGC4_UART2_MASK;
	SIM->SCGC5 |= SIM_SCGC5_PORTE_MASK;
	//Ensure Tx and Rx are disabled before configuration
	UART2->C2 &= ~((UART_C2_TE_MASK) | (UART_C2_RE_MASK));
	//connect UART pins for PTE22, PTE23
	PORTE->PCR[UART_TX_PTE22] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[UART_TX_PTE22] |= PORT_PCR_MUX(4);
	PORTE->PCR[UART_RX_PTE23] &= ~PORT_PCR_MUX_MASK;
	PORTE->PCR[UART_RX_PTE23] |= PORT_PCR_MUX(4);
	// Set the baud rate
	uint32_t bus_clk = CLOCK_GetBusClkFreq();
	// This version of sbr does integer rounding.
	uint32_t sbr = (bus_clk + (baud_rate * 8)) / (baud_rate * 16);
	// Set SBR. Bits 8 to 12 in BDH, 0-7 in BDL.
	// MUST SET BDH FIRST!
	UART2->BDH &= ~UART_BDH_SBR_MASK;
	UART2->BDH |= ((sbr >> 8) & UART_BDH_SBR_MASK);
	UART2->BDL = (uint8_t) (sbr &0xFF);
	// Disable loop mode
	UART2->C1 &= ~UART_C1_LOOPS_MASK;
	UART2->C1 &= ~UART_C1_RSRC_MASK;
	// Disable parity
	UART2->C1 &= ~UART_C1_PE_MASK;
	// 8-bit mode
	UART2->C1 &= ~UART_C1_M_MASK;
	// Enable RX interrupt
	UART2->C2 |= UART_C2_RIE_MASK;
	// Enable the receiver
	UART2->C2 |= UART_C2_RE_MASK;

	NVIC_SetPriority(UART2_FLEXIO_IRQn, UART2_INT_PRIO);
	NVIC_ClearPendingIRQ(UART2_FLEXIO_IRQn);
	NVIC_EnableIRQ(UART2_FLEXIO_IRQn);
}


void UART2_FLEXIO_IRQHandler(void)
{
    static int recv_ptr = 0;
    static int discarding = 0;
    static char recv_buffer[MAX_MSG_LEN];

    if (!(UART2->S1 & UART_S1_RDRF_MASK))
        return;

    char rx_data = UART2->D;

    // Discard the rest of an oversized message.
    if (discarding) {
        if (rx_data == '\n')
            discarding = 0;
        return;
    }

    // Reserve one byte for '\0'.
    if (recv_ptr >= MAX_MSG_LEN - 1) {
        recv_ptr = 0;
        discarding = (rx_data != '\n');
        return;
    }

    recv_buffer[recv_ptr++] = rx_data;

    if (rx_data == '\n') {
        TMessage msg;
        BaseType_t hpw = pdFALSE;

        recv_buffer[recv_ptr] = '\0';
        strncpy(msg.message, recv_buffer, MAX_MSG_LEN);
        recv_ptr = 0;

        xQueueSendFromISR(queue, &msg, &hpw);
        portYIELD_FROM_ISR(hpw);
    }
}

/* ----------------------------ADC configuration-----------------------------*/
static void initADC(void)
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

/* --------------------------------Tasks-------------------------------------*/
static void pwmTask(void *p)
{

}

static void recvTask(void *p)
{
	for (;;) {
		TMessage msg;
		if (xQueueReceive(queue, (void *)&msg, portMAX_DELAY) != pdTRUE)
			continue;
		if (xSemaphoreTake(mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Received message: %s\r\n", msg.message);
			xSemaphoreGive(mutex);
		}
	}
}

static void soil_moisture_sensor_task(void *p)
{
	for (;;) {
		if (xSemaphoreTake(adc_mutex, portMAX_DELAY) != pdTRUE)
			continue;
		// In software-trigger mode, writing SC1A both selects the channel
		// and begins the conversion.
		// AIEN = 0: this conversion is polled, with no ADC interrupt.
		ADC0->SC1[0] = ADC_SC1_ADCH(SOIL_ADC_CHANNEL);
		while (!(ADC0->SC1[0] & ADC_SC1_COCO_MASK)) {}
		unsigned int moisture = ADC0->R[0];
		xSemaphoreGive(adc_mutex);

		while (xSemaphoreTake(mutex, portMAX_DELAY) != pdTRUE) {}
		PRINTF("Soil moisture ADC: %u\r\n", moisture); // Raw 0..4095
		xSemaphoreGive(mutex);
		vTaskDelay(pdMS_TO_TICKS(500));
	}
}

static void light_sensor_task(void *p)
{
	for (;;) {
		while (xSemaphoreTake(light_sema, portMAX_DELAY) != pdTRUE) {}
		while (xSemaphoreTake(mutex, portMAX_DELAY) != pdTRUE) {}
		PRINTF("Light: %d\r\n", light);
		xSemaphoreGive(mutex);
	}
}

/*
 * @brief   Application entry point.
 */
int main(void)
{
    /* Init board hardware. */
	BOARD_InitBootPins();
    BOARD_InitBootClocks();
    BOARD_InitBootPeripherals();
#ifndef BOARD_INIT_DEBUG_CONSOLE_PERIPHERAL
    /* Init FSL debug console. */
    BOARD_InitDebugConsole();
#endif
	queue = xQueueCreate(QLEN, sizeof(TMessage));
	sema = xSemaphoreCreateBinary(); // recvTask -> pwmTask
	light_sema = xSemaphoreCreateBinary(); // Comparator state changed
	adc_mutex = xSemaphoreCreateMutex(); // One ADC conversion at a time
	mutex = xSemaphoreCreateMutex(); // Protect distance and serialize task PRINTF calls

	ComparatorInterrupt_Init();
	initADC();
	initUART2(BAUD_RATE);
	PRINTF("CG2271 Project\r\n");
	xTaskCreate(recvTask, "recvTask", configMINIMAL_STACK_SIZE+100, NULL, 2, NULL);
	// Enable after implementing pwmTask; an empty FreeRTOS task must not run.
	// xTaskCreate(pwmTask, "pwmTask", configMINIMAL_STACK_SIZE+100, NULL, 1, NULL);
	xTaskCreate(soil_moisture_sensor_task, "soil", configMINIMAL_STACK_SIZE+100,
	            NULL, 1, NULL);
	xTaskCreate(light_sensor_task, "light", configMINIMAL_STACK_SIZE+100,
	            NULL, 2, NULL);

    vTaskStartScheduler();

    /* Force the counter to be placed into memory. */
    volatile static int i = 0 ;
    /* Enter an infinite loop, just incrementing a counter. */
    while(1) {
        i++ ;
        /* 'Dummy' NOP to allow source level single stepping of
            tight while() loop */
        __asm volatile ("nop");
    }
    return 0 ;
}

