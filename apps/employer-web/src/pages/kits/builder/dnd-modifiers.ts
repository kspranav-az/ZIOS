import type { Modifier } from '@dnd-kit/core';

/** Constrain dragging to the vertical axis (question list is 1-D). */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});
