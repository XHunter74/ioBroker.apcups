const net = require('net');
const events = require('events');

class ApcAccess extends events.EventEmitter {

    _waitForResponse = false;
    #socket;
    _isConnected = false;
    #requests = [];
    _receiveBuffer = Buffer.allocUnsafe(0);

    constructor() {
        super();
        this.#socket = new net.Socket();
        this.#socket.on('data', this.#onDataReceived.bind(this));
        this.#socket.on('close', this.#onSocketClose.bind(this));
        this.#socket.on('connect', this.#onSocketConnect.bind(this));
        this.#socket.on('error', this.#onSocketError.bind(this));
    }

    get isConnected() {
        return this._isConnected;
    }

    #onDataReceived(data) {
        let req = this.#requests[0];
        if (req && this._waitForResponse) {
            this._receiveBuffer = Buffer.concat([this._receiveBuffer, data], this._receiveBuffer.length + data.length);
            while (this._receiveBuffer.length > 2) {
                const length = this._receiveBuffer.readUInt16BE(0);
                req.res += this._receiveBuffer.toString('ascii', 2, length + 2);
                this._receiveBuffer = this._receiveBuffer.slice(length + 2);
            }
            if (this._receiveBuffer.length === 2 && this._receiveBuffer.readUInt16BE(0) === 0) {
                req = this.#requests.shift();
                this._waitForResponse = false;
                this._receiveBuffer = Buffer.allocUnsafe(0);
                process.nextTick(function () {
                    req.fulfill(req.res);
                });
                this.#flush();
            }
        }
    }

    #onSocketClose() {
        this._isConnected = false;
        this.emit('disconnect');
    }

    #onSocketConnect() {
        this._isConnected = true;
        this.emit('connect');
    }

    #onSocketError(error) {
        this._isConnected = false;
        this.emit('error', error);
    }

    async connect(host, port) {
        port = port || 3551;
        host = host || 'localhost';
        return /** @type {Promise<void>} */(new Promise((fulfill, reject) => {

            const fulfillConnect = () => {
                clear();
                fulfill();
            };

            const rejectConnect = (error) => {
                clear();
                reject(error);
            };

            const clear = () => {
                this.#socket.removeListener('connect', fulfillConnect);
                this.#socket.removeListener('error', rejectConnect);
            };

            if (!this._isConnected && !this.#socket.connecting) {
                this.#socket.connect(port, host);
                this.#socket.on('connect', fulfillConnect);
                this.#socket.on('error', rejectConnect);
            } else if (this._isConnected) {
                reject(new Error('Already connected to ' + this.#socket.remoteAddress + ':' + this.#socket.remotePort));
            } else {
                reject(new Error('Already connecting'));
            }
        }));
    }

    async disconnect() {
        return /** @type {Promise<void>} */(new Promise((fulfill, reject) => {
            const fulfillDisconnect = () => {
                clear();
                fulfill();
            };

            const rejectDisconnect = (error) => {
                clear();
                reject(error);
            };

            const clear = () => {
                this.#socket.removeListener('close', fulfillDisconnect);
                this.#socket.removeListener('error', rejectDisconnect);
            };

            this.#socket.end();
            this.#socket.on('close', fulfillDisconnect);
            this.#socket.on('error', rejectDisconnect);
        }));
    }

    async sendCommand(command) {
        return new Promise((fulfill, reject) => {
            this.#requests.push({
                fulfill: fulfill,
                reject: reject,
                cmd: command,
                res: ''
            });
            this.#flush();
        });
    }

    async getStatus() {
        return await this.sendCommand('status');
    }

    async getStatusJson() {
        let result = await this.getStatus();
        result = result.replace('END APC', 'ENDAPC');
        const re = /(\w+\s?\w+)\s*:\s(.+)?\n/g;
        const matches = {};
        let match = re.exec(result);
        while (match != null) {
            matches[match[1]] = match[2];
            match = re.exec(result);
        }
        return matches;
    }

    #flush() {
        const req = this.#requests[0];
        if (req && !this._waitForResponse) {
            this._waitForResponse = true;
            const buffer = Buffer.allocUnsafe(req.cmd.length + 2);
            buffer.writeUInt16BE(req.cmd.length, 0);
            buffer.write(req.cmd, 2);
            if (!this.#socket.closed) {
                try {
                    this.#socket.write(buffer);
                } catch {
                    this._isConnected = false;
                    this.emit('error', `Can't flush request data`);
                }
            }
        }
    }
}

module.exports = ApcAccess;