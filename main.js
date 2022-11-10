'use strict';


const utils = require('@iobroker/adapter-core');

const DefaultReconnectionDelay = 5000;
const MaxReconnectionDelay = 60000;
const PingInterval = 10000;
const SocketTimeout = 15000;

class ApcUpsAdapter extends utils.Adapter {

    intervalId;
    pingIntervalId;
    delayId;
    apcAccess;
    reconnectDelay = 5000;

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

    async delay(ms) {
        await new Promise(resolve => this.delayId = setTimeout(resolve, ms));
    }

    async reconnect() {
        await this.delay(this.reconnectDelay);
        try {
            await this.apcAccess.connect(this.config.upsip, this.config.upsport);
        } catch (error) {
            if (this.reconnectDelay < MaxReconnectionDelay) {
                this.reconnectDelay += 5000;
            }
            this.log.error(error);
        }
    }

    async startPooling() {
        const ApcAccess = require('./apcaccess');

        this.apcAccess = new ApcAccess();
        this.apcAccess.on('error', async(error) => {
            this.log.error(error);
            await this.reconnect();
        });
        this.apcAccess.on('connect', () => {
            this.reconnectDelay = DefaultReconnectionDelay;
            this.errorCount = 0;
            this.setState('info.connection', true, true);
            this.log.info('Connected to apcupsd successfully');
        });
        this.apcAccess.on('disconnect', () => {
            this.setState('info.connection', false, true);
            this.log.info('Disconnected from apcupsd');
        });

        if (this.apcAccess.isConnected === false) {
            try {
                await this.apcAccess.connect(this.config.upsip, this.config.upsport);
                // eslint-disable-next-line no-empty
            } catch {}
        }
        if (this.config.pollingInterval > SocketTimeout) {
            this.pingIntervalId = this.setInterval(() => {
                //this.log.debug(`Connected: ${this.#apcAccess.isConnected}`);
                this.pingApcUpsd(this.apcAccess);
            }, PingInterval);
        }

        this.intervalId = this.setInterval(() => {
            //this.log.debug(`Connected: ${this.#apcAccess.isConnected}`);
            this.processTask(this.apcAccess);
        }, this.config.pollingInterval);
    }

    async pingApcUpsd(client) {
        try {
            if (this.apcAccess.isConnected === false) {
                await this.reconnect();
            }
            await client.ping();
            this.log.debug(`Ping apcupsd ${this.config.upsip}:${this.config.upsport}`);
            // eslint-disable-next-line no-empty
        } catch {}
    }

    async processTask(client) {
        if (client.isConnected === true) {
            try {
                let result = await client.getStatusJson();
                console.log(result);
                result = this.normalizeUpsResult(result);
                this.log.debug(`UPS state: '${JSON.stringify(result)}'`);
                await this.createStatesObjects(this.config.upsStates);
                await this.setUpsStates(this.config.upsStates, result);
            } catch (error) {
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

    async setUpsStates(upsStates, state) {
        for (let i = 0; i < upsStates.length; i++) {
            const stateId = upsStates[i].id;
            const value = state[upsStates[i].upsId];
            const instanceState = (await this.getStateAsync(stateId));
            if (instanceState != null) {
                const stateValue = instanceState.val;
                if (value != stateValue) {
                    await this.setStateAsync(stateId, { val: value, ack: true });
                }
            } else {
                await this.setStateAsync(stateId, { val: value, ack: true });
            }
        }
    }

    async createStatesObjects(upsStates) {
        for (let i = 0; i < upsStates.length; i++) {
            const stateInfo = upsStates[i];
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
        const dateFields = ['DATE', 'STARTTIME', 'XONBATT', 'XOFFBATT', 'LASTSTEST'];
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
            pad = function(num) {
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
            if (typeof this.pingIntervalId !== 'undefined') {
                this.clearInterval(this.pingIntervalId);
            }
            if (typeof this.delayId !== 'undefined') {
                this.clearTimeout(this.delayId);
            }
            if (this.apcAccess != null && this.apcAccess.isConnected === true) {
                await this.apcAccess.disconnect();
                this.log.info('ApcAccess client is disconnected');
            }
            callback();
        } catch (error) {
            this.log.error(error);
            this.sendError(error, `Failed to unload iobroker.apcups`);
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