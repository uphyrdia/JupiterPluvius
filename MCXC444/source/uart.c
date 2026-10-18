/*
 * uart.c
 *
 * UART2 link to the ESP32: initialization and receive interrupt.
 */

#include <string.h>

#include "fsl_common.h"
#include "fsl_clock.h"

#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"

#include "shared.h"
#include "uart.h"

/* Configure UART2 on PTE22 (TX) / PTE23 (RX) and enable its RX interrupt. */
void initUART2(void)
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
	uint32_t sbr = (bus_clk + (BAUD_RATE * 8)) / (BAUD_RATE * 16);
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
