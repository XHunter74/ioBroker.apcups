import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';

const CONNECT_TIMEOUT_MS = 5000;

interface ApcRequest {
    fulfill: (res: string) => void;
    reject: (error: Error) => void;
    cmd: string;
    res: string;
}

class ApcAccess extends EventEmitter {
    #waitForResponse = false;
    #socket: Socket;
    #isConnected = false;
    #requests: ApcRequest[] = [];
    #receiveBuffer = Buffer.allocUnsafe(0);
    #lastHost = '';
    #lastPort = 0;

    public constructor() {
        super();
        this.#socket = new Socket();
        this.#socket.on('data', this.#onDataReceived.bind(this));
        this.#socket.on('close', this.#onSocketClose.bind(this));
        this.#socket.on('connect', this.#onSocketConnect.bind(this));
        this.#socket.on('error', this.#onSocketError.bind(this));
    }

    get isConnected(): boolean {
        return this.#isConnected;
    }

    get lastHost(): string {
        return this.#lastHost;
    }

    get lastPort(): number {
        return this.#lastPort;
    }

    #onDataReceived(data: Buffer): void {
        let req = this.#requests[0];
        if (req && this.#waitForResponse) {
            this.#receiveBuffer = Buffer.concat([this.#receiveBuffer, data], this.#receiveBuffer.length + data.length);
            while (this.#receiveBuffer.length > 2) {
                const length = this.#receiveBuffer.readUInt16BE(0);
                req.res += this.#receiveBuffer.toString('ascii', 2, length + 2);
                this.#receiveBuffer = this.#receiveBuffer.slice(length + 2);
            }
            if (this.#receiveBuffer.length === 2 && this.#receiveBuffer.readUInt16BE(0) === 0) {
                req = this.#requests.shift()!;
                this.#waitForResponse = false;
                this.#receiveBuffer = Buffer.allocUnsafe(0);
                process.nextTick(function () {
                    req.fulfill(req.res);
                });
                this.#flush();
            }
        }
    }

    #onSocketClose(): void {
        this.#isConnected = false;
        this.emit('disconnect');
    }

    #onSocketConnect(): void {
        this.#isConnected = true;
        this.emit('connect');
    }

    #onSocketError(error: Error): void {
        this.#isConnected = false;
        this.emit('error', error);
    }

    async connect(host = 'localhost', port = 3551): Promise<void> {
        return new Promise((fulfill, reject) => {
            let timeoutHandle: ReturnType<typeof setTimeout>;

            const handlers = {
                onConnect: (): void => {
                    clearTimeout(timeoutHandle);
                    this.#socket.removeListener('connect', handlers.onConnect);
                    this.#socket.removeListener('error', handlers.onError);
                    fulfill();
                },
                onError: (error: Error): void => {
                    clearTimeout(timeoutHandle);
                    this.#socket.removeListener('connect', handlers.onConnect);
                    this.#socket.removeListener('error', handlers.onError);
                    reject(error);
                },
            };

            if (!this.#isConnected && !this.#socket.connecting) {
                this.#lastHost = host;
                this.#lastPort = port;
                this.#socket.connect(port, host);
                this.#socket.on('connect', handlers.onConnect);
                this.#socket.on('error', handlers.onError);
                timeoutHandle = setTimeout(() => {
                    this.#socket.removeListener('connect', handlers.onConnect);
                    this.#socket.removeListener('error', handlers.onError);
                    this.#socket.destroy();
                    reject(new Error(`Connection to ${host}:${port} timed out`));
                }, CONNECT_TIMEOUT_MS);
            } else if (this.#isConnected) {
                reject(new Error(`Already connected to ${this.#socket.remoteAddress}:${this.#socket.remotePort}`));
            } else {
                reject(new Error('Already connecting'));
            }
        });
    }

    async disconnect(): Promise<void> {
        return new Promise((fulfill, reject) => {
            const handlers = {
                onClose: (): void => {
                    this.#socket.removeListener('close', handlers.onClose);
                    this.#socket.removeListener('error', handlers.onError);
                    fulfill();
                },
                onError: (error: Error): void => {
                    this.#socket.removeListener('close', handlers.onClose);
                    this.#socket.removeListener('error', handlers.onError);
                    reject(error);
                },
            };

            this.#socket.end();
            this.#socket.on('close', handlers.onClose);
            this.#socket.on('error', handlers.onError);
        });
    }

    async sendCommand(command: string): Promise<string> {
        return new Promise((fulfill, reject) => {
            this.#requests.push({
                fulfill: fulfill,
                reject: reject,
                cmd: command,
                res: '',
            });
            this.#flush();
        });
    }

    async getStatus(): Promise<string> {
        return this.sendCommand('status');
    }

    async getStatusJson(): Promise<Record<string, string>> {
        let result = await this.getStatus();
        result = result.replace('END APC', 'ENDAPC');
        const re = /(\w+\s?\w+)\s*:\s(.+)?\n/g;
        const matches: Record<string, string> = {};
        let match = re.exec(result);
        while (match != null) {
            matches[match[1]] = match[2];
            match = re.exec(result);
        }
        return matches;
    }

    #flush(): void {
        const req = this.#requests[0];
        if (req && !this.#waitForResponse) {
            this.#waitForResponse = true;
            const buffer = Buffer.allocUnsafe(req.cmd.length + 2);
            buffer.writeUInt16BE(req.cmd.length, 0);
            buffer.write(req.cmd, 2);
            if (!this.#socket.closed) {
                try {
                    this.#socket.write(buffer);
                } catch {
                    this.#isConnected = false;
                    this.emit('error', `Can't flush request data`);
                }
            }
        }
    }
}

export default ApcAccess;
