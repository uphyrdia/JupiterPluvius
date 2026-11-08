#include <string.h>
#include <stdint.h>
#include <stdio.h>

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

/* CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF,
 * no reflection, no final XOR. Covers DATA|payload only.
 * M_{n+1} x^16 = (M_{n} x^8 + B_{n+1}) x^16 = (M_{n} x^16 + B_{n+1} x^8) x^8 */
static uint16_t packetCRC(const char *data, size_t length)
{
	uint16_t crc = 0xFFFFU;
	for (size_t i = 0; i < length; i++) {
		crc ^= (uint16_t)(uint8_t)data[i] << 8;
		for (unsigned int bit = 0; bit < 8; bit++)
			crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
			                      : (uint16_t)(crc << 1);
	}
	return crc;
}

/* Input is a payload without a newline. The wire frame is:
 * @DATA|payload*HHHH\n (HHHH is the CRC in hexadecimal).
 * @, *, CR and LF are reserved and cannot appear in the payload.
 * MAX_MSG_LEN includes the frame and terminating NUL: max payload is 243 bytes. */
void UART2_Send(const TMessage *msg)
{
	if (msg == NULL || msg->message[0] == '\0' ||
	    strpbrk(msg->message, "@*\r\n") != NULL) return;

	while (xSemaphoreTake(uart_sema, portMAX_DELAY) != pdTRUE) {}

	int length = snprintf(send_buffer, sizeof(send_buffer), "@DATA|%s", msg->message);
	/* Reserve six bytes for *HHHH\n and one for the terminating NUL. */
	if (length < 0 || (size_t)length + 7U > sizeof(send_buffer)) {
		xSemaphoreGive(uart_sema);
		return;
	}
	uint16_t crc = packetCRC(send_buffer + 1, (size_t)length - 1U);
	snprintf(send_buffer + length, sizeof(send_buffer) - (size_t)length,
	         "*%04X\n", (unsigned int)crc);
	UART2->C2 |= UART_C2_TIE_MASK;
}

/* Called by recvTask, not the ISR. Valid frames become plain payloads. */
bool UART2_Decode(TMessage *msg)
{
	size_t length = strlen(msg->message);
	if (length < 13U || strncmp(msg->message, "@DATA|", 6) != 0 ||
	    msg->message[length - 1] != '\n') return false;

	char *end = strchr(msg->message + 6, '*');
	if (end != msg->message + length - 6U ||
	    strpbrk(msg->message + 6, "@\r") != NULL) return false;

	uint16_t received_crc = 0U;
	for (unsigned int i = 1; i <= 4; i++) {
		char c = end[i];
		unsigned int digit;
		if (c >= '0' && c <= '9') digit = (unsigned int)(c - '0');
		else if (c >= 'A' && c <= 'F') digit = (unsigned int)(c - 'A' + 10);
		else if (c >= 'a' && c <= 'f') digit = (unsigned int)(c - 'a' + 10);
		else return false;
		received_crc = (uint16_t)((received_crc << 4) | digit);
	}
	if (received_crc != packetCRC(msg->message + 1,
	                             (size_t)(end - msg->message - 1))) return false;

	*end = '\0';
	memmove(msg->message, msg->message + 6, (size_t)(end - msg->message - 6) + 1U);
	return true;
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

	// Collect @...\n frames; a new @ restarts an incomplete frame.
	static int recv_ptr = 0;
    static TMessage msg;
	uint8_t status = UART2->S1;

    if (status & UART_S1_OR_MASK) {
        (void)UART2->D; // Read and discard the byte
        recv_ptr = 0;  // Discard the incomplete message
    }
    else if (status & UART_S1_RDRF_MASK)
    {
		char rx_data = UART2->D;

		if (rx_data == '@') recv_ptr = 0;
		else if (recv_ptr == 0) return; // Ignore bytes until a frame starts.

		if (recv_ptr >= MAX_MSG_LEN - 1) {
			recv_ptr = 0;
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
