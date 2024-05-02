'use strict';
const ApcAccess = require('./lib/apcaccess');
const Normaliser = require('./lib/normalizer');


const utils = require('@iobroker/adapter-core');
const MinPollInterval = 1000;
const MaxPollInterval = 60000;
const CheckAvailabilityTimeout = 1000;
const CommunicationLost = 'commlost';

class ApcUpsAdapter extends utils.Adapter {

    /**
     * @type {ioBroker.Timeout | undefined}
     */
    timeoutId;
    /**
     * @type {ioBroker.Timeout | undefined}
     */
    availabilityTimeout;
    /**
     * @type {ApcAccess | undefined}
     */
    apcAccess;
    /**
     * @type {Normaliser | undefined}
     */
    normalizer;
    initialized = {};

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'apcups',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.log.info('Ups list: ' + JSON.stringify(this.config.upsList));
        this.log.info('Polling interval: ' + this.config.pollingInterval);

        if (!this.config.upsList || this.config.upsList.length === 0 || !this.validateIPList(this.config.upsList)) {
            this.log.error(`Invalid UPS list: ${JSON.stringify(this.config.upsList)}`);
            this.stop();
            return;
        }

        if (this.config.pollingInterval < MinPollInterval || isNaN(this.config.pollingInterval) || this.config.pollingInterval > MaxPollInterval) {
            this.log.error('Invalid poll interval: ' + this.config.pollingInterval);
            this.stop();
            return;
        }

        this.initializeApcAccess();

