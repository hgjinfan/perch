import { arrangeTileGrids } from './tile-layout.js';

if (globalThis.ResizeObserver) arrangeTileGrids(document.querySelectorAll('#board .content-board'));
