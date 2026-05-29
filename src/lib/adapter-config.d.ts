// This file extends the AdapterConfig type from "@types/iobroker"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

import '@iobroker/types';
import { native } from '../../io-package.json';

interface UpsListItem {
    upsIp: string;
    upsPort: number;
}

type _AdapterConfig = Omit<typeof native, 'upsList'> & {
    upsList: UpsListItem[];
};

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
