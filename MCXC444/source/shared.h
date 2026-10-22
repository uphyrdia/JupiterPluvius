#ifndef SHARED_H_
#define SHARED_H_

#include "fsl_common.h"
#include "FreeRTOS.h"
#include "queue.h"
#include "semphr.h"

#define MAX_MSG_LEN		256

typedef struct tm {
	char message[MAX_MSG_LEN];
} TMessage;

/* Definitions live in main.c. */
extern QueueHandle_t queue;
extern SemaphoreHandle_t water_level_sema;
extern SemaphoreHandle_t print_mutex;
extern SemaphoreHandle_t uart_sema;

#endif /* SHARED_H_ */
