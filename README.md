# Smart Greenhouse RTOS Project

A CG2271 project that waters a potted plant on its own, switches on a grow light when it's dark, and warns when its
water reservoir runs low. The readings go to a live web dashboard.

**Dashboard:** https://jupiterpluvius.onrender.com/

```
MCXC444 (FreeRTOS) <--UART 9600--> ESP32-S2 --HTTPS--> Supabase <-- FastAPI + React dashboard (Render)
 soil, reservoir,                   DHT11, LDR,                                      |
 pump, buzzer, LED                  Wi-Fi                                            +--> DeepSeek (AI check-up)
```

## How it works

| Board | Reads | Does |
|---|---|---|
| **MCXC444** | Soil moisture (ADC0, PTB2), reservoir level (CMP0 on PTC6 against a 1.65 V DAC) | Runs the pump (PTE30), buzzer (PTA13) and grow LED (PTA5) |
| **ESP32-S2** | Temperature and humidity (DHT11, GPIO7), light (LDR, GPIO8) | Relays readings between the MCU and Supabase every 5 s |

- **Watering:** when the soil ADC reads above 1200 (dry), the pump runs for 3 s, or 4 s if it's ≥ 30 °C or ≤ 45 %
  humidity, then waits 30 s before it can water again.
- **Reservoir:** the buzzer sounds while the water level is below the comparator's threshold.
- **Grow LED:** on while the light ADC reads 1000 or more (dark).
- **UART protocol:** `@DATA|payload*HHHH\n` frames with a CRC-16/CCITT-FALSE checksum (UART2 on PTE22/PTE23 ↔ ESP32
  GPIO16/17).
  - ESP32 → MCU, every 5 s: `TEMP:22.5,HUM:53.1,LIGHT_ADC:500`
  - MCU → ESP32, every 1 s: `SOIL:2048,WATER:1,LED:1`
- **Dashboard:** live readings, trends, a states log and an AI check-up that summarises the readings and gives advice.

## Repository

| Folder | Contents |
|---|---|
| `MCXC444/` | MCUXpresso project: FreeRTOS tasks in `source/main.c`, drivers in `source/` |
| `ESP32/CG2271_Final_Project_ESP32/` | Arduino sketch (ESP32 core 3.x; libraries DHTesp and Arduino_JSON) |
| `dashboard/` | Backend, frontend and Supabase SQL; setup and deployment in [dashboard/README.md](dashboard/README.md) |
| `cloud_dashboard/` | Old dashboard, archived for fallback |

## Notes

- Supabase publishable key: `sb_publishable_sJjt6SXXxUpcYvcTUe7UCA_fNBiWSQ9`
- Sensor reference: https://45-in-1-sensor-kit.readthedocs.io/en/latest/
- Chlorophyll absorbs light best in the blue (400–500 nm) and red (600–700 nm) ranges.
