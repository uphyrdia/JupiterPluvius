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
#include "cmp.h"
#include "pwm.h"
#include "uart.h"

#define QLEN	5

#define LIGHT_ADC_THRESHOLD		20
/* Higher ADC values mean drier soil. */
#define SOIL_MOISTURE_ADC_THRESHOLD    	1200U

#define SOIL_MOISTURE_SAMPLING_PERIOD	 500U
#define SEND_INTERVAL_MS				1000U
#define PUMP_COOLDOWN_MS               60000U

QueueHandle_t queue;
SemaphoreHandle_t led_sema;
SemaphoreHandle_t pump_sema;
SemaphoreHandle_t reservoir_level_sema;
SemaphoreHandle_t print_mutex;
SemaphoreHandle_t uart_sema;

static unsigned int moisture = 2000;
volatile bool reservoir_level_ok; // initialized in initCMP0()

static bool pumping = false;
static bool alarming = false;
static bool lighting = false;

static float temperature = 0.0f;
static float humidity = 0.0f;
static int light_adc = 0;

static void recvTask(void *p)
{
	for (;;) {
		static TMessage msg;
		while (xQueueReceive(queue, (void *)&msg, portMAX_DELAY) != pdTRUE) {}
		if (!UART2_Decode(&msg)) continue;
		/*
		 * Payload after frame/CRC validation:
		 *   "TEMP:22.1,HUM:53.5,LIGHT_ADC:586"
		 * Missing fields retain their previous values.
		 */
		char *field = NULL;

		field = strstr(msg.message, "TEMP:");
		if (field != NULL)
			temperature = strtof(field + 5, NULL);

		field = strstr(msg.message, "HUM:");
		if (field != NULL)
			humidity = strtof(field + 4, NULL);

		field = strstr(msg.message, "LIGHT_ADC:");
		if (field != NULL)
			light_adc = (int)strtol(field + 10, NULL, 10);

		/* Lighting control logic */
		if (lighting && light_adc < LIGHT_ADC_THRESHOLD) {
			offLED();
			lighting = false;
		} else if (!lighting && light_adc > LIGHT_ADC_THRESHOLD) {
			onLED();
			lighting = true;
		}

		/* Print the parsed readings for debugging. */
		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Received readings: TEMP:%d,HUM:%d,LIGHT_ADC:%d\r\n",
					(int)temperature, (int)humidity, light_adc);
			xSemaphoreGive(print_mutex);
		}
	}
}

static void sendTask(void *p)
{
	for (;;) {
		static TMessage msg;
		snprintf(msg.message, MAX_MSG_LEN,
				"SOIL:%u,WATER:%d,PUMP:%d,ALARM:%d,LED:%d",
				moisture, reservoir_level_ok, pumping, alarming, lighting);
		UART2_Send(&msg);
		vTaskDelay(pdMS_TO_TICKS(SEND_INTERVAL_MS));
	}
}

static void pumpTask(void *p)
{
	for (;;) {
		while (xSemaphoreTake(pump_sema, portMAX_DELAY) != pdTRUE) {}

		unsigned int duration_ms = 3000U;
		if (temperature >= 30.0f || humidity <= 45.0f)
			duration_ms += 1000U;

		onPump();
		pumping = true;
		vTaskDelay(pdMS_TO_TICKS(duration_ms));
		offPump();
		pumping = false;

		vTaskDelay(pdMS_TO_TICKS(PUMP_COOLDOWN_MS));
	}
}

static void soil_moisture_sensor_task(void *p)
{
	for (;;) {
		moisture = poll_soil_adc();

		if (moisture > SOIL_MOISTURE_ADC_THRESHOLD)
			xSemaphoreGive(pump_sema);

		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE)
		{
			PRINTF("Soil moisture ADC: %u\r\n", moisture); // Raw 0..4095
			xSemaphoreGive(print_mutex);
		}
		vTaskDelay(pdMS_TO_TICKS(SOIL_MOISTURE_SAMPLING_PERIOD));
	}
}

static void water_level_sensor_task(void *p)
{
    if (reservoir_level_ok)
        offBuzzer();
    else
        onBuzzer();
	for (;;) {
		while (xSemaphoreTake(reservoir_level_sema, portMAX_DELAY) != pdTRUE) {}
		if (reservoir_level_ok)
			offBuzzer();
		else
			onBuzzer();

		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE)
		{
			PRINTF("Water Level: %d\r\n", reservoir_level_ok);
			xSemaphoreGive(print_mutex);
		}
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
    PRINTF("MCXC444 is running\r\n");

	queue = xQueueCreate(QLEN, sizeof(TMessage));

	pump_sema = xSemaphoreCreateBinary(); // initialized to 0
	reservoir_level_sema = xSemaphoreCreateBinary();
	uart_sema = xSemaphoreCreateBinary();

	xSemaphoreGive(uart_sema); // Initialize the UART semaphore to 1.

	print_mutex = xSemaphoreCreateMutex(); // initialized to 1

	initGPIO();
	initADC0();
	initCMP0();
	initUART2();

	PRINTF("CG2271 Project\r\n");

	xTaskCreate(recvTask, "recv", configMINIMAL_STACK_SIZE+100, NULL, 4, NULL);
	xTaskCreate(sendTask, "send", configMINIMAL_STACK_SIZE+100, NULL, 4, NULL);
	xTaskCreate(soil_moisture_sensor_task, "soil", configMINIMAL_STACK_SIZE+100, NULL, 3, NULL);
	xTaskCreate(water_level_sensor_task, "water", configMINIMAL_STACK_SIZE+100, NULL, 3, NULL);
	xTaskCreate(pumpTask, "pump", configMINIMAL_STACK_SIZE+100, NULL, 2, NULL);

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
