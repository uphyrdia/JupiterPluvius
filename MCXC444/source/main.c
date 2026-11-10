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
#include "uart.h"

#define QLEN	5

/* Lower ADC values mean brighter light: below the threshold is bright, at or above
 * it is dark (same rule as LIGHT_STATE_THRESHOLD on the ESP32). */
#define LIGHT_ADC_THRESHOLD				1000
/* Higher ADC values mean drier soil. */
#define SOIL_MOISTURE_ADC_THRESHOLD		1200U

#define SOIL_MOISTURE_SAMPLING_PERIOD	 500U
#define SEND_INTERVAL_MS				1000U
#define PUMP_COOLDOWN_MS               10000U

QueueHandle_t queue;
SemaphoreHandle_t pump_sema;
SemaphoreHandle_t reservoir_level_sema;
SemaphoreHandle_t print_mutex;
SemaphoreHandle_t uart_sema;

static unsigned int moisture = 1000;
volatile bool reservoir_level_ok; // initialized in initCMP0()

static bool lighting = false;

static float temperature = 0.0f;
static float humidity = 0.0f;
static int light_adc = 0;

static void recvTask(void *p)
{
	static TMessage msg;
	for (;;) {
		while (xQueueReceive(queue, (void *)&msg, portMAX_DELAY) != pdTRUE) {}
		if (!UART2_Decode(&msg)) continue;

		float parsed_temperature;
		float parsed_humidity;
		int parsed_light_adc;

		int matched = sscanf(msg.message,
		                     "TEMP:%f,HUM:%f,LIGHT_ADC:%d",
		                     &parsed_temperature,
		                     &parsed_humidity,
		                     &parsed_light_adc);
		if (matched == 3) {
		    temperature = parsed_temperature;
		    humidity = parsed_humidity;
		    light_adc = parsed_light_adc;
		}

		/* Lighting control logic: the LED is on exactly when it is dark. */
		bool dark = light_adc >= LIGHT_ADC_THRESHOLD;
		if (dark != lighting) {
			if (dark) onLED();
			else offLED();
			lighting = dark;
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
	static TMessage msg;
	for (;;) {
		snprintf(msg.message, MAX_MSG_LEN,
				"SOIL:%u,WATER:%d,LED:%d",
				moisture, reservoir_level_ok, lighting);
		UART2_Send(&msg);
		vTaskDelay(pdMS_TO_TICKS(SEND_INTERVAL_MS));
	}
}

static void pumpTask(void *p)
{
	for (;;) {
		while (xSemaphoreTake(pump_sema, portMAX_DELAY) != pdTRUE) {}
		if (moisture <= SOIL_MOISTURE_ADC_THRESHOLD) continue;

		unsigned int duration_ms = 3000U;
		if (temperature >= 30.0f || humidity <= 45.0f)
			duration_ms += 1000U;

		onPump();
		vTaskDelay(pdMS_TO_TICKS(duration_ms));
		offPump();

		vTaskDelay(pdMS_TO_TICKS(PUMP_COOLDOWN_MS));
	}
}

static void soil_moisture_sensor_task(void *p)
{
	for (;;) {
		moisture = poll_soil_adc();

		if (moisture > SOIL_MOISTURE_ADC_THRESHOLD)
			xSemaphoreGive(pump_sema);

		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Soil moisture ADC: %u\r\n", moisture); // Raw 0..4095
			xSemaphoreGive(print_mutex);
		}
		vTaskDelay(pdMS_TO_TICKS(SOIL_MOISTURE_SAMPLING_PERIOD));
	}
}

/* The buzzer sounds while the reservoir is low. */
static void updateBuzzer(void)
{
	if (reservoir_level_ok) offBuzzer();
	else onBuzzer();
}

static void water_level_sensor_task(void *p)
{
	updateBuzzer();
	for (;;) {
		while (xSemaphoreTake(reservoir_level_sema, portMAX_DELAY) != pdTRUE) {}
		updateBuzzer();

		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Reservoir level: %d\r\n", reservoir_level_ok);
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

	pump_sema = xSemaphoreCreateBinary(); // semaphore is initialized to 0
	reservoir_level_sema = xSemaphoreCreateBinary(); // given from ISR
	uart_sema = xSemaphoreCreateBinary(); // given from ISR, signals transmitter is free

	xSemaphoreGive(uart_sema); // Initialize it to 1 so that the transmission can start

	print_mutex = xSemaphoreCreateMutex(); // mutex is initialized to 1

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
