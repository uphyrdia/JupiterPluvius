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
#include "led.h"
#include "adc.h"
#include "comparator.h"
#include "pwm.h"
#include "uart.h"

#define QLEN	5

QueueHandle_t queue;
SemaphoreHandle_t led_sema;
SemaphoreHandle_t water_level_sema;
SemaphoreHandle_t servo_sema;
SemaphoreHandle_t adc_mutex;
SemaphoreHandle_t print_mutex;

static volatile int led_on = 0;
static volatile uint16_t servo_ticks = 47;

static void ledTask(void *p)
{
	for (;;) {
		while (xSemaphoreTake(led_sema, portMAX_DELAY) != pdTRUE) {}
		if (led_on) {
			GPIOE->PCOR = (1UL << RED_PIN);
			GPIOD->PCOR = (1UL << GREEN_PIN);
			GPIOE->PCOR = (1UL << BLUE_PIN);
		} else {
			GPIOE->PSOR = (1UL << RED_PIN);
			GPIOD->PSOR = (1UL << GREEN_PIN);
			GPIOE->PSOR = (1UL << BLUE_PIN);
		}
	}
}

static void servoTask(void *p)
{
	for (;;) {
		while (xSemaphoreTake(servo_sema, portMAX_DELAY) != pdTRUE) {}
		setServoPulse(servo_ticks);
	}
}

static void recvTask(void *p)
{
	for (;;) {
		TMessage msg;
		if (xQueueReceive(queue, (void *)&msg, portMAX_DELAY) != pdTRUE)
			continue;
		if (xSemaphoreTake(print_mutex, portMAX_DELAY) == pdTRUE) {
			PRINTF("Received message: %s\r\n", msg.message);
			xSemaphoreGive(print_mutex);
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

		while (xSemaphoreTake(print_mutex, portMAX_DELAY) != pdTRUE) {}
		PRINTF("Soil moisture ADC: %u\r\n", moisture); // Raw 0..4095
		xSemaphoreGive(print_mutex);
		vTaskDelay(pdMS_TO_TICKS(500));
	}
}

static void water_level_task(void *p)
{
	for (;;) {
		while (xSemaphoreTake(water_level_sema, portMAX_DELAY) != pdTRUE) {}
		while (xSemaphoreTake(print_mutex, portMAX_DELAY) != pdTRUE) {}
		PRINTF("Light: %d\r\n", above_threshold);
		xSemaphoreGive(print_mutex);
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

	servo_sema = xSemaphoreCreateBinary();
	led_sema = xSemaphoreCreateBinary();
	water_level_sema = xSemaphoreCreateBinary(); // Comparator state changed

	adc_mutex = xSemaphoreCreateMutex(); // One ADC conversion at a time
	print_mutex = xSemaphoreCreateMutex(); // Protect distance and serialize task PRINTF calls

	initLED();
	ComparatorInterrupt_Init();
	initADC();
	initUART2();
//	setTPMClock();
//	initPWM();
	PRINTF("CG2271 Project\r\n");

	xTaskCreate(recvTask, "recvTask", configMINIMAL_STACK_SIZE+100, NULL, 2, NULL);
	xTaskCreate(soil_moisture_sensor_task, "soil", configMINIMAL_STACK_SIZE+100, NULL, 1, NULL);
	xTaskCreate(water_level_task, "water", configMINIMAL_STACK_SIZE+100, NULL, 2, NULL);

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
