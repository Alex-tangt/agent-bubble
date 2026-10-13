import type { Segment } from './types.js';

function seconds(value: string): number {
  return value.replace(',', '.').trim().split(':').map(Number).reduce((sum, current) => sum * 60 + current, 0);
}
export function validSegments(value: unknown): Segment[] {
  if (!Array.isArray(value)) return [];
  let previous = -1;
  const result: Segment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const {start,end,text} = item as Partial<Segment>;
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || end <= start || start < previous || typeof text !== 'string' || !text.trim()) continue;
    const clean=text.replace(/<[^>]*>/g,'').trim();
    if(clean){result.push({start,end,text:clean});previous=start;}
  }
  return result;
}
export function parseCaptions(value: string): Segment[] {
  try {
    const json = JSON.parse(value);
    if (Array.isArray(json?.body)) return validSegments(json.body.map((part: {from:number;to:number;content:string}) => ({start:part.from,end:part.to,text:part.content})));
  } catch { /* SRT/VTT follow. */ }
  const segments: Segment[] = [];
  for (const block of value.replace(/\r/g,'').split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing < 0) continue;
    const match = lines[timing]!.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (match) segments.push({start:seconds(match[1]!),end:seconds(match[2]!),text:lines.slice(timing + 1).join(' ')});
  }
  return validSegments(segments);
}
export function timestamp(value: number): string {
  const time = Math.max(0,Math.floor(value));
  return time >= 3600 ? `${Math.floor(time/3600)}:${String(Math.floor(time%3600/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}`
    : `${Math.floor(time/60)}:${String(time%60).padStart(2,'0')}`;
}
export function transcriptText(segments: Segment[]): string {
  return segments.map(part => `[${timestamp(part.start)}] ${part.text}`).join('\n');
}
