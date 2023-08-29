export interface IUniqueKey {
    type: string;
    label: string;
    identifier: string;
}

export function uniqueKey(item: IUniqueKey) {
    return [item.type, item.label, item.identifier].join("|");
}

export function explodeUniqueKey(key: string): IUniqueKey {
    const parts = key.split("|");
    return {
        type: parts[0],
        label: parts[1],
        identifier: parts[2]
    };
}

export function findMatchingKeyFor<T extends IUniqueKey>(
    keyToFind: IUniqueKey,
    results: T[]): T {
    return results.find(x => {
        return x.type === keyToFind.type
            && (x.label === keyToFind.label || x.label === "*" || keyToFind.label === "*")
            && (x.identifier === keyToFind.identifier || x.identifier === "*" || keyToFind.identifier === "*");
    });
}
