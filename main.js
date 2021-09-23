'use strict';

/*
 * Created with @iobroker/create-adapter v1.34.1
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const fs = require("fs");

const MaxRecconectAttempts = 5;

class ApcUpsAdapter extends utils.Adapter {

    #intervalId;
    #apcAccess;
    #errorCount = 0;

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'apcups',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        this.log.info('UPS IP: ' + this.config.upsip);
        this.log.info('UPS Port: ' + this.config.upsport);
        this.log.info('Polling interval: ' + this.config.pollingInterval);

        await this.startPooling();
    }

    async startPooling() {
        const ApcAccess = require('apcaccess');

        this.#apcAccess = new ApcAccess();
        this.#apcAccess.on('error', (error) => {
            this.log.error(error);
            if (this.#errorCount <= MaxRecconectAttempts) {
                if (!this.#apcAccess.isConnected) {
                    this.#apcAccess.connect(this.config.upsip, this.config.upsport);
                }
                this.#errorCount++;
            } else {
                this.terminate('Maximum number of errors reached ');
            }
        });
        this.#apcAccess.on('connect', () => {
            this.setState("info.connection", true, true);
            this.log.info("Connected to apcupsd successfully");
        });
        this.#apcAccess.on('disconnect', () => {
            this.setState("info.connection", false, true);
            this.log.info("Disconnected from apcupsd");
        });
        this.#apcAccess.connect(this.config.upsip, this.config.upsport);
        this.#intervalId = this.setInterval(() => this.processTask(this.#apcAccess), this.config.pollingInterval);
    }

    async processTask(client) {
        let result = await client.getStatusJson();
        console.log(result);
        result = this.normalizeUpsResult(result);
        this.log.debug(`UPS state: '${JSON.stringify(result)}'`);
        await this.createStatesObjects(this.config.upsStates);
        await this.setUpsStates(this.config.upsStates, result);
        //console.log('Disconnected');
    }

    async setUpsStates(upsStates, state) {
        for (let i = 0; i < upsStates.length; i++) {
            const stateId = upsStates[i].id;
            let value = state[upsStates[i].upsId];
            const stateValue = (await this.getStateAsync(stateId)).val;
            if (value != stateValue) {
                await this.setStateAsync(stateId, { val: value, ack: true });
            }
        }
    }

    async createStatesObjects(upsStates) {
        for (let i = 0; i < upsStates.length; i++) {
            await this.createObject(upsStates[i]);
        }
    }

    async createObject(stateInfo) {
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
            const match = re.exec(state[e]);
            if (match != null) {
                state[e] = parseFloat(match[0]);
            }
        });
        return state;
    }

    normalizeInts(state) {
        const floatFields = ['MBATTCHG', 'MINTIMEL', 'MAXTIME', 'NUMXFERS', 'TONBATT', 'CUMONBATT', 'NOMINV', 'NOMPOWER'];
        const re = /\d+/;
        floatFields.forEach(e => {
            const match = re.exec(state[e]);
            if (match != null) {
                state[e] = parseFloat(match[0]);
            }
        });
        return state;
    }

    normalizeDates(state) {
        const dateFields = ['DATE', 'STARTTIME', 'XONBATT', 'XOFFBATT', 'LASTSTEST'];
        dateFields.forEach(e => {
            state[e] = new Date(state[e].trim());
        });
        return state;
    }

    /**
    * Is called when adapter shuts down - callback has to be called under any circumstances!
    * @param {() => void} callback
    */
    async onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            // clearTimeout(timeout1);
            // clearTimeout(timeout2);
            // ...
            // clearInterval(interval1);
            this.clearInterval(this.#intervalId);
            if (this.#apcAccess.isConnected) {
                await this.#apcAccess.disconnect();
                this.log.info('ApcAccess client is disconnected');
            }
            callback();
        } catch (e) {
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  * @param {string} id
    //  * @param {ioBroker.Object | null | undefined} obj
    //  */
    // onObjectChange(id, obj) {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    //     if (typeof obj === 'object' && obj.message) {
    //         if (obj.command === 'send') {
    //             // e.g. send email or pushover or whatever
    //             this.log.info('send command');

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    //         }
    //     }
    // }

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
