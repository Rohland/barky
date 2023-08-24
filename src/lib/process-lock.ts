import { hash } from "./utility";
import fs from "fs";

function getPidForLock(lock: string) {
    try {
        const text = fs.readFileSync(lock, 'utf8');
        return text.split("#")[0].trim();
    } catch {
        return null;
    }
}

function isInstanceRunning(pid) {
    try {
        process.kill(parseInt(pid), 0);
        return true;
    } catch (err) {
        return false;
    }
}

export function canLockProcessFor(key): boolean {
    const lock = `${ hash(key) }.lock`;
    const pid = getPidForLock(lock);
    if (pid) {
        if (isInstanceRunning(pid)) {
            return false;
        }
    }
    fs.writeFileSync(
        lock,
        `${ process.pid.toString()} # ${ key }` ,
        'utf8');
    return true;
}
