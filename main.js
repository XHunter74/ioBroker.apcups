'use strict';
const ApcAccess = require('./lib/apcaccess');


const utils = require('@iobroker/adapter-core');
const MinPollInterval = 1000;
const MaxPollInterval = 60000;

class ApcUpsAdapter extends utils.Adapter {

    intervalId;
    timeoutId;
    apcAccess;

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

        this.startPooling();
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
        this.apcAccess = new ApcAccess();
        this.apcAccess.on('error', async (error) => {
            this.log.error(error);
            this.setState('info.connection', false, true);
        });
        this.apcAccess.on('connect', () => {
            this.setState('info.connection', true, true);
            this.log.debug(`Connected to apcupsd '${this.config.upsip}:${this.config.upsport}' successfully`);
        });
        this.apcAccess.on('disconnect', async () => {
            this.log.debug(`Disconnected from apcupsd '${this.config.upsip}:${this.config.upsport}'`);
        });
    }

    startPooling() {
        this.timeoutId = this.setTimeout(async () => {
            await this.processTask(this.apcAccess);
            this.clearTimeout(this.timeoutId);
            this.startPooling();
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
        await this.apcAccess.connect(ups.upsIp, ups.upsPort);
        if (client.isConnected === true) {
            try {
                let result = await client.getStatusJson();
                await this.apcAccess.disconnect();
                console.log(result);
                result = this.normalizeUpsResult(result);
                const upsId = result['SERIALNO'];
                this.log.debug(`UPS Id: '${upsId}'`);
                this.log.debug(`UPS state: '${JSON.stringify(result)}'`);
                await this.createStatesObjects(upsId);
                await this.setUpsStates(upsId, result);
            } catch (error) {
                this.log.error(`Failed to process apcupsd result: ${error} for UPS: ${ups.upsIp}:${ups.upsPort}`);
                this.sendError(error, `Failed to process apcupsd result`);
            }
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

    async setUpsStates(upsId, state) {
        const adapterStates = require('./lib/states-definition.json');
        const fields = Object.keys(state);
        for (const field of fields) {
            const value = state[field];
            try {
                const upsState = adapterStates.states.find(e => e.upsId == field);
                if (upsState) {
                    const upsStateId = `${upsId}.${upsState.id}`
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

    async createStatesObjects(upsId) {
        await this.setObjectNotExistsAsync(upsId, {
            type: 'device',
            common: {
                name: upsId,
            },
            native: {},
        });

        const adapterStates = require('./lib/states-definition.json');
        for (let i = 0; i < adapterStates.states.length; i++) {
            const stateInfo = adapterStates.states[i];
            await this.createAdapterState(upsId, stateInfo);
        }
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
        const stateId = `${upsId}.${stateInfo.id}`
        await this.setObjectNotExistsAsync(stateId, {
            type: 'state',
            common: common,
            native: {},
        });
    }

    normalizeUpsResult(state) {
        state = this.normalizeDates(state);
        state = this.normalizeFloats(state);
        state = this.normalizeInts(state);
        return state;
    }

    normalizeFloats(state) {
        const floatFields = ['LINEV', 'LOADPCT', 'BCHARGE', 'TIMELEFT', 'LOTRANS', 'HITRANS', 'BATTV', 'NOMBATTV'];
        const re = /\d+(\.\d+)/;
        floatFields.forEach(e => {
            const floatState = state[e];
            if (typeof floatState !== 'undefined' && floatState != '') {
                const match = re.exec(floatState);
                if (match != null) {
                    state[e] = parseFloat(match[0]);
                }
            }
        });
        return state;
    }

    normalizeInts(state) {
        const floatFields = ['MBATTCHG', 'MINTIMEL', 'MAXTIME', 'NUMXFERS', 'TONBATT', 'CUMONBATT', 'NOMINV', 'NOMPOWER'];
        const re = /\d+/;
        floatFields.forEach(e => {
            const intState = state[e];
            if (typeof intState !== 'undefined' && intState != '') {
                const match = re.exec(intState);
                if (match != null) {
                    state[e] = parseFloat(match[0]);
                }
            }
        });
        return state;
    }

    normalizeDates(state) {
        const dateFields = ['DATE', 'STARTTIME', 'XONBATT', 'XOFFBATT', 'LASTSTEST', 'ENDAPC'];
        dateFields.forEach(e => {
            const dateState = state[e];
            if (typeof dateState !== 'undefined' && dateState != '') {
                state[e] = this.toIsoString(new Date(dateState.trim()));
            }
        });
        return state;
    }

    toIsoString(date) {
        const tzo = -date.getTimezoneOffset(),
            dif = tzo >= 0 ? '+' : '-',
            pad = function (num) {
                const norm = Math.floor(Math.abs(num));
                return (norm < 10 ? '0' : '') + norm;
            };

        return date.getFullYear() +
            '-' + pad(date.getMonth() + 1) +
            '-' + pad(date.getDate()) +
            'T' + pad(date.getHours()) +
            ':' + pad(date.getMinutes()) +
            ':' + pad(date.getSeconds()) +
            dif + pad(tzo / 60) +
            ':' + pad(tzo % 60);
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            this.clearInterval(this.intervalId);

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