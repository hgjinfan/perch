// Stable domain API used by routes and config validation.
import { widgetDefinitions } from '../shared/widget-types.js';
export const widgetTypes = Object.keys(widgetDefinitions);
export { validateWidget } from './widgets/schema.js';
export { getPath, mapWidget } from '../shared/widget-types.js';
export { loadWidget } from './widgets/source.js';
