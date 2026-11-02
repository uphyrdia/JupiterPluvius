#include <string.h>
#include <stdint.h>

#include "fsl_common.h"
#include "fsl_clock.h"

#include "FreeRTOS.h"
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
	// Enable the receiver and transmitter
	UART2->C2 |= UART_C2_RE_MASK;
	UART2->C2 |= UART_C2_TE_MASK;
	// Enable overrun interrupt
	UART2->C3 |= UART_C3_ORIE_MASK;

	NVIC_SetPriority(UART2_FLEXIO_IRQn, UART2_INT_PRIO);
	NVIC_ClearPendingIRQ(UART2_FLEXIO_IRQn);
	NVIC_EnableIRQ(UART2_FLEXIO_IRQn);
}

static char send_buffer[MAX_MSG_LEN];
static volatile int send_ptr = 0;

void UART2_Send(const TMessage *msg)
{
	if (msg == NULL) return;
	while (xSemaphoreTake(uart_sema, portMAX_DELAY) != pdTRUE) {}
	strncpy(send_buffer, msg->message, MAX_MSG_LEN);
	send_buffer[MAX_MSG_LEN - 1] = '\0';
	UART2->C2 |= UART_C2_TIE_MASK;
}

void UART2_FLEXIO_IRQHandler(void)
{
    // Transmitting data
	if ((UART2->C2 & UART_C2_TIE_MASK) && (UART2->S1 & UART_S1_TDRE_MASK))
	{
		if (send_buffer[send_ptr] == '\0')
		{
			send_ptr = 0;

			UART2->C2 &= ~UART_C2_TIE_MASK;

			BaseType_t hpw = pdFALSE;
			xSemaphoreGiveFromISR(uart_sema, &hpw);
			portYIELD_FROM_ISR(hpw);
		}
		else
			UART2->D = (uint8_t)send_buffer[send_ptr++];
	}

	// Receiving data with '\n' terminator
	static int recv_ptr = 0;
	static int discarding = 0;
    static TMessage msg;
	uint8_t status = UART2->S1;

    if (status & UART_S1_OR_MASK) {
        (void)UART2->D; // Read and discard the byte
        recv_ptr = 0;  // Discard the incomplete message
        discarding = 1;
    }
    else if (status & UART_S1_RDRF_MASK)
    {
		char rx_data = UART2->D;

		// Discard oversized message
		if (recv_ptr >= MAX_MSG_LEN - 1) {
			recv_ptr = 0;
			discarding = (rx_data != '\n');
			return;
		}

		if (discarding) {
			if (rx_data == '\n') discarding = 0;
			return;
		}

		msg.message[recv_ptr++] = rx_data;

		if (rx_data == '\n')
		{
			msg.message[recv_ptr] = '\0';
			recv_ptr = 0;

			BaseType_t hpw = pdFALSE;
			xQueueSendFromISR(queue, &msg, &hpw);
			portYIELD_FROM_ISR(hpw);
		}
    }
}
