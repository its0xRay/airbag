/** Geometry only: scrolling changes the illustration, never the reading text. */
export function walkthroughStep(tops: number[], viewportHeight: number): number {
  const readingLine = viewportHeight * 0.42;
  let active = 0;
  tops.forEach((top, index) => { if (top <= readingLine) active = index; });
  return active;
}
