'use strict';
const ApcAccess = require('./lib/apcaccess');


const utils = require('@iobroker/adapter-core');

class ApcUpsAdapter extends utils.Adapter {

    intervalId;
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
        this.log.info(`Apcupcd location: ${this.config.upsip}:${this.config.upsport}`);
        this.log.info('Polling interval: ' + this.config.pollingInterval);
        this.setState('info.UPSHost', this.config.upsip, true);
        this.setState('info.UPSPort', this.config.upsport, true);
        await this.startPooling();
    }

    async startPooling() {
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

        await this.processTask(this.apcAccess);
        this.intervalId = this.setInterval(async () => {
            //this.log.debug(`Connected: ${this.#apcAccess.isConnected}`);
            await this.processTask(this.apcAccess);
        }, this.config.pollingInterval);
    }

    async processTask(client) {
        try {
            await this.apcAccess.connect(this.config.upsip, this.config.upsport);
            if (client.isConnected === true) {
                try {
                    let result = await client.getStatusJson();
                    console.log(result);
                    result = this.normalizeUpsResult(result);
                    this.log.debug(`UPS state: '${JSON.stringify(result)}'`);
                    await this.createStatesObjects();
                    await this.setUpsStates(result);
                    await this.apcAccess.disconnect();
                } catch (error) {
                    this.sendError(error, `Failed to process apcupsd result`);
                }
            }
            // eslint-disable-next-line no-empty
        } catch { }
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

    async setUpsStates(state) {
        const adapterStates = require('./io-package.json');
        const fields = Object.keys(state);
        for (const field of fields) {
            const value = state[field];
            try {
                const upsState = adapterStates.native.upsStates.find(e => e.upsId == field);
                if (upsState) {
                    const instanceState = await this.getStateAsync(upsState.id);
                    if (instanceState != null) {
                        await this.setStateAsync(upsState.id, { val: value, ack: true });
                    } else {
                        const newState = adapterStates.native.defaultState;
                        newState.upsId = field;
                        newState.id = upsState.id;
                        await this.createAdapterState(newState);
                        await this.setStateAsync(upsState.id, { val: value, ack: true });
                    }
                } else {
                    const newState = adapterStates.native.defaultState;
                    newState.upsId = field;
                    newState.id = field.toLowerCase();
                    await this.createAdapterState(newState);
                    await this.setStateAsync(field.toLowerCase(), { val: value, ack: true });
                }
            } catch {
                this.log.debug(`Can't update UPS state ${field}:${value}`);
            }
        }
    }

    async createStatesObjects() {
        const adapterStates = require('./io-package.json');
        for (let i = 0; i < adapterStates.native.upsStates.length; i++) {
            const stateInfo = adapterStates.native.upsStates[i];
            await this.createAdapterState(stateInfo);
        }
    }

    async createAdapterState(stateInfo) {
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
        await this.setObjectNotExistsAsync(stateInfo.id, {
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