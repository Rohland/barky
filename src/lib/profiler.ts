export function startClock() {
    return process.hrtime();
}

export function stopClock(start) {
    const end = process.hrtime(start);
    const timeInMs = (end[0] * 1000000000 + end[1]) / 1000000;
    return timeInMs;
}
