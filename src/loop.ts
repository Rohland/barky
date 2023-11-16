import { sleepMs } from "./lib/sleep";
import { startClock, stopClock } from "./lib/profiler";
import { canLockProcessFor } from "./lib/process-lock";

export const LoopMs = 30000;

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
        const result = await doLoop(args, runner);
        if (result < 0) {
            return result;
        }
    }
}

function validateNoOtherInstancesRunningFor(args) {
    const key = [
        args.rules,
        args.eval,
        args.digest].join(";").toLowerCase();
    return canLockProcessFor(key);
}

async function doLoop(args, runner: () => Promise<number>): Promise<number> {
    const clock = startClock();
    const result = await runner();
    const ms = stopClock(clock);
    if (result < 0) {
        return result;
    }
    const interval = args.debug ? 5000: LoopMs;
    const timeToSleep = interval - ms;
    await sleepMs(timeToSleep < 0 ? 0 : timeToSleep);
    return result;
}
