export function sortByKey(key: string) {
    return (a, b) => (a[key] > b[key])
        ? 1
        : ((b[key] > a[key]) ? -1 : 0);
}

export function sortBy<T>(array: T[], key: string): T[] {
    const sorted = [...array];
    sorted.sort(sortByKey(key));
    return sorted;
}
