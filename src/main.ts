'use strict';

import * as utils from '@iobroker/adapter-core';
import ApcAccess from './lib/apcaccess';
import Normalizer from './lib/normalizer';
import statesDefinition from './lib/states-definition.json';

const MinPollInterval = 1000;
const MaxPollInterval = 60000;
const CheckAvailabilityTimeout = 1000;
const CommunicationLost = 'commlost';

interface UpsListItem {
    upsIp: string;
    upsPort: number;
}

interface StateInfo {
    id: string;
    upsId: string;
    name: string;
    type: ioBroker.CommonType;
    role: string;
    unit?: string;
}

interface AdapterStatesDefinition {
    defaultState: Omit<StateInfo, 'id' | 'upsId'>;
    states: StateInfo[];
}

class ApcUpsAdapter extends utils.Adapter {
    private timeoutId: ioBroker.Timeout | undefined;
    private availabilityTimeout: ioBroker.Timeout | undefined;
    private readonly apcAccess = new ApcAccess();
    private readonly normalizer = new Normalizer();
    private initialized: Record<string, boolean> = {};
    private ipAddressStates: string[] = [];
    private readonly adapterStates: AdapterStatesDefinition = statesDefinition as unknown as AdapterStatesDefinition;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'apcups',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        if (!this.config.upsList || this.config.upsList.length === 0 || !this.validateIPList(this.config.upsList)) {
            this.log.error(`Invalid UPS list: ${JSON.stringify(this.config.upsList)}`);
            this.terminate('Invalid UPS list configuration', 11);
            return;
        }

        if (this.config.pollingInterval < MinPollInterval || isNaN(this.config.pollingInterval) || this.config.pollingInterval > MaxPollInterval) {
            this.log.error(`Invalid poll interval: ${this.config.pollingInterval}`);
            this.terminate('Invalid polling interval configuration', 11);
            return;
        }

        const upsListStr = this.config.upsList.map((item: UpsListItem) => `${item.upsIp}:${item.upsPort}`).join(', ');

        this.log.info(`Ups list:  ${upsListStr}`);
        this.log.info(`Polling interval: ${this.config.pollingInterval} ms`);

        this.initializeApcAccess();

