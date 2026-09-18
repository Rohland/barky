export interface IUniqueKey {
    type: string;
    label: string;
    identifier: string;
}

export function uniqueKey(item: IUniqueKey) {
    return [item.type, item.label, item.identifier].join("::");
}

export function escapeRegex(value: string): string {
    return (value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 Builds the mute match expression targeting exactly one alert. Anchored, so muting
 web::health::acme.com cannot also silence web::health::acme.com.au.
 */
export function mutePatternFor(id: string): string {
    return `^${ escapeRegex(id) }$`;
}

export function hasWildcard(item: IUniqueKey) {
    if (!item) {
        return false;
    }
    return item.type === "*" || item.label === "*" || item.identifier === "*";
}

export function explodeUniqueKey(key: string): IUniqueKey {
    const parts = key.split("::");
    return {
        type: parts[0],
        label: parts[1],
        identifier: parts[2]
    };
}

function doesKeyMatch<T extends IUniqueKey>(x: T, keyToFind: IUniqueKey) {
    return x.type === keyToFind.type
        && (x.label === keyToFind.label || x.label === "*" || keyToFind.label === "*")
        && (x.identifier === keyToFind.identifier || x.identifier === "*" || keyToFind.identifier === "*");
}

export function findMatchingKeyFor<T extends IUniqueKey>(
    keyToFind: IUniqueKey,
    results: T[]): T {
    return results.find(x => {
        return doesKeyMatch(x, keyToFind);
    });
}

export function findMatchingKeysFor<T extends IUniqueKey>(
    keyToFind: IUniqueKey,
    results: T[]): T[] {
    return results.filter(x => {
        return doesKeyMatch(x, keyToFind);
    });
}
