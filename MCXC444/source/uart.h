#ifndef UART_H_
#define UART_H_

#include <stdbool.h>

#define UART_TX_PTE22 	22
#define UART_RX_PTE23 	23
#define UART2_INT_PRIO	1
#define BAUD_RATE 		9600

void initUART2(void);
/* Send a plain payload as @DATA|payload*CRC\n. */
void UART2_Send(const TMessage *msg);
/* Validate an incoming frame and replace it with its payload. */
bool UART2_Decode(TMessage *msg);

#endif /* UART_H_ */