        await this.startPooling();
        this.checkAvailability();
        this.cleanOutdatedStates();
    }

    async cleanOutdatedStates() {
        const allObjects = await this.getAdapterObjectsAsync();
        const outdatedObjects = Object.keys(allObjects).map((key) => {
            const item = {
                id: key,
                value: allObjects[key]
            };
            return item;
        }
        )
            .filter((item) => item.id.split('.').length === 3 && item.value.type === 'state')
            .map((item) => item.id);
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

    checkAvailability() {
        this.availabilityTimeout = this.setTimeout(async () => {
            const allStates = await this.getAdapterObjectsAsync();
            const ipAddressStates = Object.keys(allStates)
                .filter(state => state.endsWith('.info.ipAddress'));
            if (ipAddressStates.length > 0) {
                let unavailableUps = 0;
                for (const ipAddress of ipAddressStates) {
                    const upsId = ipAddress.split('.')[2];
                    const lastUpdate = (await this.getStateAsync(ipAddress)).ts;
                    if (new Date().getTime() - lastUpdate > this.config.pollingInterval * 2) {
                        const aliveStateName = `${upsId}.info.alive`;
                        const aliveState = (await this.getStateAsync(aliveStateName)).val;
                        if (aliveState) {
                            this.log.warn(`UPS '${upsId}' is not available`);
                        }
                        this.setState(aliveStateName, false, true);
                        unavailableUps++;
                    }
                }
                if (unavailableUps > 0) {
                    this.setState('info.connection', false, true);
                } else {
                    this.setState('info.connection', true, true);
                }
            }
            this.clearTimeout(this.availabilityTimeout);
            this.checkAvailability();
        }, CheckAvailabilityTimeout);
    }

    /**
     * @param {string[]} ipList
     */
    validateIPList(ipList) {
        try {
            // Regular expression for IP address
            const ipPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

            // Validate each IP
            for (const networkItem of ipList) {
                if (!ipPattern.test(networkItem.upsIp)) {
                    return false;
                }
            }

            // If all IPs are valid
            return true;
        } catch (error) {
            this.log.error(`Error in validateIPList: ${error}`);
            return false;
        }
    }

    initializeApcAccess() {
        this.normalizer = new Normaliser();
        this.apcAccess = new ApcAccess();
        this.apcAccess.on('error', async (error) => {
            this.log.debug(`Error from apcupsd: ${error}`);
        });
        this.apcAccess.on('connect', () => {
            this.log.debug(`Connected to apcupsd '${this.config.upsip}:${this.config.upsport}' successfully`);
        });
        this.apcAccess.on('disconnect', async () => {
            this.log.debug(`Disconnected from apcupsd '${this.config.upsip}:${this.config.upsport}'`);
        });
    }

    async startPooling(isFirstRun = true) {
        if (isFirstRun) {
            await this.processTask(this.apcAccess);
        }
        this.timeoutId = this.setTimeout(async () => {
            await this.processTask(this.apcAccess);
            this.clearTimeout(this.timeoutId);
            this.startPooling(false);
        }, this.config.pollingInterval);
    }


    async processTask(client) {
        for (const ups of this.config.upsList) {
            this.log.debug(`Processing UPS: ${ups.upsIp}:${ups.upsPort}`);
            try {
                await this.processUps(client, ups);

            } catch { }// eslint-disable-line no-empty
        }
    }

    async processUps(client, ups) {
        try {
            await this.apcAccess.connect(ups.upsIp, ups.upsPort);
            if (client.isConnected === true) {
                let result = await client.getStatusJson();
                await this.apcAccess.disconnect();
                this.log.debug(result);
                result = this.normalizer.normalizeUpsResult(result);
                const upsId = result['SERIALNO'];
                let status = result['STATUS'];
                if (status) {
                    status = status.toLowerCase().trim();
                }
                if (upsId === undefined || status === CommunicationLost) {
                    return;
                }
                this.log.debug(`UPS Id: '${upsId}'`);
                this.log.debug(`UPS state: '${JSON.stringify(result)}'`);
                await this.createUpsObjects(upsId, ups.upsIp, ups.upsPort);
                await this.setUpsStates(upsId, ups.upsIp, result);
            }
        } catch (error) {
            this.log.error(`Failed to process apcupsd result: ${error} for UPS: ${ups.upsIp}:${ups.upsPort}`);
        }
    }

    sendError(error, message) {
        if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
            const sentryInstance = this.getPluginInstance('sentry');
            if (sentryInstance) {
                const Sentry = sentryInstance.getSentryObject();
                if (Sentry) {
                    if (message) {
                        Sentry.configureScope(scope => {
                            scope.addBreadcrumb({
                                type: 'error', // predefined types
                                category: 'error message',
                                level: Sentry.Severity.Error,
                                message: message
                            });
                        });
                    }
                    if (typeof error == 'string') {
                        Sentry.captureException(new Error(error));
                    } else {
                        Sentry.captureException(error);
                    }
                }
            }
        }
    }

    async setUpsStates(upsId, ipAddress, state) {
        const aliveState = await this.getStateAsync(`${upsId}.info.alive`);

        if (aliveState && aliveState.val === false) {
            this.log.warn(`UPS '${upsId}' is available again`);
        }

        await this.setStateAsync(`${upsId}.info.alive`, { val: true, ack: true });
        await this.setStateAsync(`${upsId}.info.ipAddress`, { val: ipAddress, ack: true });

        const adapterStates = require('./lib/states-definition.json');
        const fields = Object.keys(state);
        for (const field of fields) {
            const value = state[field];
            try {
                const upsState = adapterStates.states.find(e => e.upsId == field);
                if (upsState) {
                    const upsStateId = `${upsId}.${upsState.id}`;
                    const instanceState = await this.getObjectAsync(upsStateId);
                    if (instanceState != null) {
                        await this.setStateAsync(upsStateId, { val: value, ack: true });
                    } else {
                        const newState = adapterStates.defaultState;
                        newState.upsId = upsState.upsId;
                        newState.id = upsState.id;
                        await this.createAdapterState(upsId, newState);
                        await this.setStateAsync(upsStateId, { val: value, ack: true });
                    }
                } else {
                    const newState = adapterStates.defaultState;
                    newState.upsId = field;
                    newState.id = field.toLowerCase();
                    await this.createAdapterState(upsId, newState);
                    await this.setStateAsync(`${upsId}.${field.toLowerCase()}`, { val: value, ack: true });
                }
            } catch (error) {
                this.log.debug(`Can't update UPS state ${field}:${value} because of ${error}`);
            }
        }
    }

    async createUpsObjects(upsId, ipAddress, ipPort) {
        if (this.initialized[upsId]) {
            return;
        }
        await this.setObjectNotExistsAsync(upsId, {
            type: 'device',
            common: {
                name: upsId,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync(`${upsId}.info`, {
            'type': 'channel',
            'common': {
                'name': 'Information',
            },
            native: {}
        });

        await this.setObjectNotExistsAsync(`${upsId}.info.alive`, {
            'type': 'state',
            'common': {
                'name': 'Is alive',
                'type': 'boolean',
                'read': true,
                'write': false,
                'role': 'indicator.state'
            },
            native: {}
        });

        await this.setObjectNotExistsAsync(`${upsId}.info.ipAddress`, {
            'type': 'state',
            'common': {
                'name': 'UPS IP Address',
                'type': 'string',
                'read': true,
                'write': false,
                'role': 'state'
            },
            native: {}
        });

        await this.setObjectNotExistsAsync(`${upsId}.info.ipPort`, {
            'type': 'state',
            'common': {
                'name': 'UPS IP Port',
                'type': 'number',
                'read': true,
                'write': false,
                'role': 'state'
            },
            native: {}
        });

        await this.setStateAsync(`${upsId}.info.ipAddress`, { val: ipAddress, ack: true });
        await this.setStateAsync(`${upsId}.info.ipPort`, { val: ipPort, ack: true });

        const adapterStates = require('./lib/states-definition.json');
        for (let i = 0; i < adapterStates.states.length; i++) {
            const stateInfo = adapterStates.states[i];
            await this.createAdapterState(upsId, stateInfo);
        }
        this.initialized[upsId] = true;
    }

    async createAdapterState(upsId, stateInfo) {
        const common = {
            name: stateInfo.name,
            type: stateInfo.type,
            role: stateInfo.role,
            read: true,
            write: false
        };
        if (stateInfo.unit && stateInfo.unit != null) {
            common.unit = stateInfo.unit;
        }
        const stateId = `${upsId}.${stateInfo.id}`;
        await this.setObjectNotExistsAsync(stateId, {
            type: 'state',
            common: common,
            native: {},
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            this.clearTimeout(this.timeoutId);
            this.clearTimeout(this.availabilityTimeout);

            if (this.apcAccess != null && this.apcAccess.isConnected === true) {
                await this.apcAccess.disconnect();
                this.log.info('ApcAccess client is disconnected');
            }
            callback();
        } catch (error) {
            this.log.error(error);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new ApcUpsAdapter(options);
} else {
    // otherwise start the instance directly
    new ApcUpsAdapter();
}