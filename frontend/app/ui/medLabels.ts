import { useTranslations } from 'use-intl';
import { modalityCode, routeCode } from '../../../shared/medCodes.js';

const RESPONSE_CODES = ['baseline', 'CR', 'PR', 'SD', 'PD', 'NA'] as const;
type ResponseCode = (typeof RESPONSE_CODES)[number];
const isResponse = (r: string): r is ResponseCode => (RESPONSE_CODES as readonly string[]).includes(r);

/**
 * Labels for values the gateway stores as words or codes (shared/medCodes.js): an imaging modality, an infusion route, a
 * response. A stored value we do not know was typed by a person or came from a report and is shown as it is.
 */
export function useMedLabels() {
  const imaging = useTranslations('imaging');
  const infusions = useTranslations('infusions');
  return {
    modality: (value: string) => { const c = modalityCode(value); return c ? imaging(`modality.${c}`) : value; },
    route: (value: string) => { const c = routeCode(value); return c ? infusions(`route.${c}`) : value; },
    response: (code: string) => (isResponse(code) ? imaging(`responseLabel.${code}`) : code),
  };
}
