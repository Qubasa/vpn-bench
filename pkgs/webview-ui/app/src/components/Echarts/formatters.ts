/**
 * Smart Y-axis label formatter that limits decimal places based on value magnitude.
 *
 * - value == 0      → "0"
 * - |value| >= 100  → 0 decimal places  (e.g. "1234")
 * - |value| >= 1    → 1 decimal place   (e.g. "12.3")
 * - |value| >= 0.1  → 2 decimal places  (e.g. "0.45")
 * - |value| < 0.1   → 3 decimal places  (e.g. "0.003")
 */
export const formatAxisValue = (value: number): string => {
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(1);
  if (abs >= 0.1) return value.toFixed(2);
  return value.toFixed(3);
};
