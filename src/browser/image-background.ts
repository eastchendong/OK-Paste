import {installImageContextMenu, type ImageMenuChrome} from './image-context-menu';

installImageContextMenu((globalThis as unknown as {chrome: ImageMenuChrome}).chrome);
