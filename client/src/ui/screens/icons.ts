// Original line icons (24×24, drawn for this game) used by the title flow
// and the character creator. They use currentColor, so CSS colours them.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  appearance: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none"/>`),
  face: svg(`<path d="M12 3.5c4.7 0 7.5 3.6 7.5 8 0 4.9-3.4 9-7.5 9s-7.5-4.1-7.5-9c0-4.4 2.8-8 7.5-8z"/><path d="M9 11.2v.6M15 11.2v.6"/><path d="M9.6 15.4c1.4 1.1 3.4 1.1 4.8 0"/>`),
  hair: svg(`<path d="M5 13c-.6-5.4 2.6-9.5 7-9.5s7.6 4.1 7 9.5"/><path d="M5 13c1.8-.3 3.6-1.6 4.6-3.6 1.6 1.7 5 3.2 9.4 3.6"/><path d="M6.5 13.5c.6 4 2.9 6.5 5.5 6.5s4.9-2.5 5.5-6.5"/>`),
  body: svg(`<circle cx="12" cy="4.8" r="2.3"/><path d="M7 9.5h10M12 9.5v6M12 15.5l-3 5M12 15.5l3 5M7 9.5l-1.5 5M17 9.5l1.5 5"/>`),
  clothing: svg(`<path d="M8.5 3.5 4 6l1.8 4 2.2-1v11.5h8V9l2.2 1L20 6l-4.5-2.5c-.5 1.6-1.9 2.6-3.5 2.6s-3-1-3.5-2.6z"/>`),
  accessories: svg(`<circle cx="7" cy="14" r="3.5"/><circle cx="17" cy="14" r="3.5"/><path d="M10.5 14c.9-.8 2.1-.8 3 0M3.5 14 2.6 9.5M20.5 14l.9-4.5"/>`),
  turnLeft: svg(`<path d="M4.5 9.5A8 8 0 1 1 6 16.8"/><path d="M4 4.5v5h5"/>`),
  turnRight: svg(`<path d="M19.5 9.5A8 8 0 1 0 18 16.8"/><path d="M20 4.5v5h-5"/>`),
  zoomIn: svg(`<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20.5 20.5M10.5 7.5v6M7.5 10.5h6"/>`),
  zoomOut: svg(`<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20.5 20.5M7.5 10.5h6"/>`),
  undo: svg(`<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12"/>`),
  redo: svg(`<path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 0 0 0 10H12"/>`),
  dice: svg(`<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r=".6" fill="currentColor"/><circle cx="15" cy="15" r=".6" fill="currentColor"/><circle cx="15" cy="9" r=".6" fill="currentColor"/><circle cx="9" cy="15" r=".6" fill="currentColor"/>`),
  reset: svg(`<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>`),
  back: svg(`<path d="M14.5 5.5 8 12l6.5 6.5"/>`),
  close: svg(`<path d="M6 6l12 12M18 6 6 18"/>`),
  compare: svg(`<path d="M12 3.5v17"/><path d="M4 7.5h5v9H4zM15 7.5h5v9h-5z"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),
  check: svg(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`),
} as const;

/** An eight-pointed star, the motif of the starry fresco ceilings the title screen is inspired by. */
export function starPath(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.42;
    points.push(`${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return `M${points.join("L")}Z`;
}
