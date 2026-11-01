import { useTransform, type MotionValue } from "motion/react";
import { THEME_AT, THEME_STOPS, themeValues } from "../lib/theme";

/**
 * CSS variables (--ink, --rule, …) that follow the scroll position, so text and lines turn from
 * dark-on-paper to light-on-blue together with the background. Put the result in a `style` prop.
 */
export function useThemeVars(progress: MotionValue<number>) {
  return {
    "--bg": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.bg)),
    "--ink": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.ink)),
    "--ink-2": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.ink2)),
    "--ink-3": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.ink3)),
    "--rule": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.rule)),
    "--panel": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.panel)),
    "--accent": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.accent)),
    "--chip": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.chip)),
    "--chip-ink": useTransform(progress, THEME_AT, themeValues(THEME_STOPS.chipInk)),
  };
}