        await this.startPooling();
        this.checkAvailability();
        void this.cleanOutdatedStates();
    }

    private async cleanOutdatedStates(): Promise<void> {
        const allObjects = await this.getAdapterObjectsAsync();
        const outdatedObjects = Object.keys(allObjects)
            .map(key => ({ id: key, value: allObjects[key] }))
            .filter(item => item.id.split('.').length === 3 && item.value.type === 'state')
            .map(item => item.id);
        if (outdatedObjects && outdatedObjects.length > 0) {
            outdatedObjects.push('info.UPSHost');
            outdatedObjects.push('info.UPSPort');

            this.log.info(`Deleting ${outdatedObjects.length} outdated states`);

            for (const object of outdatedObjects) {
                this.log.info(`Deleting object: ${object}`);
                await this.delObjectAsync(object);
            }
        }
    }

    private checkAvailability(): void {
        this.availabilityTimeout = this.setTimeout(async () => {
            try {
                await this.checkAvailabilityTask();
            } catch (error) {
                this.log.error(`Error in checkAvailability: ${error}`);
            }
            this.clearTimeout(this.availabilityTimeout);
            this.checkAvailability();
        }, CheckAvailabilityTimeout);
    }

    private async checkAvailabilityTask(): Promise<void> {
        if (this.ipAddressStates.length === 0) {
            const allStates = await this.getAdapterObjectsAsync();
            this.ipAddressStates = Object.keys(allStates).filter(state => state.endsWith('.info.ipAddress'));
        }
        if (this.ipAddressStates.length > 0) {
            let unavailableUps = 0;
            for (const ipAddress of this.ipAddressStates) {
                const upsId = ipAddress.split('.')[2];
                const ipState = await this.getStateAsync(ipAddress);
                const lastUpdate = ipState ? ipState.ts : 0;
                if (new Date().getTime() - lastUpdate > this.config.pollingInterval * 2) {
                    const aliveStateName = `${upsId}.info.alive`;
                    const aliveStateObj = await this.getStateAsync(aliveStateName);
                    if (aliveStateObj && aliveStateObj.val) {
                        this.log.warn(`UPS '${upsId}' is not available`);
                    }
                    void this.setState(aliveStateName, false, true);
                    unavailableUps++;
                }
            }
            if (unavailableUps > 0) {
                void this.setState('info.connection', false, true);
            } else {
                void this.setState('info.connection', true, true);
            }
        }
    }

    private validateIPList(ipList: UpsListItem[]): boolean {
        try {
            const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            for (const networkItem of ipList) {
                if (!ipPattern.test(networkItem.upsIp)) {
                    return false;
                }
            }
            return true;
        } catch (error) {
            this.log.error(`Error in validateIPList: ${error}`);
            return false;
        }
    }

    private initializeApcAccess(): void {
        this.apcAccess.on('error', (error: unknown) => {
            this.log.debug(`Error from apcupsd: ${String(error)}`);
        });
        this.apcAccess.on('connect', () => {
            this.log.debug(`Connected to apcupsd '${this.apcAccess.lastHost}:${this.apcAccess.lastPort}' successfully`);
        });
        this.apcAccess.on('disconnect', () => {
            this.log.debug(`Disconnected from apcupsd '${this.apcAccess.lastHost}:${this.apcAccess.lastPort}'`);
        });
    }

    private async startPooling(isFirstRun = true): Promise<void> {
        if (isFirstRun) {
            try {
                await this.processTask();
            } catch (error) {
                this.log.error(`Error in startPooling: ${error}`);
            }
        }
        this.timeoutId = this.setTimeout(async () => {
            try {
                await this.processTask();
            } catch (error) {
                this.log.error(`Error in startPooling: ${error}`);
            }
            this.clearTimeout(this.timeoutId);
            void this.startPooling(false);
        }, this.config.pollingInterval);
    }

    private async processTask(): Promise<void> {
        for (const ups of this.config.upsList) {
            this.log.debug(`Processing UPS: ${ups.upsIp}:${ups.upsPort}`);
            await this.processUps(ups);
        }
    }

    private async processUps(ups: UpsListItem): Promise<void> {
        try {
            await this.apcAccess.connect(ups.upsIp, ups.upsPort);
            if (this.apcAccess.isConnected === true) {
                const result = await this.apcAccess.getStatusJson();
                await this.apcAccess.disconnect();
                this.log.debug(`UPS result: ${JSON.stringify(result)}`);
                const normalized = this.normalizer.normalizeUpsResult(result);
                const upsId = normalized.SERIALNO as string | undefined;
                let status = normalized.STATUS as string | undefined;
                if (status) {
                    status = status.toLowerCase().trim();
                }
                if (upsId === undefined || status === CommunicationLost) {
                    return;
                }
                this.log.debug(`UPS Id: '${upsId}'`);
                this.log.debug(`UPS state: '${JSON.stringify(normalized)}'`);
                if (!this.initialized[upsId]) {
                    await this.createUpsObjects(upsId);
                }
                await this.setUpsStates(upsId, ups.upsIp, ups.upsPort, normalized);
            }
        } catch (error) {
            this.log.error(`Failed to process apcupsd result: ${error} for UPS: ${ups.upsIp}:${ups.upsPort}`);
            this.sendError(error, `Failed to process UPS ${ups.upsIp}:${ups.upsPort}`);
        }
    }

    private sendError(error: unknown, message?: string): void {
        if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
            const sentryInstance = this.getPluginInstance('sentry') as { getSentryObject?(): unknown } | null;
            if (sentryInstance) {
                const Sentry = sentryInstance.getSentryObject?.() as { configureScope?: (fn: (scope: unknown) => void) => void; captureException?: (err: unknown) => void; Severity?: Record<string, unknown> } | undefined;
                if (Sentry) {
                    if (message) {
                        Sentry.configureScope?.((scope: unknown) => {
                            (scope as { addBreadcrumb(data: Record<string, unknown>): void }).addBreadcrumb({
                                type: 'error',
                                category: 'error message',
                                level: Sentry.Severity?.Error,
                                message: message,
                            });
                        });
                    }
                    if (typeof error === 'string') {
                        Sentry.captureException?.(new Error(error));
                    } else {
                        Sentry.captureException?.(error);
                    }
                }
            }
        }
    }

    private async setUpsStates(upsId: string, ipAddress: string, ipPort: number, state: Record<string, string | number>): Promise<void> {
        const aliveState = await this.getStateAsync(`${upsId}.info.alive`);

        if (aliveState && aliveState.val === false) {
            this.log.warn(`UPS '${upsId}' is available again`);
        }

        await this.setStateAsync(`${upsId}.info.alive`, { val: true, ack: true });
        await this.setStateAsync(`${upsId}.info.ipAddress`, { val: ipAddress, ack: true });
        await this.setStateAsync(`${upsId}.info.ipPort`, { val: ipPort, ack: true });

        const fields = Object.keys(state);
        for (const field of fields) {
            const value = state[field];
            try {
                const upsState = this.adapterStates.states.find(e => e.upsId == field);
                if (upsState) {
                    const upsStateId = `${upsId}.${upsState.id}`;
                    const instanceState = await this.getObjectAsync(upsStateId);
                    if (instanceState != null) {
                        await this.setStateAsync(upsStateId, { val: value, ack: true });
                    } else {
                        const newState: StateInfo = { ...this.adapterStates.defaultState, upsId: upsState.upsId, id: upsState.id };
                        await this.createAdapterState(upsId, newState);
                        await this.setStateAsync(upsStateId, { val: value, ack: true });
                    }
                } else {
                    const newState: StateInfo = { ...this.adapterStates.defaultState, upsId: field, id: field.toLowerCase() };
                    await this.createAdapterState(upsId, newState);
                    await this.setStateAsync(`${upsId}.${field.toLowerCase()}`, { val: value, ack: true });
                }
            } catch (error) {
                this.log.error(`Can't update UPS state ${field}:${value} because of ${error}`);
            }
        }
    }

    private async createUpsObjects(upsId: string): Promise<void> {
        await this.setObjectNotExistsAsync(upsId, {
            type: 'device',
            common: {
                name: upsId,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync(`${upsId}.info`, {
            type: 'channel',
            common: {
                name: 'Information',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync(`${upsId}.info.alive`, {
            type: 'state',
            common: {
                name: 'Is alive',
                type: 'boolean',
                read: true,
                write: false,
                role: 'indicator.state',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync(`${upsId}.info.ipAddress`, {
            type: 'state',
            common: {
                name: 'UPS IP Address',
                type: 'string',
                read: true,
                write: false,
                role: 'state',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync(`${upsId}.info.ipPort`, {
            type: 'state',
            common: {
                name: 'UPS IP Port',
                type: 'number',
                read: true,
                write: false,
                role: 'state',
            },
            native: {},
        });

        for (const stateInfo of this.adapterStates.states) {
            await this.createAdapterState(upsId, stateInfo);
        }
        this.initialized[upsId] = true;
    }

    private async createAdapterState(upsId: string, stateInfo: StateInfo): Promise<void> {
        const common: ioBroker.StateCommon = {
            name: stateInfo.name,
            type: stateInfo.type,
            role: stateInfo.role,
            read: true,
            write: false,
        };
        if (stateInfo.unit != null) {
            common.unit = stateInfo.unit;
        }
        const stateId = `${upsId}.${stateInfo.id}`;
        await this.setObjectNotExistsAsync(stateId, {
            type: 'state',
            common: common,
            native: {},
        });
    }

    private async onUnload(callback: () => void): Promise<void> {
        try {
            this.clearTimeout(this.timeoutId);
            this.clearTimeout(this.availabilityTimeout);
            this.setAliveStatesToFalse();
            if (this.apcAccess != null && this.apcAccess.isConnected === true) {
                await this.apcAccess.disconnect();
                this.log.info('ApcAccess client is disconnected');
            }
            callback();
        } catch (error) {
            this.log.error(String(error));
            callback();
        }
    }

    private setAliveStatesToFalse(): void {
        try {
            if (this.ipAddressStates.length > 0) {
                for (const ipAddress of this.ipAddressStates) {
                    const upsId = ipAddress.split('.')[2];
                    const aliveStateName = `${upsId}.info.alive`;
                    void this.setState(aliveStateName, false, true);
                }
            }
            void this.setState('info.connection', false, true);
        } catch (error) {
            this.log.error(`Error in setAliveStatesToFalse: ${error}`);
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions>): ApcUpsAdapter => new ApcUpsAdapter(options);
} else {
    new ApcUpsAdapter();
}
