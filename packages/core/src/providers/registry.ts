import { etradeProvider } from './etrade.js';
import { ibProvider } from './ib.js';
import { revolutProvider } from './revolut.js';
import type { BrokerProvider } from './types.js';

export const providers: BrokerProvider[] = [ibProvider, revolutProvider, etradeProvider];
