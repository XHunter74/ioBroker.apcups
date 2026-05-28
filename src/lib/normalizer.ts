type UpsState = Record<string, string | number>;

class Normalizer {
    #integerFields = ['MBATTCHG', 'MINTIMEL', 'MAXTIME', 'NUMXFERS', 'TONBATT', 'CUMONBATT', 'NOMINV', 'NOMPOWER'];
    #floatFields = ['LINEV', 'LOADPCT', 'BCHARGE', 'TIMELEFT', 'LOTRANS', 'HITRANS', 'BATTV', 'NOMBATTV'];
    #dateFields = ['DATE', 'STARTTIME', 'XONBATT', 'XOFFBATT', 'LASTSTEST', 'ENDAPC'];
    #integerRe = /\d+/;
    #floatRe = /\d+(\.\d+)?/;

    normalizeUpsResult(state: UpsState): UpsState {
        state = this.#normalizeDates(state);
        state = this.#normalizeFloats(state);
        state = this.#normalizeInts(state);
        return state;
    }

    #normalizeFloats(state: UpsState): UpsState {
        this.#floatFields.forEach(e => {
            const floatState = state[e];
            if (typeof floatState !== 'undefined' && floatState !== '') {
                const match = this.#floatRe.exec(String(floatState));
                if (match != null) {
                    state[e] = parseFloat(match[0]);
                }
            }
        });
        return state;
    }

    #normalizeInts(state: UpsState): UpsState {
        this.#integerFields.forEach(e => {
            const intState = state[e];
            if (typeof intState !== 'undefined' && intState !== '') {
                const match = this.#integerRe.exec(String(intState));
                if (match != null) {
                    state[e] = parseInt(match[0], 10);
                }
            }
        });
        return state;
    }

    #normalizeDates(state: UpsState): UpsState {
        this.#dateFields.forEach(e => {
            const dateState = state[e];
            if (typeof dateState !== 'undefined' && dateState !== '' && dateState !== 'N/A') {
                state[e] = this.#toIsoString(new Date(String(dateState).trim()));
            } else {
                state[e] = '';
            }
        });
        return state;
    }

    #toIsoString(date: Date): string {
        const tzo = -date.getTimezoneOffset();
        const dif = tzo >= 0 ? '+' : '-';
        const pad = (num: number): string => {
            const norm = Math.floor(Math.abs(num));
            return (norm < 10 ? '0' : '') + norm;
        };

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${dif}${pad(tzo / 60)}:${pad(tzo % 60)}`;
    }
}

export default Normalizer;
