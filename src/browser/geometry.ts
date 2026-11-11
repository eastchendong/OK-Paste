export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type SelectionRegion =
  | {kind: 'drag'; rect: Box}
  | {kind: 'circle'; circle: {cx: number; cy: number; r: number}; polygon?: Point[]};

export function classifyGesture(points: Point[], shiftKey: boolean): SelectionRegion | null {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return null;
  const endDistance = distance(start, end);
  if (shiftKey) {
    if (endDistance < 4) return null;
    return {kind: 'circle', circle: {cx: start.x, cy: start.y, r: endDistance}};
  }
  const length = pathLength(points);
  if (endDistance <= 24 && length >= 80 && points.length >= 8) {
    return {kind: 'circle', circle: boundingCircle(points), polygon: points.slice()};
  }
  if (endDistance < 4) return null;
  return {kind: 'drag', rect: rectBetween(start, end)};
}

export function regionHits(region: SelectionRegion, box: Box): boolean {
  if (box.width <= 0 || box.height <= 0) return false;
  if (region.kind === 'drag') return intersects(region.rect, box);
  if (region.polygon && region.polygon.length >= 3) return pointInPolygon(centerOf(box), region.polygon);
  return distance(centerOf(box), {x: region.circle.cx, y: region.circle.cy}) <= region.circle.r;
}

function rectBetween(a: Point, b: Point): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)};
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function centerOf(box: Box): Point {
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(points: Point[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous && current) length += distance(previous, current);
  }
  return length;
}

function boundingCircle(points: Point[]) {
  const first = points[0] ?? {x: 0, y: 0};
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const r = Math.max(...points.map(point => distance(point, {x: cx, y: cy})), 1);
  return {cx, cy, r};
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const before = polygon[previous];
    if (!current || !before) continue;
    const crosses = (current.y > point.y) !== (before.y > point.y)
      && point.x < ((before.x - current.x) * (point.y - current.y)) / (before.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
