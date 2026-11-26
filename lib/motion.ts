// The one ease-out curve used everywhere. Nothing bounces.
// GSAP "power3.out" matches the CSS --ease token: cubic-bezier(0.25, 1, 0.5, 1).
export const EASE = "power3.out";

export const DURATION = {
  enter: 0.7,
  enterStagger: 0.06,
  leave: 0.5,
  lens: 0.3,
  reduced: 0.15,
  arrival: 2.4,
} as const;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
