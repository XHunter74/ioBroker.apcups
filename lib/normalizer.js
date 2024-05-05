class Normaliser {

    normalizeUpsResult(state) {
        state = this.#normalizeDates(state);
        state = this.#normalizeFloats(state);
        state = this.#normalizeInts(state);
        return state;
    };

    #normalizeFloats(state) {
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

    #normalizeInts(state) {
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

    #normalizeDates(state) {
        const dateFields = ['DATE', 'STARTTIME', 'XONBATT', 'XOFFBATT', 'LASTSTEST', 'ENDAPC'];
        dateFields.forEach(e => {
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

module.exports = Normaliser;