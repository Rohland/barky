import * as Util from "util";

let logger : (msg: string, data?: any) => void = () => {};

function _log(msg: string, data?: any) {
    if (this.debug) {
        data
            ? console.log(msg, Util.inspect(data))
            : console.log(msg);
    }
}

export function initLogger(args) {
    logger = _log.bind(args);
}

export function log(msg: string, data?: any) {
    logger(msg, data);
}
