#ifndef UART_H_
#define UART_H_

#include <stdint.h>
#include "shared.h"

#define UART_TX_PTE22 	22
#define UART_RX_PTE23 	23
#define UART2_INT_PRIO	2
#define BAUD_RATE 		9600

void initUART2(void);
void UART2_Send(const TMessage *msg);

#endif /* UART_H_ */
