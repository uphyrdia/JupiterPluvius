#ifndef COMPARATOR_H_
#define COMPARATOR_H_

#include <stdbool.h>
#include <stdint.h>

#define WATER_LEVEL_PIN		6	// PTC6

extern volatile int above_threshold;
extern volatile uint32_t comparatorRiseCount;

void Comparator_Init(void);
bool Comparator_IsAboveThreshold(void);
void ComparatorInterrupt_Init(void);

#endif /* COMPARATOR_H_ */
