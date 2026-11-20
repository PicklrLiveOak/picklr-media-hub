// Small single-series line chart (brand blue) with a hover/tap tooltip.
// Hand-made SVG so there's no chart library to load on phones.
import { useState } from 'react';

type Point = { x: string; y: number };

export default function LineChart({ data, height = 150, label }: { data: Point[]; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <p className="text-sm text-stone-500 py-6 text-center">Needs a couple of days of data — check back after the next nightly sync.</p>;

  const W = 340, H = height, padL = 46, padR = 8, padT = 10, padB = 20;
  const ys = data.map((d) => d.y);
  let min = Math.min(...ys), max = Math.max(...ys);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  min = Math.max(0, Math.floor(min - span * 0.15)); max = Math.ceil(max + span * 0.15);
  const x = (i: number) => padL + (i / (data.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.y).toFixed(1)}`).join(' ');
  const ticks = [min, Math.round((min + max) / 2), max];
  const fmtDay = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={label}
        onMouseLeave={() => setHover(null)}>
        {/* recessive grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#E4DCCB" strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="11.5" fill="#78716c">{t.toLocaleString()}</text>
          </g>
        ))}
        <text x={padL} y={H - 4} fontSize="11.5" fill="#78716c">{fmtDay(data[0].x)}</text>
        <text x={W - padR} y={H - 4} fontSize="11.5" fill="#78716c" textAnchor="end">{fmtDay(data.at(-1)!.x)}</text>
        <path d={path} fill="none" stroke="#0075E7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#a8a29e" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(data[hover].y)} r="5" fill="#0075E7" stroke="white" strokeWidth="2" />
          </>
        )}
        {/* invisible hit areas, wider than the line */}
        {data.map((_, i) => (
          <rect key={i} x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
        ))}
      </svg>
      {hover != null && (
        <div className="absolute top-0 pointer-events-none rounded-md bg-ink text-cream text-xs px-2 py-1"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > data.length / 2 ? '-105%' : '5%'})` }}>
          {fmtDay(data[hover].x)}: <b>{data[hover].y.toLocaleString()}</b>
        </div>
      )}
    </div>
  );
}
