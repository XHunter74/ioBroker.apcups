class Normalizer {
    integerFields = ['MBATTCHG', 'MINTIMEL', 'MAXTIME', 'NUMXFERS', 'TONBATT', 'CUMONBATT', 'NOMINV', 'NOMPOWER'];
    floatFields = ['LINEV', 'LOADPCT', 'BCHARGE', 'TIMELEFT', 'LOTRANS', 'HITRANS', 'BATTV', 'NOMBATTV'];
    dateFields = ['DATE', 'STARTTIME', 'XONBATT', 'XOFFBATT', 'LASTSTEST', 'ENDAPC'];
    integerRe = /\d+/;
    floatRe = /\d+(\.\d+)/;

    normalizeUpsResult(state) {
        state = this.#normalizeDates(state);
        state = this.#normalizeFloats(state);
        state = this.#normalizeInts(state);
        return state;
    };

    #normalizeFloats(state) {
        this.floatFields.forEach(e => {
            const floatState = state[e];
            if (typeof floatState !== 'undefined' && floatState != '') {
                const match = this.floatRe.exec(floatState);
                if (match != null) {
                    state[e] = parseFloat(match[0]);
                }
            }
        });
        return state;
    }

    #normalizeInts(state) {
        this.integerFields.forEach(e => {
            const intState = state[e];
            if (typeof intState !== 'undefined' && intState != '') {
                const match = this.integerRe.exec(intState);
                if (match != null) {
                    state[e] = parseFloat(match[0]);
                }
            }
        });
        return state;
    }

    #normalizeDates(state) {
        this.dateFields.forEach(e => {
            const dateState = state[e];
            if (typeof dateState !== 'undefined' && dateState != '' && dateState != 'N/A') {
                state[e] = this.#toIsoString(new Date(dateState.trim()));
            } else {
                state[e] = '';
            }
        });
        return state;
    }

    #toIsoString(date) {
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
}

module.exports = Normalizer;