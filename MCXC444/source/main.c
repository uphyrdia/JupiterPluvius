/*
 * Copyright 2016-2025 NXP
 * All rights reserved.
 *
 * SPDX-License-Identifier: BSD-3-Clause=====
 */

/**
 * @file    main.c
 * @brief   Application entry point.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "board.h"
#include "peripherals.h"
#include "pin_mux.h"
#include "clock_config.h"
#include "fsl_debug_console.h"

#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"

#include "shared.h"
#include "gpio.h"
#include "adc.h"
#include "comparator.h"
#include "pwm.h"
#include "uart.h"

#define QLEN	5

#define LIGHT_ADC_THRESHOLD		20
#define MOISTURE_THRESHOLD 		1200

QueueHandle_t queue;
SemaphoreHandle_t led_sema;
SemaphoreHandle_t pump_sema;
SemaphoreHandle_t water_level_sema;
SemaphoreHandle_t print_mutex;
SemaphoreHandle_t uart_sema;

static unsigned int moisture = 2000;
static float temperature = 0.0f;
static float humidity = 0.0f;
static int light = 0;

static volatile int needLight = 0;

static void recvTask(void *p)
{
	for (;;) {
		static TMessage msg;
		int temp_x10;
		int humid_x10;
		char *field = NULL;

		while (xQueueReceive(queue, (void *)&msg, portMAX_DELAY) != pdTRUE) {}

		/*
		 * Expected format:
		 *   "TEMP:22.1,HUM:53.5,LIGHT_ADC:586\n"
		 * Each field is optional; values default to 0 when absent.
		 */
		field = strstr(msg.message, "TEMP:");
		if (field != NULL)
			temperature = strtof(field + 5, NULL);

		field = strstr(msg.message, "HUM:");
		if (field != NULL)
			humidity = strtof(field + 4, NULL);

		field = strstr(msg.message, "LIGHT_ADC:");
		if (field != NULL)
			light = (int)strtol(field + 10, NULL, 10);

		/*
		 * Control logic
		 * */
		if (needLight && light > LIGHT_ADC_THRESHOLD) {
			needLight = 0;
			xSemaphoreGive(led_sema);
		} else if (!needLight && light < LIGHT_ADC_THRESHOLD) {
			needLight = 1;
			xSemaphoreGive(led_sema);
		}

		/* One decimal place, rounded, for printing without float support. */
		temp_x10 = (int)((temperature * 10.0f) + ((temperature >= 0.0f) ? 0.5f : -0.5f));
		humid_x10 = (int)((humidity * 10.0f) + ((humidity >= 0.0f) ? 0.5f : -0.5f));

		/* Print the received / parsed message for debugging. */
		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Received message: %s\r\n", msg.message);
			/* PRINTF_FLOAT_ENABLE=0 in this project, so print as integers. */
			PRINTF("TEMP: %s%d.%d, HUM: %s%d.%d, LIGHT_ADC: %d\r\n",
			       (temperature < 0.0f) ? "-" : "", abs(temp_x10) / 10, abs(temp_x10) % 10,
			       (humidity < 0.0f) ? "-" : "", abs(humid_x10) / 10, abs(humid_x10) % 10,
			       light);
			xSemaphoreGive(print_mutex);
		}
	}
}

static void ledTask(void *p) // actually no need to make it an infinite loop?
{
	for (;;) {
		while (xSemaphoreTake(led_sema, portMAX_DELAY) != pdTRUE) {}
		if (needLight)
			onLED();
		else
			offLED();
	}
}

static void pumpTask(void *p)
{
	for (;;) {
		// pump_sema is currently given in soil_moisture_sensor_task
		// it may instead be given in recvTask after ESP32's consulting with AI
		while (xSemaphoreTake(pump_sema, portMAX_DELAY) != pdTRUE) {}
		onPump();
		vTaskDelay(pdMS_TO_TICKS(2000));
		offPump();
	}
}

static void soil_moisture_sensor_task(void *p)
{
	for (;;) {
		static TMessage msg;
		// In software-trigger mode, writing SC1A both selects the channel
		// and begins the conversion.
		// AIEN = 0: this conversion is polled, with no ADC interrupt.
		ADC0->SC1[0] = ADC_SC1_ADCH(SOIL_ADC_CHANNEL);
		while (!(ADC0->SC1[0] & ADC_SC1_COCO_MASK)) {}
		moisture = ADC0->R[0];

		if (moisture > MOISTURE_THRESHOLD) // too dry
			xSemaphoreGive(pump_sema);

		snprintf(msg.message, MAX_MSG_LEN, "SOIL:%u\n", moisture);
		UART2_Send(&msg);

		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Soil moisture ADC: %u\r\n", moisture); // Raw 0..4095
			xSemaphoreGive(print_mutex);
		}

		vTaskDelay(pdMS_TO_TICKS(500));
	}
}

static void water_level_sensor_task(void *p)
{
	static TMessage msg;

	// Send initial state
	snprintf(msg.message, MAX_MSG_LEN, "WATER:%d\n", above_threshold);
	UART2_Send(&msg);

	for (;;) {
		while (xSemaphoreTake(water_level_sema, portMAX_DELAY) != pdTRUE) {}

		snprintf(msg.message, MAX_MSG_LEN, "WATER:%d\n", above_threshold);
		UART2_Send(&msg);

		if (!above_threshold) {
			// set buzzer active to notify the user
		}

		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Water Level: %d\r\n", above_threshold);
			xSemaphoreGive(print_mutex);
		}
		vTaskDelay(pdMS_TO_TICKS(1000));
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

	pump_sema = xSemaphoreCreateBinary(); // initialized to 0
	led_sema = xSemaphoreCreateBinary();
	water_level_sema = xSemaphoreCreateBinary();
	uart_sema = xSemaphoreCreateBinary();

	xSemaphoreGive(uart_sema); // Initialize the UART semaphore to 1.

	print_mutex = xSemaphoreCreateMutex(); // initialized to 1

	initLED();
	initPump();
	ComparatorInterrupt_Init();
	initADC();
	initUART2();

	PRINTF("CG2271 Project\r\n");

	xTaskCreate(recvTask, "recvTask", configMINIMAL_STACK_SIZE+100, NULL, 4, NULL);
	xTaskCreate(soil_moisture_sensor_task, "soil", configMINIMAL_STACK_SIZE+100, NULL, 3, NULL);
	xTaskCreate(water_level_sensor_task, "water", configMINIMAL_STACK_SIZE+100, NULL, 3, NULL);
	xTaskCreate(pumpTask, "pump", configMINIMAL_STACK_SIZE+100, NULL, 2, NULL);
	xTaskCreate(ledTask, "led", configMINIMAL_STACK_SIZE+100, NULL, 2, NULL);

    vTaskStartScheduler();

    /* Force the counter to be placed into memory. */
    static volatile int i = 0 ;
    /* Enter an infinite loop, just incrementing a counter. */
    while(1) {
        i++ ;
        /* 'Dummy' NOP to allow source level single stepping of
            tight while() loop */
        __asm volatile ("nop");
    }
    return 0 ;
}
