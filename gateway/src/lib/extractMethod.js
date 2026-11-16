import { t } from './i18n.js';

/** How an attachment's text was obtained (attachment_extracts.method), for prompts and exports. */
export const extractMethodLabel = (method, language) => t(language, `aiContext.extractMethod.${method === 'llm' ? 'llm' : method === 'ocr' ? 'ocr' : 'pdf'}`);
