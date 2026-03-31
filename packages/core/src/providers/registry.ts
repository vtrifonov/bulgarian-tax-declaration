import { bondoraProvider } from './bondora.js';
import { etradeProvider } from './etrade.js';
import { ibProvider } from './ib.js';
import { revolutProvider } from './revolut.js';
import { trading212Provider } from './trading212.js';
import type { BrokerProvider } from './types.js';

export const providers: BrokerProvider[] = [ibProvider, revolutProvider, trading212Provider, etradeProvider, bondoraProvider];
