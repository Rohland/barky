import { sleepMs } from "./lib/sleep";
import { startClock, stopClock } from "./lib/profiler";
import { canLockProcessFor } from "./lib/process-lock";

const LoopMs = 30000;

export async function loop(
    args,
    runner: () => Promise<number>): Promise<number> {
    const shouldLoop = !!args.loop;
    if (!shouldLoop) {
        return await runner();
    }
    if (!validateNoOtherInstancesRunningFor(args)) {
        return -1;
    }
    while(true) {
        const result = await doLoop(runner);
        if (result < 0) {
            return result;
        }
    }
}

function validateNoOtherInstancesRunningFor(args) {
    const key = [
        args.env,
        args.eval,
        args.digest].join(";").toLowerCase();
    return canLockProcessFor(key);
}

async function doLoop(runner: () => Promise<number>): Promise<number> {
    const clock = startClock();
    const result = await runner();
    const ms = stopClock(clock);
    if (result < 0) {
        return result;
    }
    const timeToSleep = LoopMs - ms;
    await sleepMs(timeToSleep < 0 ? 0 : timeToSleep);
    return result;
}
