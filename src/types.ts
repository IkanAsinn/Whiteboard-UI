export type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'laser'
  | 'text'
  | 'sticky'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow';

/** [x, y] or [x, y, pressure] in world coordinates. */
export type StrokePoint = number[];

interface BaseElement {
  id: string;
  color: string;
}

/** Whole-box text formatting (text elements and sticky notes). */
export interface TextFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface StrokeElement extends BaseElement {
  type: 'stroke';
  points: StrokePoint[];
  size: number;
  highlighter: boolean;
  /** True when points carry real pen pressure. */
  pressure: boolean;
}

export interface ShapeElement extends BaseElement {
  type: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  strokeWidth: number;
  fill: boolean;
}

/** Closed polygon (triangles, diamonds, rotated shapes from shape recognition). */
export interface PolygonElement extends BaseElement {
  type: 'polygon';
  points: number[][];
  strokeWidth: number;
  fill: boolean;
}

export interface LineElement extends BaseElement {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
}

export interface TextElement extends BaseElement, TextFormat {
  type: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  /** Default 'left'. Centered text keeps its center fixed while being edited. */
  align?: 'left' | 'center';
  /** Label attached to another element (e.g. an icon's name): follows it when that element moves. */
  attachedTo?: string;
}

export interface StickyElement extends BaseElement, TextFormat {
  type: 'sticky';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
}

export type BoardElement =
  | StrokeElement
  | ShapeElement
  | PolygonElement
  | LineElement
  | TextElement
  | StickyElement
  | ImageElement;

export type BoxElement = ShapeElement | TextElement | StickyElement | ImageElement;

export interface Camera {
  /** World coordinate at the screen's left/top edge. */
  x: number;
  y: number;
  /** Zoom factor (screen px per world unit). */
  z: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface BoardFile {
  app: 'whiteboard';
  version: 1;
  elements: BoardElement[];
  camera?: Camera;
}
