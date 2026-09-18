import * as Util from "util";

let logger : (msg: string, data?: any) => void = () => {};

function _log(msg: string, data?: any) {
    if (this.debug || process.env.DEBUG) {
        const prefix = `${ new Date().toISOString() }: `;
        data
            ? console.log(prefix + msg, Util.inspect(data))
            : console.log(prefix + msg);
    }
}

export function initLogger(args) {
    logger = _log.bind(args);
}

export function log(msg: string, data?: any) {
    logger(msg, data);
}

/*
 Said out loud, whatever the log level. For the things an operator has to know about even when
 barky was not started with --debug: it could not alert, or it is stopping. Everything else belongs
 in log, which is silent without the flag.
 */
export function warn(msg: string, data?: any) {
    console.log(`${ new Date().toISOString() }: ${ msg }`);
    logger(msg, data);
}
