export async function sleepMs(time) {
    return new Promise(resolve => {
        setTimeout(resolve, time);
    });
}
