import { initials } from "@/nlp/photo-match";

const HUES = [250, 200, 160, 30, 330, 280, 190, 45];
const hue = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

/** A verified portrait when we have one, otherwise a coloured initials badge. Never a guessed face. */
export function Avatar({ name, src, size = 44, credit }: { name: string; src?: string | null; size?: number; credit?: string | null }) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={name} title={credit ? `Photo: ${credit}` : name} width={size} height={size} loading="lazy" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover ring-1 ring-line" style={{ width: size, height: size }} />
    );
  const h = hue(name);
  return (
    <span aria-label={name} className="grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-line" style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${h} 60% 45%), hsl(${(h + 40) % 360} 65% 35%))` }}>
      {initials(name)}
    </span>
  );
}

/** Official YouTube thumbnail for a video id (served by YouTube for exactly this use). */
export function Thumb({ videoId, alt, className = "" }: { videoId: string | null; alt: string; className?: string }) {
  if (!videoId) return <span className={`grid place-items-center rounded-lg bg-panel2 text-xs text-muted ${className}`}>no video</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={`rounded-lg object-cover ${className}`} />
  );
}
