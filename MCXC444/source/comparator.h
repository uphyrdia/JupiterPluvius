/*
 * comparator.h
 *
 * Analog comparator (CMP0) for the light sensor on PTC6 (J1 pin 9).
 */

#ifndef COMPARATOR_H_
#define COMPARATOR_H_

#include <stdbool.h>
#include <stdint.h>

/* Current comparator state: 1 when the light input is above the DAC threshold. */
extern volatile int above_threshold;

/* Number of rising edges seen by the comparator interrupt. */
extern volatile uint32_t comparatorRiseCount;

/* Call after your normal board initialization. */
void Comparator_Init(void);

/* Read after allowing the comparator/DAC to settle. */
bool Comparator_IsAboveThreshold(void);

/* Comparator_Init() plus interrupt setup; call once before starting the scheduler. */
void ComparatorInterrupt_Init(void);

#endif /* COMPARATOR_H_ */
